import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFsWorkspaceHost } from './workspace-host-fs';
import {
  createDesktopWorkspaceManager,
  seedBuiltinWorkspace,
} from './workspace-startup';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const exists = (target: string) =>
  fs.access(target).then(
    () => true,
    () => false,
  );
const setup = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-startup-'));
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source');
  const target = path.join(dir, 'user-data', 'workspaces', 'default');
  const legacy = path.join(dir, 'user-data', 'verdboard-data.json');
  await fs.mkdir(path.join(source, '文档'), { recursive: true });
  await fs.writeFile(
    path.join(source, 'board.verd'),
    JSON.stringify({
      format: 'verd-frame',
      version: 2,
      frame: {
        id: 'board-root',
        cellType: 'frame',
        kind: 'frame',
        geometry: { x: 0, y: 0, width: 960, height: 640 },
        children: [],
        groups: [],
      },
      cells: {},
    }),
  );
  await fs.writeFile(
    path.join(source, '文档', 'reading.verd-doc.json'),
    JSON.stringify({
      format: 'verd-document',
      version: 1,
      id: 'reading',
      title: 'original',
      text: {
        id: 'reading',
        kind: 'block',
        schemaVersion: 1,
        plainText: '',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    }),
  );
  await fs.mkdir(path.join(source, '.verdscrolls'), { recursive: true });
  await fs.writeFile(path.join(source, 'AGENTS.md'), '# Built-in project');
  await fs.writeFile(path.join(source, '.verdscrolls/.gitignore'), '*');
  await fs.writeFile(
    path.join(source, '.verdscrolls/config.json'),
    JSON.stringify({
      version: 1,
      value: {
        identity: 'template',
        name: 'Test project',
        project: { description: 'Test', entryDocumentIds: ['board-root'] },
      },
    }),
  );
  const host = createFsWorkspaceHost({
    defaultRoot: () => target,
    globalConfigPath: () => path.join(dir, 'user-data', 'global.json'),
  });
  cleanups.push(async () => {
    await host.waitIdle();
    for (const workspace of [...host.workspaces.values()])
      await host.closeWorkspace({ key: workspace.id, name: workspace.name });
  });
  const manager = (extra = {}) =>
    createDesktopWorkspaceManager({
      host,
      defaultRoot: () => target,
      builtinSource: () => source,
      legacyStorage: () => legacy,
      pickDirectory: async () => null,
      ...extra,
    });
  return { dir, source, target, legacy, host, manager };
};

