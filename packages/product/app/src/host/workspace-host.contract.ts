import { describe, expect, it } from 'vitest';
import type {
  CommitReceipt,
  FileVersion,
  WorkspaceHandle,
  WorkspaceHost,
  WorkspaceHostSnapshot,
} from './workspace-host';
import { CANVAS_FILE_SUFFIX } from './workspace-host';

export interface WorkspaceHostContractContext {
  host: WorkspaceHost;
  /** Opens (or creates) a fresh workspace and returns its handle. */
  open: () => Promise<WorkspaceHandle>;
}

const text = (value: string) => new TextEncoder().encode(value);
const decode = (content: Uint8Array) => new TextDecoder().decode(content);

const canvasJson = (frameId: string) =>
  JSON.stringify({
    format: 'verd-frame',
    version: 2,
    frame: {
      id: frameId,
      kind: 'frame',
      cellType: 'frame',
      geometry: { x: 0, y: 0, width: 960, height: 640 },
      children: [],
      groups: [],
    },
    cells: {},
  });

const tx = () => `tx-${Math.random().toString(36).slice(2)}`;

const applied = (receipt: CommitReceipt) => {
  expect(receipt.outcome).toBe('applied');
  return receipt;
};

const fileEntry = (snapshot: WorkspaceHostSnapshot, path: string) =>
  snapshot.entries.find((entry) => entry.path === path);

const fileVersion = (snapshot: WorkspaceHostSnapshot, path: string) =>
  fileEntry(snapshot, path)?.version as FileVersion;

/**
 * Unified behavioral contract every WorkspaceHost must satisfy: atomic
 * commits, content-version checks, trash/restore, config CAS, session state,
 * idempotent transactions, change hints and path safety.
 */
