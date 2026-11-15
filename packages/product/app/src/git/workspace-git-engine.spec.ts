import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import * as git from 'isomorphic-git';
import {
  createMemoryWorkspaceHost,
  digestBytes,
} from '@sue/verd-board-workspace';
import { createWebWorkspaceHost } from '../host/web-workspace-host';
import { createDocumentFile } from '@sue/verd-board-workspace';
import type { WorkspaceHandle, WorkspaceHost } from '@sue/verd-board-workspace';
import { GitMemoryFs } from '@sue/verd-board-workspace';
import { planGitPurge, rewriteGitPurge } from '@sue/verd-board-workspace';
import { openWorkspaceSession } from '@sue/verd-board-workspace';
import { gitAssetReferences } from '@sue/verd-board-workspace';

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(
    scratch
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const bytes = (value: string) => new TextEncoder().encode(value);
const text = (value: Uint8Array) => new TextDecoder().decode(value);
const run = (directory: string, args: string[]) =>
  execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
async function pdfAsset(content: string) {
  const payload = bytes(content);
  const hash = [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', payload)),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return {
    payload,
    id: hash + '.pdf',
    path: '.verdscrolls/resources/assets/' + hash + '.pdf',
  };
}
function pageLinkDocument(id: string, assets: string[]) {
  const file = createDocumentFile(id, id);
  file.text.content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: assets.map((asset, index) => ({
          type: 'text',
          text: 'PDF page ' + (index + 1),
          marks: [
            {
              type: 'link',
              attrs: { href: `verd://asset/${asset}#page=${index + 1}` },
            },
          ],
        })),
      },
    ],
  };
  return file;
}
async function write(
  host: WorkspaceHost,
  handle: WorkspaceHandle,
  target: string,
  content: string,
) {
  let expectedVersion: string | null = null;
  try {
    expectedVersion = (await host.readFile(handle, target)).version;
  } catch {
    /* New file. */
  }
  expect(
    (
      await host.commit(handle, {
        transactionId: crypto.randomUUID(),
        writes: [{ path: target, content, expectedVersion }],
      })
    ).outcome,
  ).toBe('applied');
}
async function commit(
  host: WorkspaceHost,
  handle: WorkspaceHandle,
  message: string,
  paths?: string[],
) {
  const state = await host.git!(handle, { type: 'status' });
  return host.git!(handle, {
    type: 'commit',
    message,
    paths,
    expectedToken: state.status.token,
  });
}
async function exportMemory(
  host: ReturnType<typeof createMemoryWorkspaceHost>,
  handle: WorkspaceHandle,
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-git-engine-'));
  scratch.push(directory);
  for (const [relative, node] of host.workspaces.get(handle.key)!.nodes)
    if (node.kind === 'file') {
      await mkdir(path.dirname(path.join(directory, relative)), {
        recursive: true,
      });
      await writeFile(path.join(directory, relative), node.content);
    }
  const config = host.workspaces.get(handle.key)!.config;
  await mkdir(path.join(directory, '.verdscrolls'), { recursive: true });
  await writeFile(
    path.join(directory, '.verdscrolls/config.json'),
    JSON.stringify(config),
  );
  return directory;
}
async function importGitMetadata(
  host: ReturnType<typeof createMemoryWorkspaceHost>,
  handle: WorkspaceHandle,
  directory: string,
  relative = '.git',
) {
  for (const entry of await readdir(path.join(directory, relative), {
    withFileTypes: true,
  })) {
    const target = `${relative}/${entry.name}`;
    if (entry.isDirectory())
      await importGitMetadata(host, handle, directory, target);
    else {
      const content = new Uint8Array(
        await readFile(path.join(directory, target)),
      );
      host.workspaces.get(handle.key)!.nodes.set(target, {
        kind: 'file',
        content,
        version: digestBytes(content),
      });
    }
  }
}