describe('desktop built-in workspace startup', () => {
  it('copies all content once, excludes runtime metadata and never overwrites edits on upgrade', async () => {
    const { source, target, legacy } = await setup();
    await fs.mkdir(path.join(source, '.verdscrolls'), { recursive: true });
    await fs.writeFile(path.join(source, '.verdscrolls', 'session.json'), '{}');
    await seedBuiltinWorkspace(source, target, legacy);
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(target, '文档', 'reading.verd-doc.json'),
          'utf8',
        ),
      ).title,
    ).toBe('original');
    expect(
      await exists(path.join(target, '.verdscrolls', 'session.json')),
    ).toBe(false);
    await fs.writeFile(
      path.join(target, '文档', 'reading.verd-doc.json'),
      'user edit',
    );
    await fs.writeFile(
      path.join(source, '文档', 'reading.verd-doc.json'),
      'new release',
    );
    await seedBuiltinWorkspace(source, target, legacy);
    expect(
      await fs.readFile(
        path.join(target, '文档', 'reading.verd-doc.json'),
        'utf8',
      ),
    ).toBe('user edit');
  });

  it('seeds an existing empty folder but preserves a deliberately emptied initialized workspace', async () => {
    const { source, target, legacy } = await setup();
    await fs.mkdir(target, { recursive: true });
    await seedBuiltinWorkspace(source, target, legacy);
    expect(await exists(path.join(target, 'board.verd'))).toBe(true);
    await fs.rm(target, { recursive: true });
    await fs.mkdir(path.join(target, '.verdscrolls'), { recursive: true });
    await fs.writeFile(
      path.join(target, '.verdscrolls', 'config.json'),
      JSON.stringify({
        version: 1,
        value: { identity: 'legacy-project', workspaceInitialized: true },
      }),
    );
    await seedBuiltinWorkspace(source, target, legacy);
    expect(await exists(path.join(target, 'board.verd'))).toBe(false);
  });

  it('rejects malformed or duplicate native identities before publishing', async () => {
    const { source, target, legacy } = await setup();
    await fs.copyFile(
      path.join(source, 'board.verd'),
      path.join(source, 'duplicate.verd'),
    );
    await expect(seedBuiltinWorkspace(source, target, legacy)).rejects.toThrow(
      'Duplicate',
    );
    expect(await exists(target)).toBe(false);
  });

  it('leaves legacy records for migration and surfaces corruption instead of seeding over them', async () => {
    const { source, target, legacy } = await setup();
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(
      legacy,
      JSON.stringify({ main_board_content: { old: true } }),
    );
    await seedBuiltinWorkspace(source, target, legacy);
    expect(await exists(target)).toBe(false);
    await fs.writeFile(legacy, 'corrupt');
    await expect(seedBuiltinWorkspace(source, target, legacy)).rejects.toThrow(
      'Corrupt storage',
    );
    expect(await exists(target)).toBe(false);
    expect(await fs.readFile(`${legacy}.bak`, 'utf8')).toBe('corrupt');
  });

  it('does not publish a partial directory when copying fails and can retry', async () => {
    const { source, target, legacy } = await setup();
    await expect(
      seedBuiltinWorkspace(`${source}-missing`, target, legacy),
    ).rejects.toThrow();
    expect(await exists(target)).toBe(false);
    expect(
      (await fs.readdir(path.dirname(target))).filter((name) =>
        name.includes('.seed-'),
      ),
    ).toEqual([]);
    await seedBuiltinWorkspace(source, target, legacy);
    expect(await exists(target)).toBe(true);
  });

  it('remembers only activated folders, preserves device config, and exposes a missing-folder recovery path', async () => {
    const { dir, target, host, manager } = await setup();
    await host.writeGlobalConfig({ language: 'en' }, 0);
    const custom = path.join(dir, 'custom');
    const first = manager();
    const builtin = (await first.open())!;
    expect(builtin.isDefault).toBe(true);
    await first.activate(builtin);
    const picked = manager({ pickDirectory: async () => custom });
    const handle = (await picked.open({ pick: true }))!;
    expect(handle.isDefault).toBe(false);
    expect((await manager().open())!.key).toBe(builtin.key);
    await picked.activate(handle);
    expect((await manager().open())!.key).toBe(handle.key);
    expect((await host.readGlobalConfig()).value['language']).toBe('en');
    await host.closeWorkspace(handle);
    await fs.rm(custom, { recursive: true });
    await expect(manager().open()).rejects.toThrow('unavailable');
    expect(await exists(custom)).toBe(false);
    const recovered = (await manager().open({ default: true }))!;
    expect(recovered.isDefault).toBe(true);
    expect(await exists(target)).toBe(true);
    expect(await manager().open({ pick: true })).toBeNull();
  });

  it('uses an explicit isolated folder without seeding it and shares concurrent default initialization', async () => {
    const { dir, target, manager } = await setup();
    const explicit = path.join(dir, 'isolated');
    const handle = (await manager({ explicitRoot: explicit }).open())!;
    expect(handle.isDefault).toBe(false);
    expect(await exists(path.join(explicit, '文档'))).toBe(false);
    expect(await exists(target)).toBe(false);
    const startup = manager();
    const [a, b] = await Promise.all([startup.open(), startup.open()]);
    expect(a?.key).toBe(b?.key);
    expect(
      await exists(path.join(target, '文档', 'reading.verd-doc.json')),
    ).toBe(true);
  });
});