export const describeWorkspaceHostContract = (
  name: string,
  createContext: () => Promise<WorkspaceHostContractContext>,
) => {
  describe(`${name} contract`, () => {
    it('creates a default workspace with initialized config', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      const snapshot = await host.readSnapshot(handle);
      expect(snapshot.config.version).toBeGreaterThanOrEqual(1);
      expect(snapshot.session).toBeNull();
      expect(snapshot.entries).toEqual([]);
      expect(snapshot.canvases).toEqual([]);
    });

    it('writes a new file and exposes it through the snapshot', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      const receipt = applied(
        await host.commit(handle, {
          transactionId: tx(),
          writes: [
            {
              path: 'notes/readme.md',
              content: 'hello',
              expectedVersion: null,
            },
          ],
        }),
      );
      expect(receipt.versions?.['notes/readme.md']).toBeTruthy();
      const snapshot = await host.readSnapshot(handle);
      expect(fileVersion(snapshot, 'notes/readme.md')).toBe(
        receipt.versions?.['notes/readme.md'],
      );
      expect(fileEntry(snapshot, 'notes')?.kind).toBe('directory');
      const raw = await host.readFile(handle, 'notes/readme.md');
      expect(decode(raw.content)).toBe('hello');
      expect(raw.version).toBe(receipt.versions?.['notes/readme.md']);
    });

    it('rejects create-writes over existing files and stale versions', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      const first = applied(
        await host.commit(handle, {
          transactionId: tx(),
          writes: [{ path: 'a.txt', content: '1', expectedVersion: null }],
        }),
      );
      const duplicate = await host.commit(handle, {
        transactionId: tx(),
        writes: [{ path: 'a.txt', content: '2', expectedVersion: null }],
      });
      expect(duplicate.outcome).toBe('rejected');
      expect(duplicate.reason).toBe('target-exists');
      const stale = await host.commit(handle, {
        transactionId: tx(),
        writes: [{ path: 'a.txt', content: '2', expectedVersion: 'v-stale' }],
      });
      expect(stale.outcome).toBe('rejected');
      expect(stale.reason).toBe('version-conflict');
      expect(stale.actual).toBe(first.versions?.['a.txt']);
      const update = applied(
        await host.commit(handle, {
          transactionId: tx(),
          writes: [
            {
              path: 'a.txt',
              content: '2',
              expectedVersion: first.versions?.['a.txt'] ?? null,
            },
          ],
        }),
      );
      expect(update.versions?.['a.txt']).not.toBe(first.versions?.['a.txt']);
      expect(decode((await host.readFile(handle, 'a.txt')).content)).toBe('2');
    });

    it('applies or rejects a batch atomically', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      await host.commit(handle, {
        transactionId: tx(),
        writes: [{ path: 'exists.txt', content: 'x', expectedVersion: null }],
      });
      const receipt = await host.commit(handle, {
        transactionId: tx(),
        writes: [
          { path: 'good.txt', content: 'y', expectedVersion: null },
          { path: 'exists.txt', content: 'z', expectedVersion: null },
        ],
      });
      expect(receipt.outcome).toBe('rejected');
      const snapshot = await host.readSnapshot(handle);
      expect(fileEntry(snapshot, 'good.txt')).toBeUndefined();
    });

    it('replays the same transactionId with the recorded receipt', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      const transactionId = tx();
      const first = applied(
        await host.commit(handle, {
          transactionId,
          writes: [{ path: 'once.txt', content: 'a', expectedVersion: null }],
        }),
      );
      const second = await host.commit(handle, {
        transactionId,
        writes: [
          {
            path: 'once.txt',
            content: 'b',
            expectedVersion: first.versions?.['once.txt'] ?? null,
          },
        ],
      });
      expect(second).toEqual(first);
      expect(decode((await host.readFile(handle, 'once.txt')).content)).toBe(
        'a',
      );
    });

    it('creates and guards directories', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      applied(
        await host.commit(handle, {
          transactionId: tx(),
          mkdirs: ['docs/inner'],
        }),
      );
      const snapshot = await host.readSnapshot(handle);
      expect(fileEntry(snapshot, 'docs')?.kind).toBe('directory');
      expect(fileEntry(snapshot, 'docs/inner')?.kind).toBe('directory');
      const again = await host.commit(handle, {
        transactionId: tx(),
        mkdirs: ['docs/inner'],
      });
      expect(again.outcome).toBe('rejected');
      expect(again.reason).toBe('target-exists');
    });

    it('moves files with version checks and moves whole directories', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      const created = applied(
        await host.commit(handle, {
          transactionId: tx(),
          writes: [
            { path: 'dir/f.txt', content: 'payload', expectedVersion: null },
          ],
        }),
      );
      const wrong = await host.commit(handle, {
        transactionId: tx(),
        moves: [
          { from: 'dir/f.txt', to: 'dir/g.txt', expectedVersion: 'v-nope' },
        ],
      });
      expect(wrong.reason).toBe('version-conflict');
      applied(
        await host.commit(handle, {
          transactionId: tx(),
          moves: [
            {
              from: 'dir/f.txt',
              to: 'dir/g.txt',
              expectedVersion: created.versions?.['dir/f.txt'],
            },
          ],
        }),
      );
      let snapshot = await host.readSnapshot(handle);
      expect(fileEntry(snapshot, 'dir/f.txt')).toBeUndefined();
      expect(decode((await host.readFile(handle, 'dir/g.txt')).content)).toBe(
        'payload',
      );
      applied(
        await host.commit(handle, {
          transactionId: tx(),
          moves: [{ from: 'dir', to: 'renamed' }],
        }),
      );
      snapshot = await host.readSnapshot(handle);
      expect(fileEntry(snapshot, 'renamed/g.txt')?.kind).toBe('file');
      expect(fileEntry(snapshot, 'dir')).toBeUndefined();
    });

    it('trashes and restores files and directories', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      const created = applied(
        await host.commit(handle, {
          transactionId: tx(),
          writes: [
            { path: 'keep.txt', content: 'k', expectedVersion: null },
            { path: 'folder/deep.txt', content: 'd', expectedVersion: null },
          ],
        }),
      );
      const stale = await host.commit(handle, {
        transactionId: tx(),
        trash: [{ path: 'keep.txt', expectedVersion: 'v-bad' }],
      });
      expect(stale.reason).toBe('version-conflict');
      const trashed = applied(
        await host.commit(handle, {
          transactionId: tx(),
          trash: [
            {
              path: 'keep.txt',
              expectedVersion: created.versions?.['keep.txt'],
            },
            { path: 'folder' },
          ],
        }),
      );
      expect(trashed.trashEntries).toHaveLength(2);
      let snapshot = await host.readSnapshot(handle);
      expect(fileEntry(snapshot, 'keep.txt')).toBeUndefined();
      expect(fileEntry(snapshot, 'folder/deep.txt')).toBeUndefined();
      const restoreFile = trashed.trashEntries?.find(
        (entry) => entry.path === 'keep.txt',
      );
      applied(
        await host.commit(handle, {
          transactionId: tx(),
          restore: [{ entryId: restoreFile!.entryId }],
        }),
      );
      snapshot = await host.readSnapshot(handle);
      expect(decode((await host.readFile(handle, 'keep.txt')).content)).toBe(
        'k',
      );
      const again = await host.commit(handle, {
        transactionId: tx(),
        restore: [{ entryId: restoreFile!.entryId }],
      });
      expect(again.reason).toBe('source-missing');
      const restoreDir = trashed.trashEntries?.find(
        (entry) => entry.path === 'folder',
      );
      applied(
        await host.commit(handle, {
          transactionId: tx(),
          restore: [{ entryId: restoreDir!.entryId, toPath: 'archive/folder' }],
        }),
      );
      expect(
        decode(
          (await host.readFile(handle, 'archive/folder/deep.txt')).content,
        ),
      ).toBe('d');
    });

    it('rejects restores into occupied paths', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      const created = applied(
        await host.commit(handle, {
          transactionId: tx(),
          writes: [{ path: 'p.txt', content: '1', expectedVersion: null }],
        }),
      );
      const trashed = applied(
        await host.commit(handle, {
          transactionId: tx(),
          trash: [
            { path: 'p.txt', expectedVersion: created.versions?.['p.txt'] },
          ],
        }),
      );
      applied(
        await host.commit(handle, {
          transactionId: tx(),
          writes: [{ path: 'p.txt', content: '2', expectedVersion: null }],
        }),
      );
      const restore = await host.commit(handle, {
        transactionId: tx(),
        restore: [{ entryId: trashed.trashEntries![0].entryId }],
      });
      expect(restore.outcome).toBe('rejected');
      expect(restore.reason).toBe('target-exists');
      expect(decode((await host.readFile(handle, 'p.txt')).content)).toBe('2');
    });

    it('round-trips workspace config with CAS and session state', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      const snapshot = await host.readSnapshot(handle);
      const bad = await host.commit(handle, {
        transactionId: tx(),
        config: { value: { mindDefaultWidth: 300 }, expectedVersion: 99 },
      });
      expect(bad.reason).toBe('version-conflict');
      applied(
        await host.commit(handle, {
          transactionId: tx(),
          config: {
            value: { mindDefaultWidth: 300 },
            expectedVersion: snapshot.config.version,
          },
          session: {
            tabs: [{ fileId: 'f1' }],
            activeTabId: 'f1',
            expandedDirs: ['docs'],
          },
        }),
      );
      const next = await host.readSnapshot(handle);
      expect(next.config.value['mindDefaultWidth']).toBe(300);
      expect(next.session?.tabs).toEqual([{ fileId: 'f1' }]);
      expect(next.session?.activeTabId).toBe('f1');
      expect(next.session?.expandedDirs).toEqual(['docs']);
    });

    it('parses canvas files and reports diagnostics for bad payloads', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      applied(
        await host.commit(handle, {
          transactionId: tx(),
          writes: [
            {
              path: `board${CANVAS_FILE_SUFFIX}`,
              content: canvasJson('frame-1'),
              expectedVersion: null,
            },
            {
              path: `broken${CANVAS_FILE_SUFFIX}`,
              content: '{ not json',
              expectedVersion: null,
            },
          ],
        }),
      );
      const snapshot = await host.readSnapshot(handle);
      const good = snapshot.canvases.find(
        (canvas) => canvas.path === `board${CANVAS_FILE_SUFFIX}`,
      );
      expect(good?.file?.frame.id).toBe('frame-1');
      const broken = snapshot.canvases.find(
        (canvas) => canvas.path === `broken${CANVAS_FILE_SUFFIX}`,
      );
      expect(broken?.file).toBeNull();
      expect(broken?.diagnostic).toBeTruthy();
      expect(
        snapshot.diagnostics.some(
          (d) => d.path === `broken${CANVAS_FILE_SUFFIX}`,
        ),
      ).toBe(true);
    });

    it('emits change hints after commits', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      const hints: string[][] = [];
      const unsub = host.subscribe(handle, (hint) =>
        hints.push(hint.paths ?? []),
      );
      await host.commit(handle, {
        transactionId: tx(),
        writes: [{ path: 'watched.txt', content: 'x', expectedVersion: null }],
      });
      expect(hints.flat()).toContain('watched.txt');
      unsub();
    });

    it('compare-and-swaps the global config', async () => {
      const { host } = await createContext();
      const initial = await host.readGlobalConfig();
      const bad = await host.writeGlobalConfig({ lang: 'zh' }, 999);
      expect(bad.applied).toBe(false);
      const good = await host.writeGlobalConfig(
        { lang: 'zh' },
        initial.version,
      );
      expect(good.applied).toBe(true);
      expect(good.snapshot.value['lang']).toBe('zh');
      expect((await host.readGlobalConfig()).value['lang']).toBe('zh');
    });

    it('resolves conflicts as single atomic commits', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      const created = applied(
        await host.commit(handle, {
          transactionId: tx(),
          writes: [{ path: 'c.txt', content: 'disk', expectedVersion: null }],
        }),
      );
      void created;
      // keep-local: disk bytes are archived and local content publishes.
      applied(
        await host.resolveConflict(handle, {
          path: 'c.txt',
          action: 'keep-local',
          content: 'local',
          transactionId: tx(),
        }),
      );
      expect(decode((await host.readFile(handle, 'c.txt')).content)).toBe(
        'local',
      );
      // save-copy: original stays untouched, local bytes land elsewhere.
      applied(
        await host.resolveConflict(handle, {
          path: 'c.txt',
          action: 'save-copy',
          toPath: 'c-copy.txt',
          content: 'fork',
          transactionId: tx(),
        }),
      );
      expect(decode((await host.readFile(handle, 'c.txt')).content)).toBe(
        'local',
      );
      expect(decode((await host.readFile(handle, 'c-copy.txt')).content)).toBe(
        'fork',
      );
      // load-disk: an applied no-op commit; the app re-reads afterwards.
      const noop = await host.resolveConflict(handle, {
        path: 'c.txt',
        action: 'load-disk',
        transactionId: tx(),
      });
      expect(noop.outcome).toBe('applied');
    });

    it('rejects paths escaping the workspace root', async () => {
      const { host, open } = await createContext();
      const handle = await open();
      const receipt = await host.commit(handle, {
        transactionId: tx(),
        writes: [{ path: '../evil.txt', content: 'x', expectedVersion: null }],
      });
      expect(receipt.outcome).toBe('rejected');
      expect(receipt.reason).toBe('invalid');
      const meta = await host.commit(handle, {
        transactionId: tx(),
        writes: [
          {
            path: '.verdboard/hack.txt',
            content: 'x',
            expectedVersion: null,
          },
        ],
      });
      expect(meta.outcome).toBe('rejected');
      expect(meta.reason).toBe('invalid');
    });
  });
};