describe('Git history with native Git objects', () => {
  it('recognizes asset links only through the resource schema fields', () => {
    const id = 'a'.repeat(64) + '.pdf';
    const references = gitAssetReferences(
      bytes(
        JSON.stringify({
          attrs: {
            href: `verd://asset/${id}#page=7`,
            link: `verd://asset/${id}#page=12`,
          },
          image: { src: 'verd-asset:.verd-resources/assets/image.png' },
          text: `verd://asset/${'b'.repeat(64)}.pdf#page=1`,
          invalid: { href: `verd://asset/${id}#page=0` },
        }),
      ),
    );
    expect([...references].sort()).toEqual(
      [
        '.verdscrolls/resources/assets/' + id,
        '.verdscrolls/resources/assets/image.png',
      ].sort(),
    );
  });

  it('includes a PDF referenced only by a page link when committing one document', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    await host.git!(handle, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    await commit(host, handle, 'Workspace');
    const pdf = await pdfAsset('%PDF-1.4\nPage-link attachment');
    expect(
      (
        await host.commit(handle, {
          transactionId: crypto.randomUUID(),
          resourceWrites: [
            {
              path: 'assets/' + pdf.id,
              content: pdf.payload,
              expectedVersion: null,
            },
          ],
        })
      ).outcome,
    ).toBe('applied');
    await write(
      host,
      handle,
      'pages.verd-doc.json',
      JSON.stringify(pageLinkDocument('pages', [pdf.id])),
    );
    const committed = await commit(host, handle, 'Document and linked PDF', [
      'pages.verd-doc.json',
    ]);
    const version = await host.git!(handle, {
      type: 'read',
      oid: committed.oid!,
    });
    expect([
      ...version.files!.find((file) => file.path === pdf.path)!.content,
    ]).toEqual([...pdf.payload]);
    expect(committed.status.changes).toEqual([]);
  });

  it('purges an exclusively page-linked PDF while preserving one shared by a surviving page link', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    const shared = await pdfAsset('%PDF-1.4\nShared page-link attachment');
    const exclusive = await pdfAsset(
      '%PDF-1.4\nExclusive page-link attachment',
    );
    await host.git!(handle, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    for (const pdf of [shared, exclusive])
      expect(
        (
          await host.commit(handle, {
            transactionId: crypto.randomUUID(),
            resourceWrites: [
              {
                path: 'assets/' + pdf.id,
                content: pdf.payload,
                expectedVersion: null,
              },
            ],
          })
        ).outcome,
      ).toBe('applied');
    await write(
      host,
      handle,
      'remove.verd-doc.json',
      JSON.stringify(pageLinkDocument('remove', [shared.id, exclusive.id])),
    );
    await write(
      host,
      handle,
      'keep.verd-doc.json',
      JSON.stringify(pageLinkDocument('keep', [shared.id])),
    );
    await commit(host, handle, 'Page-linked resources');
    const trashed = await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      trash: [
        {
          path: 'remove.verd-doc.json',
          expectedVersion: (await host.readFile(handle, 'remove.verd-doc.json'))
            .version,
        },
      ],
    });
    const plan = await host.git!(handle, {
      type: 'purge-plan',
      fileIds: [],
      trashEntryIds: trashed.trashEntries!.map((entry) => entry.entryId),
    });
    expect(plan.plan!.paths.map((entry) => entry.path)).toContain(
      exclusive.path,
    );
    expect(plan.plan!.paths.map((entry) => entry.path)).not.toContain(
      shared.path,
    );
    await host.git!(handle, {
      type: 'purge',
      planId: plan.plan!.id,
      expectedToken: plan.plan!.token,
    });
    expect(
      text((await host.readResource(handle, 'assets/' + shared.id)).content),
    ).toContain('Shared');
    await expect(
      host.readResource(handle, 'assets/' + exclusive.id),
    ).rejects.toThrow('Missing resource');
    const directory = await exportMemory(host, handle);
    const exclusiveBlob = (await git.hashBlob({ object: exclusive.payload }))
      .oid;
    expect(() => run(directory, ['cat-file', '-e', exclusiveBlob])).toThrow();
    const sharedBlob = (await git.hashBlob({ object: shared.payload })).oid;
    expect(run(directory, ['cat-file', '-p', sharedBlob])).toContain('Shared');
  });

  it('commits a complete selected file while preserving another native-Git staged file', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    await write(host, handle, 'a.txt', 'alpha');
    await write(host, handle, 'b.txt', 'bravo');
    await host.git!(handle, {
      type: 'init',
      author: { name: 'History Test', email: 'history@example.com' },
    });
    const first = await commit(host, handle, 'Initial');
    await write(host, handle, 'a.txt', 'ALPHA');
    await write(host, handle, 'b.txt', 'BRAVO');
    const external = await exportMemory(host, handle);
    run(external, ['add', '--', 'b.txt']);
    await importGitMetadata(host, handle, external);
    const second = await commit(host, handle, 'Only alpha', ['a.txt']);
    const directory = await exportMemory(host, handle);
    expect(run(directory, ['show', 'HEAD:a.txt'])).toBe('ALPHA');
    expect(run(directory, ['show', 'HEAD:b.txt'])).toBe('bravo');
    expect(run(directory, ['diff', '--cached', '--name-only'])).toBe('b.txt');
    expect(run(directory, ['show', ':b.txt'])).toBe('BRAVO');
    expect(run(directory, ['fsck', '--full'])).not.toContain('error');
    expect(second.oid).not.toBe(first.oid);
    const version = await host.git!(handle, { type: 'read', oid: first.oid! });
    expect(
      text(version.files!.find((file) => file.path === 'a.txt')!.content),
    ).toBe('alpha');
    const plan = await host.git!(handle, {
      type: 'restore-plan',
      oid: first.oid!,
      path: 'a.txt',
    });
    await host.git!(handle, {
      type: 'restore',
      planId: plan.plan!.id,
      expectedToken: plan.plan!.token,
    });
    expect(text((await host.readFile(handle, 'a.txt')).content)).toBe('alpha');
    const restored = await exportMemory(host, handle);
    expect(run(restored, ['diff', '--cached', '--name-only'])).toBe('b.txt');
    expect(run(restored, ['show', ':a.txt'])).toBe('ALPHA');
    expect(
      (await host.readSnapshot(handle)).entries.some((entry) =>
        entry.path.startsWith('.git'),
      ),
    ).toBe(false);
  });

  it('includes new files and full partial-staged contents; failed validation publishes no index changes', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    await host.git!(handle, {
      type: 'init',
      author: { name: 'History Test', email: 'history@example.com' },
    });
    await write(host, handle, 'a.txt', 'one');
    await commit(host, handle, 'Initial');
    await write(host, handle, 'a.txt', 'two');
    const external = await exportMemory(host, handle);
    run(external, ['add', '--', 'a.txt']);
    await importGitMetadata(host, handle, external);
    await write(host, handle, 'a.txt', 'three');
    await write(host, handle, 'new.txt', 'new');
    await commit(host, handle, 'Complete current file', ['a.txt', 'new.txt']);
    const output = await exportMemory(host, handle);
    expect(run(output, ['show', 'HEAD:a.txt'])).toBe('three');
    expect(run(output, ['show', 'HEAD:new.txt'])).toBe('new');
    expect(run(output, ['diff', '--cached', '--name-only'])).toBe('');
    const before = host.workspaces.get(handle.key)!.nodes.get('.git/index');
    await write(
      host,
      handle,
      'invalid.verd-doc.json',
      '{"format":"verd-document"}',
    );
    await expect(
      commit(host, handle, 'Reject invalid native data', [
        'invalid.verd-doc.json',
      ]),
    ).rejects.toThrow('Invalid native file');
    expect(
      host.workspaces.get(handle.key)!.nodes.get('.git/index'),
    ).toStrictEqual(before);
  });

  it('finds file identity across rename and purges old reachable and dangling objects', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    const doc = createDocumentFile('delete-me', 'A secret title'),
      raw = JSON.stringify(doc);
    await write(host, handle, 'old.verd-doc.json', raw);
    await write(host, handle, 'keep.txt', 'kept');
    await host.git!(handle, {
      type: 'init',
      author: { name: 'History Test', email: 'history@example.com' },
    });
    const original = await commit(host, handle, 'Secret document');
    const state = await host.readFile(handle, 'old.verd-doc.json');
    expect(
      (
        await host.commit(handle, {
          transactionId: crypto.randomUUID(),
          moves: [
            {
              from: 'old.verd-doc.json',
              to: 'new.verd-doc.json',
              expectedVersion: state.version,
            },
          ],
        })
      ).outcome,
    ).toBe('applied');
    await commit(host, handle, 'Rename document');
    expect(
      (await host.git!(handle, { type: 'log', fileId: 'delete-me' })).commits,
    ).toHaveLength(2);
    const removed = await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      trash: [
        {
          path: 'new.verd-doc.json',
          expectedVersion: (await host.readFile(handle, 'new.verd-doc.json'))
            .version,
        },
      ],
    });
    await commit(host, handle, 'Delete document');
    const historyPath = '.verdscrolls/resources/history/old.snapshot.json';
    const snapshotBytes = bytes(raw);
    host.workspaces.get(handle.key)!.nodes.set(historyPath, {
      kind: 'file',
      content: snapshotBytes,
      version: digestBytes(snapshotBytes),
    });
    const plan = await host.git!(handle, {
      type: 'purge-plan',
      fileIds: ['delete-me'],
      trashEntryIds: removed.trashEntries!.map((entry) => entry.entryId),
    });
    expect(plan.plan!.paths.map((entry) => entry.path)).toContain(
      'old.verd-doc.json',
    );
    const result = await host.git!(handle, {
      type: 'purge',
      planId: plan.plan!.id,
      expectedToken: plan.plan!.token,
    });
    expect(result.cleanup?.phase).toBe('local-cleared');
    expect((await host.readSnapshot(handle)).trash).toHaveLength(0);
    expect(host.workspaces.get(handle.key)!.nodes.has(historyPath)).toBe(false);
    const directory = await exportMemory(host, handle);
    expect(
      run(directory, ['log', '--all', '--name-only', '--format=']),
    ).not.toMatch(/old\.verd-doc|new\.verd-doc/);
    const blob = (await git.hashBlob({ object: raw })).oid;
    expect(() => run(directory, ['cat-file', '-e', blob])).toThrow();
    expect(() => run(directory, ['cat-file', '-e', original.oid!])).toThrow();
    expect(run(directory, ['fsck', '--full'])).not.toContain('error');
    expect(run(directory, ['show', 'HEAD:keep.txt'])).toBe('kept');
  });

  it('uses stable tokens across navigation and rejects stale content mutations', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    await host.git!(handle, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    await write(host, handle, 'a.txt', 'one');
    const status = (await host.git!(handle, { type: 'status' })).status;
    await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      session: { tabs: [], activeTabId: null, expandedDirs: ['folder'] },
    });
    expect((await host.git!(handle, { type: 'status' })).status.token).toBe(
      status.token,
    );
    await write(host, handle, 'a.txt', 'two');
    await expect(
      host.git!(handle, {
        type: 'commit',
        message: 'Stale',
        expectedToken: status.token,
      }),
    ).rejects.toThrow('state changed');
  });

  it('honors ignored files and keeps ignored data during a complete workspace restore', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    await write(host, handle, '.gitignore', 'private.txt\n');
    await write(host, handle, 'a.txt', 'one');
    await write(host, handle, 'private.txt', 'local-only');
    await host.git!(handle, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    const first = await commit(host, handle, 'Initial');
    expect(
      (await host.git!(handle, { type: 'read', oid: first.oid! })).files!.some(
        (file) => file.path === 'private.txt',
      ),
    ).toBe(false);
    await expect(
      commit(host, handle, 'Do not force ignored content', ['private.txt']),
    ).rejects.toThrow('ignores');
    await write(host, handle, 'a.txt', 'two');
    await commit(host, handle, 'Second');
    const plan = await host.git!(handle, {
      type: 'restore-plan',
      oid: first.oid!,
    });
    expect(plan.plan!.paths.some((entry) => entry.path === 'private.txt')).toBe(
      false,
    );
    await host.git!(handle, {
      type: 'restore',
      planId: plan.plan!.id,
      expectedToken: plan.plan!.token,
    });
    expect(text((await host.readFile(handle, 'private.txt')).content)).toBe(
      'local-only',
    );
    expect(text((await host.readFile(handle, 'a.txt')).content)).toBe('one');
  });

  it('refuses ignored target collisions and any unrelated dirty files in a workspace restore', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    await write(host, handle, 'occupied.txt', 'versioned');
    await write(host, handle, 'a.txt', 'one');
    await host.git!(handle, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    const first = await commit(host, handle, 'Initial');
    await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      trash: [
        {
          path: 'occupied.txt',
          expectedVersion: (await host.readFile(handle, 'occupied.txt'))
            .version,
        },
      ],
    });
    await write(host, handle, '.gitignore', 'occupied.txt\n');
    await commit(host, handle, 'Remove target');
    await write(host, handle, 'occupied.txt', 'ignored local content');
    await expect(
      host.git!(handle, { type: 'restore-plan', oid: first.oid! }),
    ).rejects.toThrow('occupies a restore target');
    await write(host, handle, 'a.txt', 'dirty');
    const current = (await host.git!(handle, { type: 'status' })).status.head!;
    await expect(
      host.git!(handle, { type: 'restore-plan', oid: current }),
    ).rejects.toThrow('before restoring');
    expect(text((await host.readFile(handle, 'occupied.txt')).content)).toBe(
      'ignored local content',
    );
  });

  it('restores missing reference dependencies from the same commit and keeps existing ones current', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    const a = createDocumentFile('a', 'A'),
      b = createDocumentFile('b', 'B original');
    a.text.content = {
      type: 'doc',
      content: [{ type: 'documentExcerpt', attrs: { targetDocumentId: 'b' } }],
    };
    await write(host, handle, 'a.verd-doc.json', JSON.stringify(a));
    await write(host, handle, 'b.verd-doc.json', JSON.stringify(b));
    await host.git!(handle, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    const first = await commit(host, handle, 'Referenced version');
    await write(
      host,
      handle,
      'a.verd-doc.json',
      JSON.stringify(createDocumentFile('a', 'A current')),
    );
    await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      trash: [
        {
          path: 'b.verd-doc.json',
          expectedVersion: (await host.readFile(handle, 'b.verd-doc.json'))
            .version,
        },
      ],
    });
    await commit(host, handle, 'Remove reference and dependency');
    const plan = await host.git!(handle, {
      type: 'restore-plan',
      oid: first.oid!,
      fileId: 'a',
    });
    expect(plan.plan!.paths.map((entry) => entry.path)).toContain(
      'b.verd-doc.json',
    );
    await host.git!(handle, {
      type: 'restore',
      planId: plan.plan!.id,
      expectedToken: plan.plan!.token,
    });
    expect(
      text((await host.readFile(handle, 'b.verd-doc.json')).content),
    ).toContain('B original');
    await write(
      host,
      handle,
      'b.verd-doc.json',
      JSON.stringify(createDocumentFile('b', 'B current')),
    );
    await commit(host, handle, 'Current dependency');
    const keep = await host.git!(handle, {
      type: 'restore-plan',
      oid: first.oid!,
      fileId: 'a',
    });
    expect(keep.plan!.paths.map((entry) => entry.path)).not.toContain(
      'b.verd-doc.json',
    );
    await host.git!(handle, {
      type: 'restore',
      planId: keep.plan!.id,
      expectedToken: keep.plan!.token,
    });
    expect(
      text((await host.readFile(handle, 'b.verd-doc.json')).content),
    ).toContain('B current');
  });

  it('keeps existing reference placeholders when the target is committed deleted and permanently purged', async () => {
    const host = createMemoryWorkspaceHost();
    const handle = (await host.openWorkspace())!;
    const a = createDocumentFile('source-a', 'Source A');
    const b = createDocumentFile('target-b', 'Private target B');
    a.text.content = {
      type: 'doc',
      content: [
        { type: 'documentExcerpt', attrs: { targetDocumentId: 'target-b' } },
      ],
    };
    await write(host, handle, 'a.verd-doc.json', JSON.stringify(a));
    await write(host, handle, 'b.verd-doc.json', JSON.stringify(b));
    await host.git!(handle, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    await commit(host, handle, 'Reference and target');
    const trashed = await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      trash: [
        {
          path: 'b.verd-doc.json',
          expectedVersion: (await host.readFile(handle, 'b.verd-doc.json'))
            .version,
        },
      ],
    });
    await commit(host, handle, 'Delete referenced target', ['b.verd-doc.json']);
    const plan = await host.git!(handle, {
      type: 'purge-plan',
      fileIds: [],
      trashEntryIds: trashed.trashEntries!.map((entry) => entry.entryId),
    });
    await host.git!(handle, {
      type: 'purge',
      planId: plan.plan!.id,
      expectedToken: plan.plan!.token,
    });
    expect(
      text((await host.readFile(handle, 'a.verd-doc.json')).content),
    ).toContain('target-b');
    const directory = await exportMemory(host, handle);
    const removedBlob = (await git.hashBlob({ object: JSON.stringify(b) })).oid;
    expect(() => run(directory, ['cat-file', '-e', removedBlob])).toThrow();
    expect(run(directory, ['show', 'HEAD:a.verd-doc.json'])).toContain(
      'source-a',
    );
  });

  it('permanently removes Session trash without an intervening commit or caller-supplied identities', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    const session = await openWorkspaceSession(host, handle, {
      delayMs: 60_000,
    });
    const file = createDocumentFile('session-secret', 'Delete this content');
    expect(
      (
        await session.apply({
          type: 'create-file',
          file,
          path: 'secret.verd-doc.json',
        })
      ).ok,
    ).toBe(true);
    await session.git({
      type: 'init',
      author: { name: 'Session Test', email: 'session@example.com' },
    });
    const initialStatus = await session.git({ type: 'status' });
    const original = await session.git({
      type: 'commit',
      message: 'Secret content',
      expectedToken: initialStatus.status.token,
    });
    const resource = '.verd-resources/assets/exclusive.png';
    const checkpoint = createDocumentFile(
      'session-secret',
      'Never committed attachment',
    );
    checkpoint.text.content = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'verd-asset:' + resource } }],
    };
    await session.commitResources(
      [
        {
          path: resource,
          content: bytes('private attachment bytes'),
          expectedVersion: null,
        },
        {
          path: '.verd-resources/history/private.snapshot.json',
          content: JSON.stringify(checkpoint),
          expectedVersion: null,
        },
      ],
      ['session-secret'],
    );
    expect(
      (await session.apply({ type: 'trash-file', fileId: 'session-secret' }))
        .ok,
    ).toBe(true);
    expect(await session.flush()).toBe(true);
    const entryIds = session.getState().trash.map((entry) => entry.entryId);
    expect(entryIds).toHaveLength(1);
    const plan = await session.git({
      type: 'purge-plan',
      fileIds: [],
      trashEntryIds: entryIds,
    });
    expect(plan.plan!.fileIds).toContain('session-secret');
    expect(plan.plan!.paths.map((entry) => entry.path)).toContain(
      '.verdscrolls/resources/assets/exclusive.png',
    );
    await session.git({
      type: 'purge',
      planId: plan.plan!.id,
      expectedToken: plan.plan!.token,
    });
    expect(session.getState().trash).toEqual([]);
    expect(session.getState().canUndo).toBe(false);
    expect(
      host.workspaces
        .get(handle.key)!
        .nodes.has('.verdscrolls/resources/history/private.snapshot.json'),
    ).toBe(false);
    expect(
      host.workspaces
        .get(handle.key)!
        .nodes.has('.verdscrolls/resources/assets/exclusive.png'),
    ).toBe(false);
    const directory = await exportMemory(host, handle);
    expect(() => run(directory, ['cat-file', '-e', original.oid!])).toThrow();
    const removedBlob = (await git.hashBlob({ object: JSON.stringify(file) }))
      .oid;
    expect(() => run(directory, ['cat-file', '-e', removedBlob])).toThrow();
    session.dispose();
  });

  it('follows plain renames for preview and restore without deleting a later reused alias', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    await write(host, handle, 'a.txt', 'plain private history');
    await host.git!(handle, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    const first = await commit(host, handle, 'Created');
    await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      moves: [
        {
          from: 'a.txt',
          to: 'b.txt',
          expectedVersion: (await host.readFile(handle, 'a.txt')).version,
        },
      ],
    });
    await commit(host, handle, 'Renamed');
    await write(host, handle, 'a.txt', 'independent replacement');
    await commit(host, handle, 'Reused alias');
    const history = await host.git!(handle, { type: 'log', path: 'b.txt' });
    expect(history.commits!.map((entry) => entry.path)).toEqual([
      'b.txt',
      'a.txt',
    ]);
    const restore = await host.git!(handle, {
      type: 'restore-plan',
      path: 'b.txt',
      oid: first.oid!,
    });
    expect(restore.plan!.paths.map((entry) => entry.path)).toEqual(['b.txt']);
    await host.git!(handle, {
      type: 'restore',
      planId: restore.plan!.id,
      expectedToken: restore.plan!.token,
    });
    const trashed = await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      trash: [
        {
          path: 'b.txt',
          expectedVersion: (await host.readFile(handle, 'b.txt')).version,
        },
      ],
    });
    const plan = await host.git!(handle, {
      type: 'purge-plan',
      fileIds: [],
      trashEntryIds: trashed.trashEntries!.map((entry) => entry.entryId),
    });
    await host.git!(handle, {
      type: 'purge',
      planId: plan.plan!.id,
      expectedToken: plan.plan!.token,
    });
    expect(text((await host.readFile(handle, 'a.txt')).content)).toBe(
      'independent replacement',
    );
    const directory = await exportMemory(host, handle);
    expect(run(directory, ['show', 'HEAD:a.txt'])).toBe(
      'independent replacement',
    );
    const blob = (await git.hashBlob({ object: 'plain private history' })).oid;
    expect(() => run(directory, ['cat-file', '-e', blob])).toThrow();
  });

  it('anchors trash bytes to the old plain incarnation and preserves a new file at the same path', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    await write(host, handle, 'a.txt', 'old incarnation');
    await host.git!(handle, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    await commit(host, handle, 'Old file');
    const trashed = await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      trash: [
        {
          path: 'a.txt',
          expectedVersion: (await host.readFile(handle, 'a.txt')).version,
        },
      ],
    });
    await commit(host, handle, 'Delete old incarnation');
    await write(host, handle, 'a.txt', 'new incarnation');
    await commit(host, handle, 'New file at same path');
    const plan = await host.git!(handle, {
      type: 'purge-plan',
      fileIds: [],
      trashEntryIds: trashed.trashEntries!.map((entry) => entry.entryId),
    });
    await host.git!(handle, {
      type: 'purge',
      planId: plan.plan!.id,
      expectedToken: plan.plan!.token,
    });
    expect(text((await host.readFile(handle, 'a.txt')).content)).toBe(
      'new incarnation',
    );
    const directory = await exportMemory(host, handle);
    expect(run(directory, ['show', 'HEAD:a.txt'])).toBe('new incarnation');
    const blob = (await git.hashBlob({ object: 'old incarnation' })).oid;
    expect(() => run(directory, ['cat-file', '-e', blob])).toThrow();
  });

  it('follows a native-Git R098 modified rename and blocks surviving identical copies', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    const original = Array.from(
      { length: 100 },
      (_, index) => `private line ${index}`,
    ).join('\n');
    await write(host, handle, 'a.txt', original);
    await host.git!(handle, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    const initial = await commit(host, handle, 'Original');
    await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      moves: [
        {
          from: 'a.txt',
          to: 'b.txt',
          expectedVersion: (await host.readFile(handle, 'a.txt')).version,
        },
      ],
    });
    await write(host, handle, 'b.txt', original + '\nextra line');
    const renamed = await commit(host, handle, 'Modified rename');
    const native = await exportMemory(host, handle);
    expect(
      run(native, [
        'diff-tree',
        '--no-commit-id',
        '--name-status',
        '-M',
        '-r',
        initial.oid!,
        renamed.oid!,
      ]),
    ).toMatch(/R0?9\d\s+a\.txt\s+b\.txt/);
    const plan = await host.git!(handle, {
      type: 'purge-plan',
      fileIds: [],
      paths: ['b.txt'],
    });
    expect(plan.plan!.warnings.join(' ')).toContain('similarity');
    await host.git!(handle, {
      type: 'purge',
      planId: plan.plan!.id,
      expectedToken: plan.plan!.token,
    });
    const clean = await exportMemory(host, handle);
    const originalBlob = (await git.hashBlob({ object: original })).oid;
    expect(() => run(clean, ['cat-file', '-e', originalBlob])).toThrow();
    const other = createMemoryWorkspaceHost(),
      next = (await other.openWorkspace())!;
    await write(other, next, 'selected.txt', 'same bytes');
    await write(other, next, 'keep.txt', 'same bytes');
    await other.git!(next, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    await commit(other, next, 'Two copies');
    await expect(
      other.git!(next, {
        type: 'purge-plan',
        fileIds: [],
        paths: ['selected.txt'],
      }),
    ).rejects.toThrow('Identical content remains');
  });

  it('blocks fully rewritten rename boundaries rather than claiming complete cleanup', async () => {
    const host = createMemoryWorkspaceHost(),
      handle = (await host.openWorkspace())!;
    await write(host, handle, 'a.txt', 'original private content');
    await host.git!(handle, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    await commit(host, handle, 'Original');
    await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      moves: [
        {
          from: 'a.txt',
          to: 'b.txt',
          expectedVersion: (await host.readFile(handle, 'a.txt')).version,
        },
      ],
    });
    await write(host, handle, 'b.txt', 'wholly unrelated replacement');
    await commit(host, handle, 'Rewritten rename');
    await expect(
      host.git!(handle, { type: 'purge-plan', fileIds: [], paths: ['b.txt'] }),
    ).rejects.toThrow('possible modified rename');
  });

  it('requires Desktop for cleanup of an imported repository with configured remotes', async () => {
    const host = createMemoryWorkspaceHost();
    const handle = (await host.openWorkspace())!;
    await host.git!(handle, {
      type: 'init',
      author: { name: 'Test', email: 'test@example.com' },
    });
    const workspace = host.workspaces.get(handle.key)!;
    const config = workspace.nodes.get('.git/config')!;
    if (config.kind !== 'file') throw new Error('Missing Git config');
    const content = bytes(
      text(config.content) +
        '\n[remote "origin"]\n\turl = https://example.com/project.git\n',
    );
    workspace.nodes.set('.git/config', {
      kind: 'file',
      content,
      version: digestBytes(content),
    });
    expect(
      (await host.git!(handle, { type: 'status' })).status.remote?.name,
    ).toBe('origin');
    await expect(
      host.git!(handle, { type: 'purge-plan', fileIds: ['target'] }),
    ).rejects.toThrow('Use Desktop');
    expect(
      text((workspace.nodes.get('.git/config') as typeof config).content),
    ).toContain('example.com');
  });
});