describe('desktop workspace history', () => {
  it('recovers old folders once without selecting them or changing old data', async () => {
    const { dir, target, host, manager } = await setup();
    const oldRoot = path.join(dir, 'desktop');
    const oldDefault = path.join(oldRoot, 'workspaces', 'default');
    const custom = path.join(dir, 'custom');
    await fs.mkdir(path.join(oldDefault, '.verdscrolls'), { recursive: true });
    await fs.writeFile(
      path.join(oldDefault, '.verdscrolls', 'config.json'),
      JSON.stringify({
        version: 1,
        value: { identity: 'legacy-project', workspaceInitialized: true },
      }),
    );
    await fs.writeFile(path.join(oldDefault, 'old.verd'), 'old user content');
    const original = JSON.stringify({
      version: 1,
      value: {
        desktopWorkspace: { kind: 'directory', path: custom },
      },
    });
    await fs.writeFile(
      path.join(oldRoot, 'verdboard-global-config.json'),
      original,
    );
    const startup = manager({ legacyUserDataRoot: oldRoot });
    const builtin = (await startup.open())!;
    expect(builtin.isDefault).toBe(true);
    expect(await exists(path.join(target, 'board.verd'))).toBe(true);
    expect((await startup.listHistory()).map((entry) => entry.name)).toEqual([
      'custom',
      '旧工作区 (desktop)',
    ]);
    const old = (await startup.listHistory()).find(
      (entry) => entry.name === '旧工作区 (desktop)',
    )!;
    const restored = await startup.open({ historyId: old.id });
    expect(restored?.isDefault).toBe(false);
    expect(await fs.readFile(path.join(oldDefault, 'old.verd'), 'utf8')).toBe(
      'old user content',
    );
    expect(
      await fs.readFile(
        path.join(oldRoot, 'verdboard-global-config.json'),
        'utf8',
      ),
    ).toBe(original);
    const config = await host.readGlobalConfig();
    expect(config.value['desktopWorkspace']).toBeUndefined();
    await manager({ legacyUserDataRoot: oldRoot }).listHistory();
    expect((await host.readGlobalConfig()).version).toBe(config.version);
  });

  it('records only activated directories, keeps all entries and deduplicates normalized paths', async () => {
    const { dir, host, manager } = await setup();
    const startup = manager({ now: () => 100 });
    const builtin = (await startup.open({ default: true }))!;
    await startup.activate(builtin);
    expect(await startup.listHistory()).toEqual([]);
    const first = (await startup.open({ path: path.join(dir, 'first') }))!;
    expect(await startup.listHistory()).toEqual([]);
    await startup.activate(first);
    for (let index = 0; index < 21; index++) {
      const handle = (await startup.open({
        path: path.join(dir, `folder-${index}`),
      }))!;
      await startup.activate(handle);
    }
    const again = (await startup.open({
      path: path.join(dir, 'first', '..', 'first'),
    }))!;
    await startup.activate(again);
    const entries = await startup.listHistory();
    expect(entries).toHaveLength(22);
    expect(entries[0]).toMatchObject({ id: first.historyId, name: 'first' });
    expect(entries[0].lastOpenedAt).toBeGreaterThan(entries[1].lastOpenedAt);
    expect(again.historyId).toBe(first.historyId);
    expect(first.historyId).not.toBe(first.key);
    expect(await manager().listHistory()).toEqual(entries);
    expect(JSON.stringify(entries)).not.toContain(dir);
    expect(
      (await host.readGlobalConfig()).value['desktopWorkspaceHistory'],
    ).toHaveLength(22);
    expect(await startup.open({ pick: true })).toBeNull();
    expect(await startup.listHistory()).toEqual(entries);
  });

  it('migrates the old selection, preserves preferences and retains missing folders without recreating them', async () => {
    const { dir, host, manager } = await setup();
    const missing = path.join(dir, 'missing');
    await host.writeGlobalConfig(
      {
        language: 'en',
        desktopWorkspace: { kind: 'directory', path: missing },
      },
      0,
    );
    const startup = manager();
    const entries = await startup.listHistory();
    expect(entries).toEqual([
      {
        id: expect.any(String),
        name: 'missing',
        lastOpenedAt: 0,
        pinned: false,
        availability: 'missing',
      },
    ]);
    await expect(
      startup.open({ historyId: entries[0].id, create: true }),
    ).rejects.toThrow('unavailable');
    await expect(
      startup.open({
        historyId: 'unknown',
        path: path.join(dir, 'accidental'),
      }),
    ).rejects.toThrow('Unknown');
    expect(await exists(missing)).toBe(false);
    expect(await exists(path.join(dir, 'accidental'))).toBe(false);
    expect(await startup.listHistory()).toEqual(entries);
    const builtin = (await startup.open({ default: true }))!;
    await startup.activate(builtin);
    expect(await manager().listHistory()).toEqual(entries);
    expect((await host.readGlobalConfig()).value).toMatchObject({
      language: 'en',
      desktopWorkspace: { kind: 'default' },
    });
  });

  it('identifies the installed recommendation workspace by directory', async () => {
    const { dir, manager } = await setup();
    const patterns = path.join(
      dir,
      'user-data',
      'workspaces',
      'agent-patterns',
    );
    const startup = manager({ patternRoot: () => patterns });
    const bundled = (await startup.open({
      path: patterns,
      name: '文档编写推荐库',
    }))!;
    await startup.activate(bundled);
    const personal = (await startup.open({
      path: path.join(dir, 'projects', '文档编写推荐库'),
      name: '文档编写推荐库',
    }))!;
    await startup.activate(personal);
    const entries = await startup.listHistory();
    expect(entries.find((entry) => entry.id === bundled.historyId)?.kind).toBe(
      'agent-patterns',
    );
    expect(
      entries.find((entry) => entry.id === personal.historyId),
    ).toMatchObject({
      name: '文档编写推荐库',
      directoryHint: 'projects',
    });
    expect(
      entries.find((entry) => entry.id === personal.historyId)?.kind,
    ).toBeUndefined();
  });

  it('reopens stable history identities after closing handles and distinguishes identical folder names', async () => {
    const { dir, host, manager } = await setup();
    const startup = manager();
    const left = (await startup.open({
      path: path.join(dir, 'left', 'shared', 'project'),
    }))!;
    await startup.activate(left);
    const right = (await startup.open({
      path: path.join(dir, 'right', 'shared', 'project'),
    }))!;
    await startup.activate(right);
    const entries = await startup.listHistory();
    expect(entries.map((entry) => entry.description)).toEqual([
      'right/shared',
      'left/shared',
    ]);
    await host.closeWorkspace(left);
    const restarted = manager();
    const reopened = (await restarted.open({ historyId: left.historyId }))!;
    expect(reopened.key).not.toBe(left.key);
    expect(reopened.historyId).toBe(left.historyId);
    expect(await restarted.listHistory()).toEqual(entries);
    await restarted.activate(reopened);
    expect((await restarted.listHistory())[0].id).toBe(left.historyId);
  });

  it('retries conflicting config writes without losing history or unrelated preferences', async () => {
    const { dir, host, manager } = await setup();
    const startup = manager();
    const first = (await startup.open({ path: path.join(dir, 'a') }))!;
    await startup.activate(first);
    const write = host.writeGlobalConfig.bind(host);
    vi.spyOn(host, 'writeGlobalConfig').mockImplementationOnce(
      async (_value, version) => {
        await write(
          { ...(await host.readGlobalConfig()).value, language: 'en' },
          version,
        );
        return { applied: false, snapshot: await host.readGlobalConfig() };
      },
    );
    const second = (await startup.open({ path: path.join(dir, 'b') }))!;
    await startup.activate(second);
    expect((await startup.listHistory()).map((entry) => entry.name)).toEqual([
      'b',
      'a',
    ]);
    expect((await host.readGlobalConfig()).value['language']).toBe('en');
  });

  it('serializes competing global configuration writes so CAS cannot silently lose history', async () => {
    const { host } = await setup();
    const results = await Promise.all([
      host.writeGlobalConfig({ desktopWorkspaceHistory: [] }, 0),
      host.writeGlobalConfig({ language: 'en' }, 0),
    ]);
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    expect((await host.readGlobalConfig()).version).toBe(1);
  });
});

