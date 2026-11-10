import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createDocumentFile,
  openWorkspaceSession,
} from '@sue/verd-board-app/headless';
import {
  readRevisions,
  restoreRevision,
} from '../../../app/src/documents/workspace-resources';
import { digest } from './workspace-lock';
import { createFsWorkspaceHost } from './workspace-host-fs';
import { preserveWorkspaceResources } from './workspace-resource-storage';
const roots: string[] = [];
const handles: {
  host: ReturnType<typeof createFsWorkspaceHost>;
  handle: { key: string; name: string };
}[] = [];
afterEach(async () => {
  for (const { host, handle } of handles.splice(0))
    await host.closeWorkspace(handle);
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});
const directory = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-resources-'));
  roots.push(root);
  return root;
};
const put = async (root: string, file: string, text: string) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), text);
};
async function open(root: string) {
  const host = createFsWorkspaceHost({ defaultRoot: () => root });
  const handle = (await host.openWorkspace({ path: root }))!;
  handles.push({ host, handle });
  return { host, handle };
}
describe('managed project resources', () => {
  it('migrates originals and history once without parsing snapshots or project caches', async () => {
    const root = await directory();
    await put(root, '.verd-resources/assets/image.bin', 'original bytes');
    await put(
      root,
      '.verd-resources/history/index.json',
      '{"version":1,"revisions":[]}',
    );
    await put(
      root,
      '.verdscrolls/cache/internal.verd.json',
      '{"format":"invalid"}',
    );
    await put(root, 'ordinary/notes.md', '# notes');
    const { host, handle } = await open(root);
    const snapshot = await host.readSnapshot(handle);
    expect(snapshot.entries.some((entry) => entry.path.includes('.verd'))).toBe(
      false,
    );
    expect(
      snapshot.entries.some((entry) => entry.path === 'ordinary/notes.md'),
    ).toBe(true);
    expect(snapshot.canvases).toEqual([]);
    expect(snapshot.resources?.map((entry) => entry.key).sort()).toEqual([
      'assets/image.bin',
      'history/index.json',
    ]);
    expect(
      new TextDecoder().decode(
        (await host.readResource(handle, 'assets/image.bin')).content,
      ),
    ).toBe('original bytes');
    await expect(fs.stat(path.join(root, '.verd-resources'))).rejects.toThrow();
    const again = await host.openWorkspace({ path: root });
    expect((await host.readSnapshot(again!)).resources).toEqual(
      snapshot.resources,
    );
    const ignore = await fs.readFile(
      path.join(root, '.verdscrolls/.gitignore'),
      'utf8',
    );
    expect(ignore).toContain('!resources/assets/**');
  });
  it('preserves conflicting directories and blocks resource writes, including old writers after migration', async () => {
    const root = await directory();
    await put(root, '.verd-resources/assets/a.bin', 'legacy');
    await put(root, '.verdscrolls/resources/assets/a.bin', 'current');
    const { host, handle } = await open(root);
    expect(
      (await host.readSnapshot(handle)).diagnostics.some((entry) =>
        entry.message.includes('conflict'),
      ),
    ).toBe(true);
    expect(
      (
        await host.commit(handle, {
          transactionId: 'blocked',
          resourceWrites: [
            { path: 'assets/new.bin', content: 'new', expectedVersion: null },
          ],
        })
      ).outcome,
    ).toBe('rejected');
    expect(
      await fs.readFile(
        path.join(root, '.verd-resources/assets/a.bin'),
        'utf8',
      ),
    ).toBe('legacy');
    expect(
      await fs.readFile(
        path.join(root, '.verdscrolls/resources/assets/a.bin'),
        'utf8',
      ),
    ).toBe('current');
  });
  it('recovers old applying journals before moving the resource directory', async () => {
    const root = await directory();
    const first = await open(root);
    await first.host.closeWorkspace(first.handle);
    await fs.rm(path.join(root, '.verdscrolls/migration/resources-v1.json'));
    await put(root, '.verdscrolls/transactions/old.staging/0.bin', 'recovered');
    await put(
      root,
      '.verdscrolls/transactions/old.json',
      JSON.stringify({
        transactionId: 'old',
        phase: 'applying',
        createdAt: 1,
        ops: [
          {
            kind: 'write',
            path: '.verd-resources/assets/recovered.bin',
            before: null,
            after: digest('recovered'),
            staged: 'transactions/old.staging/0.bin',
          },
        ],
      }),
    );
    const { host, handle } = await open(root);
    expect((await host.readSnapshot(handle)).diagnostics).toEqual([]);
    expect(
      new TextDecoder().decode(
        (await host.readResource(handle, 'assets/recovered.bin')).content,
      ),
    ).toBe('recovered');
  });
  it('finishes an interrupted rename, rejects symlinks and preserves history during built-in replacement', async () => {
    const root = await directory();
    await put(root, '.verdscrolls/resources/assets/a.bin', 'asset');
    await put(
      root,
      '.verdscrolls/resources/history/one.snapshot.json',
      'history',
    );
    const { host, handle } = await open(root);
    await expect(
      fs.stat(path.join(root, '.verdscrolls/migration/resources-v1.json')),
    ).resolves.toBeTruthy();
    const staging = await directory();
    await preserveWorkspaceResources(root, staging);
    expect(
      await fs.readFile(
        path.join(staging, '.verdscrolls/resources/history/one.snapshot.json'),
        'utf8',
      ),
    ).toBe('history');
    await fs.symlink(
      path.join(root, 'AGENTS.md'),
      path.join(root, '.verdscrolls/resources/assets/link.bin'),
    );
    await expect(host.readResource(handle, 'assets/link.bin')).rejects.toThrow(
      'symlink',
    );
    expect(
      (
        await host.commit(handle, {
          transactionId: 'symlink-write',
          resourceWrites: [
            { path: 'assets/link.bin', content: 'bad', expectedVersion: null },
          ],
        })
      ).outcome,
    ).toBe('rejected');
  });
});

