import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serializeWorkspaceSkill } from '@sue/verd-board-app/headless';
import { initializeWorkspaceProject } from './workspace-init';
import { readWorkspaceProjectContext } from './workspace-project';
import { readNativeSnapshot } from './workspace-lock';
import { createFsWorkspaceHost } from './workspace-host-fs';
import { prepareAuthoringBatch } from '../authoring';
import { applyPreparedBatch } from '../apply';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});
const relative = '.agents/skills/verd-workspace/SKILL.md';
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-skills-'));
  roots.push(root);
  await initializeWorkspaceProject(root);
  const write = async (target: string, body: string) => {
    await fs.mkdir(path.dirname(path.join(root, target)), { recursive: true });
    await fs.writeFile(
      path.join(root, target),
      serializeWorkspaceSkill(target, {
        description: 'Project instructions',
        body,
      }),
    );
  };
  return { root, write };
}
describe('workspace Skill context and plans', () => {
  it('lists common and selected-pattern metadata without copying bodies into config, and survives repair', async () => {
    const { root, write } = await setup();
    const specific = '.agents/skills/verd-pattern-architecture/SKILL.md';
    await write(relative, 'Use Chinese.');
    await write(specific, 'Use domain vocabulary.');
    const source = await fs.readFile(path.join(root, relative), 'utf8');
    const context = await readWorkspaceProjectContext(root);
    expect(context.workspaceSkills).toEqual([
      {
        scope: 'workspace',
        name: 'verd-workspace',
        path: relative,
        description: 'Project instructions',
      },
      {
        scope: 'pattern',
        patternId: 'architecture',
        name: 'verd-pattern-architecture',
        path: specific,
        description: 'Project instructions',
      },
    ]);
    expect(
      await fs.readFile(path.join(root, '.verdscrolls/config.json'), 'utf8'),
    ).not.toContain('Use Chinese');
    await initializeWorkspaceProject(root);
    expect(await fs.readFile(path.join(root, relative), 'utf8')).toBe(source);
    expect((await readNativeSnapshot(root)).entries).toEqual([]);
  });
  it('invalidates old plans on creation, edit and removal, including independent custom Skills', async () => {
    const { root, write } = await setup();
    const initial = await readNativeSnapshot(root);
    const operations = [
      {
        type: 'file.create' as const,
        kind: 'document' as const,
        id: 'doc',
        title: 'Doc',
        path: 'doc.verd-doc.json',
      },
    ];
    const plan = await prepareAuthoringBatch(initial, operations);
    await write(relative, 'First');
    const created = await readNativeSnapshot(root);
    expect(created.version).not.toBe(initial.version);
    await expect(applyPreparedBatch(root, plan)).rejects.toThrow();
    await write(relative, 'Second');
    const edited = await readNativeSnapshot(root);
    expect(edited.version).not.toBe(created.version);
    await fs.mkdir(path.join(root, '.agents/skills/other'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, '.agents/skills/other/SKILL.md'),
      '---\nname: other\ndescription: Independent instructions\n---\nUse domain terms.',
    );
    expect((await readNativeSnapshot(root)).version).not.toBe(edited.version);
    expect((await readWorkspaceProjectContext(root)).workspaceSkills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'custom',
          name: 'other',
          description: 'Independent instructions',
        }),
      ]),
    );
    await fs.unlink(path.join(root, '.agents/skills/other/SKILL.md'));
    await fs.unlink(path.join(root, relative));
    expect((await readNativeSnapshot(root)).version).toBe(initial.version);
  });
  it('preserves malformed custom Skills and reports warnings without blocking valid instructions', async () => {
    const { root, write } = await setup();
    await write('.agents/skills/domain-writing/SKILL.md', 'Use domain terms.');
    const broken = path.join(root, '.agents/skills/broken/SKILL.md');
    await fs.mkdir(path.dirname(broken), { recursive: true });
    await fs.writeFile(broken, 'Broken source');
    const snapshot = await readNativeSnapshot(root);
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'workspace.skill-invalid',
          severity: 'warning',
        }),
      ]),
    );
    expect(snapshot.diagnostics.some((item) => item.severity === 'error')).toBe(
      false,
    );
    expect(
      (await readWorkspaceProjectContext(root)).workspaceSkills.map(
        (item) => item.name,
      ),
    ).toEqual(['domain-writing']);
    await initializeWorkspaceProject(root);
    expect(await fs.readFile(broken, 'utf8')).toBe('Broken source');
  });
  it('reports malformed and linked Skills without overwriting them or reading external content', async () => {
    const { root, write } = await setup();
    await write(relative, 'Original');
    await fs.writeFile(path.join(root, relative), 'broken YAML');
    expect((await readWorkspaceProjectContext(root)).agent.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'workspace.skill-invalid' }),
      ]),
    );
    await initializeWorkspaceProject(root);
    expect(await fs.readFile(path.join(root, relative), 'utf8')).toBe(
      'broken YAML',
    );
    const outside = path.join(root, 'outside.md');
    await fs.writeFile(outside, 'Do not expose');
    await fs.unlink(path.join(root, relative));
    await fs.symlink(outside, path.join(root, relative));
    const host = createFsWorkspaceHost({ defaultRoot: () => root });
    const handle = (await host.openWorkspace())!;
    try {
      await expect(host.readFile(handle, relative)).rejects.toThrow();
      expect((await readWorkspaceProjectContext(root)).workspaceSkills).toEqual(
        [],
      );
    } finally {
      await host.closeWorkspace(handle);
    }
  });
});