it('creates an empty desktop workspace, pins its record and removes only history', async () => {
  const { dir, host, manager } = await setup();
  const startup = manager({ pickDirectory: async () => dir });
  const handle = (await startup.create({ name: 'Notes' }))!;
  expect((await host.readSnapshot(handle)).canvases).toHaveLength(0);
  await startup.activate(handle);
  await startup.updateHistory({ id: handle.historyId!, pinned: true });
  expect(
    (await startup.listHistory()).find((e) => e.id === handle.historyId)
      ?.pinned,
  ).toBe(true);
  await expect(
    startup.updateHistory({ id: handle.historyId!, remove: true }),
  ).rejects.toThrow('current');
  const builtin = (await startup.open({ default: true }))!;
  await startup.activate(builtin);
  await startup.updateHistory({ id: handle.historyId!, remove: true });
  expect(
    (await startup.listHistory()).some((e) => e.id === handle.historyId),
  ).toBe(false);
  expect(await exists(path.join(dir, 'Notes'))).toBe(true);
});

it('reads saved names for history and cached handles without opening folders or changing order', async () => {
  const { dir, host, manager } = await setup();
  const root = path.join(dir, 'named-workspace');
  const policy = manager();
  const handle = await policy.open({ path: root });
  await policy.activate(handle);
  const before = (await policy.listHistory())[0];
  const config = (await host.readSnapshot(handle)).config;
  expect(
    (
      await host.commit(handle, {
        transactionId: 'rename-test',
        config: {
          expectedVersion: config.version,
          value: { ...config.value, name: 'New name' },
        },
      })
    ).outcome,
  ).toBe('applied');
  const open = vi.spyOn(host, 'openWorkspace');
  const snapshot = vi.spyOn(host, 'readSnapshot');
  expect((await policy.listHistory())[0]).toEqual({
    ...before,
    name: 'New name',
  });
  expect(open).not.toHaveBeenCalled();
  expect(snapshot).not.toHaveBeenCalled();
  expect((await policy.open({ path: root })).name).toBe('New name');
});
