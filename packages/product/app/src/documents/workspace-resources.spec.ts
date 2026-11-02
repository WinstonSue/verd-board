import {
  createWorkspaceActionRegistry,
  workspaceActionCommandResult,
} from '../session/workspace-actions';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import {
  openWorkspaceSession,
  type WorkspaceSession,
} from '../session/workspace-session';
import { createDocumentFile } from './document-files';
import {
  saveRevision,
  readRevisions,
  readRevision,
  restoreRevision,
  inlineFileAssets,
} from './workspace-resources';
const sessions: WorkspaceSession[] = [];
afterEach(() => sessions.splice(0).forEach((session) => session.dispose()));
async function setup() {
  const host = createMemoryWorkspaceHost();
  const handle = (await host.openWorkspace({ path: crypto.randomUUID() }))!;
  const session = await openWorkspaceSession(host, handle, { delayMs: 60000 });
  sessions.push(session);
  const file = createDocumentFile('doc', 'Before');
  await session.apply({ type: 'import-files', files: [file] });
  await session.flush();
  return { host, handle, session, file };
}
describe('durable versions and resource transactions', () => {
  it('survives reopening, previews old content, and restores as an undoable new edit', async () => {
    const { host, handle, session, file } = await setup();
    const revision = await saveRevision(session, file, 'Named version');
    await session.apply({ type: 'file', file: { ...file, title: 'After' } });
    await session.flush();
    session.dispose();
    const reopened = await openWorkspaceSession(host, handle, {
      delayMs: 60000,
    });
    sessions.push(reopened);
    expect((await readRevisions(reopened)).manifest.revisions[0].name).toBe(
      'Named version',
    );
    expect((await readRevision(reopened, revision)).format).toBe(
      'verd-document',
    );
    await restoreRevision(reopened, revision);
    expect(reopened.getState().documents.get('doc')?.file.title).toBe('Before');
    await reopened.undo();
    expect(reopened.getState().documents.get('doc')?.file.title).toBe('After');
    expect((await readRevisions(reopened)).manifest.revisions).toHaveLength(2);
  });
  it('rejects readonly resource writes and path escapes', async () => {
    const { session } = await setup();
    await expect(
      session.commitResources([
        { path: '../escape', content: 'bad', expectedVersion: null },
      ]),
    ).rejects.toThrow();
    session.setReadonly(true);
    await expect(
      saveRevision(session, session.getState().documents.get('doc')!.file),
    ).rejects.toThrow();
  });
  it('compares versions before write and never overwrites an unrelated raw file', async () => {
    const { session } = await setup();
    await session.commitResources([
      {
        path: '.verd-resources/test.bin',
        content: 'first',
        expectedVersion: null,
      },
    ]);
    const receipt = await session.commitResources([
      {
        path: '.verd-resources/test.bin',
        content: 'second',
        expectedVersion: null,
      },
    ]);
    expect(receipt.outcome).toBe('rejected');
    expect(
      new TextDecoder().decode(
        (await session.readRawFile('.verd-resources/test.bin')).content,
      ),
    ).toBe('first');
  });
  it('preserves both sides of a document conflict with independent identities', async () => {
    const { host, handle, session, file } = await setup();
    await session.apply({ type: 'file', file: { ...file, title: 'Local' } });
    const entry = session.getState().documents.get('doc')!;
    const raw = await host.readFile(handle, entry.path);
    await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      writes: [
        {
          path: entry.path,
          content: JSON.stringify({ ...file, title: 'Disk' }),
          expectedVersion: raw.version,
        },
      ],
    });
    await session.syncFromHost();
    expect(session.getState().documents.get('doc')?.conflicted).toBe(true);
    const actions = createWorkspaceActionRegistry({
      getContext: () => ({ session }),
    });
    const result = workspaceActionCommandResult(
      await actions.executeAction('workspace.resolve-conflict', {
        fileId: 'doc',
        action: 'save-copy',
      }),
    );
    actions.dispose();
    expect(result.ok).toBe(true);
    await session.flush();
    const docs = [...session.getState().documents.values()].map(
      (entry) => entry.file,
    );
    expect(docs.map((doc) => doc.title).sort()).toEqual(['Disk', 'Local']);
    expect(new Set(docs.map((doc) => doc.id)).size).toBe(2);
  });
  it('permanent deletion purges persisted versions as well as live undo history', async () => {
    const { session, file } = await setup();
    const revision = await saveRevision(session, file);
    await session.apply({ type: 'trash-file', fileId: 'doc' });
    await session.flush();
    const entry = session.getState().trash[0];
    const result = await session.apply({
      type: 'purge-trash',
      entryIds: [entry.entryId],
    });
    expect(result.ok).toBe(true);
    expect((await readRevisions(session)).manifest.revisions).toHaveLength(0);
    await expect(readRevision(session, revision)).rejects.toThrow();
  });
  it('exports managed assets inline for older consumers without changing live content', async () => {
    const { session, file } = await setup();
    const path = '.verd-resources/assets/test.png';
    await session.commitResources([
      { path, content: new Uint8Array([1, 2, 3]), expectedVersion: null },
    ]);
    file.text.content = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'verd-asset:' + path } }],
    };
    const exported = await inlineFileAssets(session, file);
    expect(
      exported.format === 'verd-document' &&
        exported.text.content.content?.[0].attrs?.['src'],
    ).toBe('data:image/png;base64,AQID');
    expect(file.text.content.content?.[0].attrs?.['src']).toBe(
      'verd-asset:' + path,
    );
  });
});

it('keeps file metadata through canvas edits, duplication and search', async () => {
  const { session, file } = await setup();
  const next = {
    ...file,
    properties: {
      tags: ['unique-tag'],
      status: 'review',
      source: 'https://source.example',
    },
  };
  expect((await session.apply({ type: 'file', file: next })).ok).toBe(true);
  const { extractSearchRecord, searchRecords } =
    await import('../management/search');
  const record = extractSearchRecord(
    session.getState().documents.get('doc')!.file,
    'Doc.verd-doc.json',
  );
  expect(searchRecords([record], 'unique-tag')).toHaveLength(1);
  expect(searchRecords([record], 'source.example')).toHaveLength(1);
  expect(searchRecords([record], 'unique-tag', true)).toHaveLength(0);
  await session.apply({ type: 'duplicate-file', fileId: 'doc' });
  expect(
    [...session.getState().documents.values()].every(
      (entry) => entry.file.properties?.tags[0] === 'unique-tag',
    ),
  ).toBe(true);
});

it('retains purge bindings across process restart', async () => {
  const { host, handle, session, file } = await setup();
  const revision = await saveRevision(session, file, 'Archive');
  await session.apply({ type: 'trash-file', fileId: 'doc' });
  await session.flush();
  session.dispose();
  const reopened = await openWorkspaceSession(host, handle, { delayMs: 60000 });
  sessions.push(reopened);
  const entry = reopened.getState().trash[0];
  expect(
    (await reopened.apply({ type: 'purge-trash', entryIds: [entry.entryId] }))
      .ok,
  ).toBe(true);
  expect((await readRevisions(reopened)).manifest.revisions).toEqual([]);
  await expect(readRevision(reopened, revision)).rejects.toThrow();
});
