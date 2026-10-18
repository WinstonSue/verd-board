import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
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
    path.join(source, 'board.verd.json'),
    JSON.stringify({
      format: 'verd-frame',
      version: 2,
      frame: {
        id: 'board-root',
        cellType: 'frame',
        kind: 'frame',
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
        content: { type: 'doc', content: [] },
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
      development: false,
      pickDirectory: async () => null,
      ...extra,
    });
  return { dir, source, target, legacy, host, manager };
};

describe('desktop built-in workspace startup', () => {
  it('copies all content once, excludes runtime metadata and never overwrites edits on upgrade', async () => {
    const { source, target, legacy } = await setup();
    await fs.mkdir(path.join(source, '.verdboard'));
    await fs.writeFile(path.join(source, '.verdboard', 'session.json'), '{}');
    await seedBuiltinWorkspace(source, target, legacy);
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(target, '文档', 'reading.verd-doc.json'),
          'utf8',
        ),
      ).title,
    ).toBe('original');
    expect(await exists(path.join(target, '.verdboard'))).toBe(false);
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
    expect(await exists(path.join(target, 'board.verd.json'))).toBe(true);
    await fs.rm(target, { recursive: true });
    await fs.mkdir(path.join(target, '.verdboard'), { recursive: true });
    await fs.writeFile(
      path.join(target, '.verdboard', 'config.json'),
      JSON.stringify({ version: 1, value: { workspaceInitialized: true } }),
    );
    await seedBuiltinWorkspace(source, target, legacy);
    expect(await exists(path.join(target, 'board.verd.json'))).toBe(false);
  });

  it('rejects malformed or duplicate native identities before publishing', async () => {
    const { source, target, legacy } = await setup();
    await fs.copyFile(
      path.join(source, 'board.verd.json'),
      path.join(source, 'duplicate.verd.json'),
    );
    await expect(seedBuiltinWorkspace(source, target, legacy)).rejects.toThrow(
      'duplicate',
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