describe('browser Git persistence', () => {
  it('persists a real repository across hosts in the existing IndexedDB database', async () => {
    const indexedDB = new IDBFactory(),
      options = { indexedDB, dbName: crypto.randomUUID() };
    const first = createWebWorkspaceHost(options),
      handle = (await first.openWorkspace({ default: true }))!;
    await write(first, handle, 'a.txt', 'one');
    await first.git!(handle, {
      type: 'init',
      author: { name: 'Browser', email: 'browser@example.com' },
    });
    const committed = await commit(first, handle, 'Browser version');
    const reopened = createWebWorkspaceHost(options),
      next = (await reopened.openWorkspace({ default: true }))!;
    expect((await reopened.git!(next, { type: 'status' })).status.head).toBe(
      committed.oid,
    );
    expect(
      (await reopened.git!(next, { type: 'status' })).status.changes,
    ).toEqual([]);
    expect(
      text(
        (
          await reopened.git!(next, { type: 'read', oid: committed.oid! })
        ).files!.find((file) => file.path === 'a.txt')!.content,
      ),
    ).toBe('one');
    expect(
      (await reopened.readSnapshot(next)).entries.some((entry) =>
        entry.path.startsWith('.git'),
      ),
    ).toBe(false);
    await expect(
      reopened.git!(next, {
        type: 'sync',
        expectedToken: committed.status.token,
      }),
    ).rejects.toThrow('Desktop');
  });

  it('publishes at most one concurrent commit from independently loaded browser hosts', async () => {
    const indexedDB = new IDBFactory(),
      options = { indexedDB, dbName: crypto.randomUUID() };
    const a = createWebWorkspaceHost(options),
      handle = (await a.openWorkspace({ default: true }))!;
    await a.git!(handle, {
      type: 'init',
      author: { name: 'Browser', email: 'browser@example.com' },
    });
    await write(a, handle, 'a.txt', 'content');
    const b = createWebWorkspaceHost(options),
      second = (await b.openWorkspace({ default: true }))!;
    const expectedToken = (await a.git!(handle, { type: 'status' })).status
      .token;
    const results = await Promise.allSettled([
      a.git!(handle, {
        type: 'commit',
        expectedToken,
        message: 'First writer',
      }),
      b.git!(second, {
        type: 'commit',
        expectedToken,
        message: 'Second writer',
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect((await a.git!(handle, { type: 'log' })).commits).toHaveLength(1);
    expect(text((await a.readFile(handle, 'a.txt')).content)).toBe('content');
  });
});

it('rebuilds a native repository with annotated tags, while retaining a reused native path', async () => {
  const fs = new GitMemoryFs(),
    location = { fs, dir: '/repo' };
  await git.init({ ...location, defaultBranch: 'main' });
  const old = JSON.stringify(createDocumentFile('removed', 'secret'));
  fs.put('/repo/reused.verd-doc.json', bytes(old));
  await git.add({ ...location, filepath: 'reused.verd-doc.json' });
  const author = { name: 'Test', email: 'test@example.com' };
  const first = await git.commit({
    ...location,
    author,
    message: 'Old identity',
  });
  await git.annotatedTag({
    ...location,
    ref: 'v1',
    object: first,
    tagger: author,
    message: 'Version one',
  });
  fs.put(
    '/repo/reused.verd-doc.json',
    bytes(JSON.stringify(createDocumentFile('survives', 'keep'))),
  );
  await git.add({ ...location, filepath: 'reused.verd-doc.json' });
  await git.commit({ ...location, author, message: 'New identity' });
  const analysis = await planGitPurge({
    ...location,
    fileIds: ['removed'],
    paths: ['reused.verd-doc.json'],
  });
  const rebuilt = await rewriteGitPurge({ ...location, analysis });
  const clean = new GitMemoryFs(
    [...rebuilt.files].map(([path, bytes]) => [`/clean/.git/${path}`, bytes]),
  );
  const current = await git.resolveRef({
    fs: clean,
    dir: '/clean',
    ref: 'HEAD',
  });
  expect(
    text(
      (
        await git.readBlob({
          fs: clean,
          dir: '/clean',
          oid: current,
          filepath: 'reused.verd-doc.json',
        })
      ).blob,
    ),
  ).toContain('survives');
  expect(
    [...rebuilt.files.keys()].some((path) => path.startsWith('logs/')),
  ).toBe(false);
  await expect(
    git.readBlob({
      fs: clean,
      dir: '/clean',
      oid: (await git.hashBlob({ object: old })).oid,
    }),
  ).rejects.toThrow();
});
