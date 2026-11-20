import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createDocumentFile,
  openWorkspaceSession,
} from '@sue/verd-board-workspace';
import { readRevisions, restoreRevision } from '@sue/verd-board-workspace';
import { digest } from './workspace-lock';
import { createFsWorkspaceHost } from './workspace-host-fs';
import {
  migrateWorkspaceResourcesUnlocked,
  preserveWorkspaceResources,
} from './workspace-resource-storage';

// A configurable facade keeps fault injection local to this test module while
// ordinary calls still use the real filesystem.
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
}));

const roots: string[] = [];
const handles: {
  host: ReturnType<typeof createFsWorkspaceHost>;
  handle: { key: string; name: string };
}[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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
    await put(root, '.verdscrolls/cache/internal.verd', '{"format":"invalid"}');
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
  it('preserves conflicting directories and blocks resource writes', async () => {
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

const legacy = '.verd-resources';
const managed = '.verdscrolls/resources';
const archived = '.verdscrolls/migration/resources-v1-legacy';
const marker = '.verdscrolls/migration/resources-v1.json';
async function files(
  root: string,
  relative: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await fs.readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const child = relative + '/' + entry.name;
    if (entry.isDirectory()) {
      for (const [name, content] of Object.entries(await files(root, child)))
        result[entry.name + '/' + name] = content;
    } else
      result[entry.name] = digest(await fs.readFile(path.join(root, child)));
  }
  return result;
}

describe('resource merge recovery', () => {
  it('merges missing files, deduplicates identical bytes and preserves originals and Agent runtimes', async () => {
    const root = await directory();
    await put(root, legacy + '/assets/shared.bin', 'same');
    await put(root, legacy + '/assets/old.bin', 'old');
    await put(root, legacy + '/history/index.json', 'history');
    await put(root, managed + '/assets/shared.bin', 'same');
    await put(root, managed + '/assets/new.bin', 'new');
    await put(
      root,
      managed + '/runtime/node_modules/package/index.js',
      'runtime',
    );
    const before = await files(root, legacy);
    await migrateWorkspaceResourcesUnlocked(root);
    expect(await files(root, archived)).toEqual(before);
    expect(await files(root, managed)).toEqual({
      ...before,
      'assets/new.bin': digest('new'),
      'runtime/node_modules/package/index.js': digest('runtime'),
    });
    await expect(fs.stat(path.join(root, legacy))).rejects.toThrow();
    await expect(fs.readFile(path.join(root, marker), 'utf8')).resolves.toBe(
      '{"version":1}\n',
    );
    const after = await files(root, managed);
    await migrateWorkspaceResourcesUnlocked(root);
    expect(await files(root, managed)).toEqual(after);
  });

  it.each(['assets/z.bin', 'history/index.json'])(
    'publishes nothing when the full preflight finds a conflict at %s',
    async (key) => {
      const root = await directory();
      await put(root, legacy + '/assets/a-missing.bin', 'missing');
      await put(root, legacy + '/' + key, 'legacy');
      await put(root, managed + '/' + key, 'current');
      const before = await files(root, legacy);
      const current = await files(root, managed);
      await expect(migrateWorkspaceResourcesUnlocked(root)).rejects.toThrow(
        'different bytes',
      );
      expect(await files(root, legacy)).toEqual(before);
      expect(await files(root, managed)).toEqual(current);
      await expect(fs.stat(path.join(root, marker))).rejects.toThrow();
      await expect(fs.stat(path.join(root, archived))).rejects.toThrow();
    },
  );

  it('resumes after a publication failure without exposing partial bytes or deleting sources', async () => {
    const root = await directory();
    await put(root, legacy + '/assets/a.bin', 'first');
    await put(root, legacy + '/assets/b.bin', 'second');
    const before = await files(root, legacy);
    const link = fs.link;
    const mock = vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
      if (String(to).endsWith('/b.bin'))
        throw new Error('simulated publish failure');
      await link(from, to);
    });
    await expect(migrateWorkspaceResourcesUnlocked(root)).rejects.toThrow(
      'simulated publish failure',
    );
    expect(await files(root, legacy)).toEqual(before);
    expect(await files(root, managed)).toEqual({
      'assets/a.bin': digest('first'),
    });
    await expect(fs.stat(path.join(root, marker))).rejects.toThrow();
    mock.mockRestore();
    await migrateWorkspaceResourcesUnlocked(root);
    expect(await files(root, archived)).toEqual(before);
    expect(await files(root, managed)).toEqual(before);
  });

  it('never publishes an interrupted temporary write', async () => {
    const root = await directory();
    await put(root, legacy + '/assets/a.bin', 'complete original');
    const openFile = fs.open;
    const mock = vi
      .spyOn(fs, 'open')
      .mockImplementation(async (target, flags, mode) => {
        const handle = await openFile(target, flags, mode);
        if (String(target).includes('.resources-v1-') && flags === 'wx') {
          const write = handle.writeFile.bind(handle);
          vi.spyOn(handle, 'writeFile').mockImplementation(async () => {
            await write('partial');
            throw new Error('simulated interrupted copy');
          });
        }
        return handle;
      });
    await expect(migrateWorkspaceResourcesUnlocked(root)).rejects.toThrow(
      'simulated interrupted copy',
    );
    expect(await files(root, legacy)).toEqual({
      'assets/a.bin': digest('complete original'),
    });
    expect(await files(root, managed)).toEqual({});
    await expect(fs.stat(path.join(root, marker))).rejects.toThrow();
    mock.mockRestore();
    await migrateWorkspaceResourcesUnlocked(root);
    expect(await files(root, managed)).toEqual(await files(root, archived));
  });

  it.each([false, true])(
    'recovers an interruption %s after archiving',
    async (afterRename) => {
      const root = await directory();
      await put(root, legacy + '/assets/a.bin', 'original');
      const rename = fs.rename;
      const mock = vi
        .spyOn(fs, 'rename')
        .mockImplementation(async (from, to) => {
          if (afterRename) await rename(from, to);
          throw new Error('simulated archive interruption');
        });
      await expect(migrateWorkspaceResourcesUnlocked(root)).rejects.toThrow(
        'simulated archive interruption',
      );
      await expect(fs.stat(path.join(root, marker))).rejects.toThrow();
      mock.mockRestore();
      // An archived source is also sufficient to repair a missing publication.
      await fs.unlink(path.join(root, managed, 'assets/a.bin'));
      await migrateWorkspaceResourcesUnlocked(root);
      expect(await files(root, archived)).toEqual({
        'assets/a.bin': digest('original'),
      });
      expect(await files(root, managed)).toEqual(await files(root, archived));
    },
  );

  it('checks the archive again before marking completion and resumes added files', async () => {
    const root = await directory();
    await put(root, legacy + '/assets/a.bin', 'first');
    const rename = fs.rename;
    const mock = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to);
      await put(root, archived + '/assets/late.bin', 'late writer');
    });
    await expect(migrateWorkspaceResourcesUnlocked(root)).rejects.toThrow(
      'not published',
    );
    await expect(fs.stat(path.join(root, marker))).rejects.toThrow();
    mock.mockRestore();
    await migrateWorkspaceResourcesUnlocked(root);
    expect(await files(root, managed)).toEqual(await files(root, archived));
  });

  it.each(['same', 'different'])(
    'rechecks an existing destination on atomic publication: %s bytes',
    async (content) => {
      const root = await directory();
      await put(root, legacy + '/assets/a.bin', 'same');
      const link = fs.link;
      vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
        if (String(to).endsWith('/a.bin')) await fs.writeFile(to, content);
        await link(from, to);
      });
      if (content === 'same') {
        await migrateWorkspaceResourcesUnlocked(root);
        expect(await files(root, managed)).toEqual(await files(root, archived));
      } else {
        await expect(migrateWorkspaceResourcesUnlocked(root)).rejects.toThrow(
          'destination changed',
        );
        expect(await files(root, legacy)).toEqual({
          'assets/a.bin': digest('same'),
        });
        await expect(fs.stat(path.join(root, marker))).rejects.toThrow();
      }
    },
  );

  it('blocks both ambiguous archives and recreated legacy writers', async () => {
    const root = await directory();
    await put(root, legacy + '/assets/a.bin', 'source');
    await put(root, archived + '/assets/a.bin', 'archive');
    await expect(migrateWorkspaceResourcesUnlocked(root)).rejects.toThrow(
      'both exist',
    );
    await put(root, marker, '{"version":1}\n');
    await expect(migrateWorkspaceResourcesUnlocked(root)).rejects.toThrow(
      'older writer',
    );
    expect(await files(root, legacy)).toEqual({
      'assets/a.bin': digest('source'),
    });
    expect(await files(root, archived)).toEqual({
      'assets/a.bin': digest('archive'),
    });
  });

  it.each(['unknown.bin', 'assets/nested/hidden.bin', 'history/bad name.json'])(
    'preserves and rejects unexpected legacy entry %s',
    async (key) => {
      const root = await directory();
      await put(root, legacy + '/assets/a.bin', 'valid');
      await put(root, legacy + '/' + key, 'unknown');
      const before = await files(root, legacy);
      await expect(migrateWorkspaceResourcesUnlocked(root)).rejects.toThrow(
        'Resource migration conflict',
      );
      expect(await files(root, legacy)).toEqual(before);
      await expect(fs.stat(path.join(root, managed))).rejects.toThrow();
    },
  );

  it.each([
    legacy,
    legacy + '/assets',
    legacy + '/history/link.bin',
    '.verdscrolls',
    managed,
    managed + '/assets',
    managed + '/history/link.bin',
    '.verdscrolls/migration',
    archived,
    archived + '/assets',
    marker,
  ])(
    'rejects symlinks at %s without touching their target',
    async (relative) => {
      const root = await directory();
      const outside = await directory();
      await put(outside, 'kept.bin', 'do not change');
      await fs.mkdir(path.dirname(path.join(root, relative)), {
        recursive: true,
      });
      await fs.symlink(outside, path.join(root, relative));
      const before = await files(outside, '.');
      await expect(migrateWorkspaceResourcesUnlocked(root)).rejects.toThrow(
        'ordinary',
      );
      expect(await files(outside, '.')).toEqual(before);
      expect((await fs.lstat(path.join(root, relative))).isSymbolicLink()).toBe(
        true,
      );
    },
  );
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