it('restores migrated historical versions through their original logical paths', async () => {
  const root = await directory();
  const original = createDocumentFile('doc', 'Earlier');
  const latest = createDocumentFile('doc', 'Current');
  await put(root, 'note.verd-doc.json', JSON.stringify(latest));
  const revision = {
    id: 'old',
    fileId: 'doc',
    title: 'Earlier',
    name: 'Before',
    at: 1,
    path: '.verd-resources/history/old.snapshot.json',
  };
  await put(root, revision.path, JSON.stringify(original));
  await put(
    root,
    '.verd-resources/history/index.json',
    JSON.stringify({ version: 1, revisions: [revision] }),
  );
  const { host, handle } = await open(root);
  const session = await openWorkspaceSession(host, handle);
  expect((await readRevisions(session)).manifest.revisions[0]).toEqual(
    revision,
  );
  await restoreRevision(session, revision);
  expect(session.getState().documents.get('doc')?.file.title).toBe('Earlier');
  expect(
    session.getState().entries.some((entry) => entry.path.includes('history')),
  ).toBe(false);
  session.dispose();
});

it('recovers scoped resource journals with resource-only digests and sends external resource notifications', async () => {
  const root = await directory();
  const first = await open(root);
  await first.host.closeWorkspace(first.handle);
  const resourcePath = '.verdscrolls/resources/assets/recovered.bin';
  await put(
    root,
    '.verdscrolls/transactions/scoped.staging/0.bin',
    'recovered',
  );
  await put(
    root,
    '.verdscrolls/transactions/scoped.json',
    JSON.stringify({
      transactionId: 'scoped',
      phase: 'applying',
      createdAt: 1,
      ops: [
        {
          kind: 'resource-write',
          path: resourcePath,
          before: null,
          after: digest('recovered'),
          staged: 'transactions/scoped.staging/0.bin',
        },
      ],
    }),
  );
  const { host, handle } = await open(root);
  const receipt = await host.commit(handle, {
    transactionId: 'scoped',
    resourceWrites: [
      {
        path: 'assets/recovered.bin',
        content: 'recovered',
        expectedVersion: null,
      },
    ],
  });
  expect(receipt.outcome).toBe('applied');
  expect(receipt.versions).toEqual({});
  expect(receipt.resourceVersions).toEqual({
    'assets/recovered.bin': digest('recovered'),
  });
  const changed: string[] = [];
  const unsubscribe = host.subscribe(handle, (hint) =>
    changed.push(...(hint.paths ?? [])),
  );
  try {
    await put(root, resourcePath, 'external revision');
    await vi.waitFor(() => expect(changed).toContain(resourcePath), {
      timeout: 3000,
    });
  } finally {
    unsubscribe();
  }
  expect(
    new TextDecoder().decode(
      (await host.readResource(handle, 'assets/recovered.bin')).content,
    ),
  ).toBe('external revision');
});

it('accepts an empty legacy directory alongside existing managed resources', async () => {
  const root = await directory();
  await fs.mkdir(path.join(root, '.verd-resources/assets'), {
    recursive: true,
  });
  await put(root, '.verdscrolls/resources/assets/existing.bin', 'keep');
  const { host, handle } = await open(root);
  expect((await host.readSnapshot(handle)).diagnostics).toEqual([]);
  expect(
    new TextDecoder().decode(
      (await host.readResource(handle, 'assets/existing.bin')).content,
    ),
  ).toBe('keep');
  await expect(fs.stat(path.join(root, '.verd-resources'))).rejects.toThrow();
});
