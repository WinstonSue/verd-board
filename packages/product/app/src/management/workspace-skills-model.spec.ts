import { afterEach, expect, it } from 'vitest';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import {
  openWorkspaceSession,
  type WorkspaceSession,
} from '../session/workspace-session';
import { createWorkspaceActionRegistry } from '../session/workspace-actions';
import { createWorkspaceSurfaceActions } from '../session/workspace-surface-actions';
import { createWorkspaceSkillsModel } from './workspace-skills-model';

const sessions: WorkspaceSession[] = [];
afterEach(() => sessions.splice(0).forEach((session) => session.dispose()));
async function setup() {
  const host = createMemoryWorkspaceHost();
  const handle = (await host.openWorkspace({ path: crypto.randomUUID() }))!;
  const session = await openWorkspaceSession(host, handle);
  sessions.push(session);
  const actions = createWorkspaceActionRegistry({
    getContext: () => ({ session }),
    dialogs: createWorkspaceSurfaceActions({
      getState: () => ({
        allowWorkspaceSwitching: true,
        isDefaultWorkspace: false,
        hasOrigin: false,
      }),
      invoke: () => {},
    }),
  });
  const model = () =>
    createWorkspaceSkillsModel(session, handle.key, actions, 'zh', () => true);
  return { host, handle, session, actions, model };
}
it('creates independent Skills, preserves metadata and resources, rejects duplicates and restores from trash', async () => {
  const { host, handle, session, model, actions } = await setup();
  const path = '.agents/skills/domain-writing/SKILL.md';
  const values = {
    path,
    create: true,
    source: '',
    version: null,
    description: 'Domain writing',
    body: '# Domain\nUse domain terms.',
    transactionId: crypto.randomUUID(),
  };
  expect(await model().save(values)).toEqual({ status: 'accepted' });
  expect(model().customItems?.map((item) => item.name)).toEqual([
    'domain-writing',
  ]);
  expect(
    await model().save({ ...values, transactionId: crypto.randomUUID() }),
  ).toMatchObject({
    status: 'rejected',
    message: expect.stringContaining('同名'),
  });
  const raw = await session.readRawFile(path);
  const optional = new TextDecoder()
    .decode(raw.content)
    .replace(
      '---\nname:',
      '---\nlicense: MIT\nmetadata:\n  author: team\nname:',
    );
  const reference = '.agents/skills/domain-writing/references/terms.md';
  await host.commit(handle, {
    transactionId: crypto.randomUUID(),
    writes: [
      { path, content: optional, expectedVersion: raw.version },
      { path: reference, content: 'Keep resources', expectedVersion: null },
    ],
  });
  await session.syncFromHost();
  const loaded = await model().load(path);
  expect(
    await model().save({
      ...loaded,
      path,
      body: 'Updated instructions',
      transactionId: crypto.randomUUID(),
    }),
  ).toEqual({ status: 'accepted' });
  const source = new TextDecoder().decode(
    (await session.readRawFile(path)).content,
  );
  expect(source).toContain('license: MIT');
  expect(source).toContain('author: team');
  expect(
    await model().remove({
      path,
      version: (await session.readRawFile(path)).version,
      transactionId: crypto.randomUUID(),
    }),
  ).toEqual({ status: 'accepted' });
  expect(model().customItems).toEqual([]);
  expect(await session.readRawFile(reference)).toBeDefined();
  const trashed = session
    .getState()
    .trash.find((entry) => entry.originalPath === path)!;
  expect(
    (await session.apply({ type: 'restore-file', entryId: trashed.entryId }))
      .ok,
  ).toBe(true);
  expect(model().customItems?.[0].name).toBe('domain-writing');
  actions.dispose();
});
it('rejects reserved names and exposes corrupt source without overwriting it', async () => {
  const { host, handle, session, model, actions } = await setup();
  for (const name of [
    'verd-authoring',
    'verd-workspace',
    'verd-architecture',
    'Bad Name',
  ])
    expect(
      await model().save({
        path: `.agents/skills/${name}/SKILL.md`,
        create: true,
        source: '',
        version: null,
        description: 'Writing',
        body: '',
        transactionId: crypto.randomUUID(),
      }),
    ).toMatchObject({ status: 'rejected' });
  const path = '.agents/skills/foreign/SKILL.md';
  await host.commit(handle, {
    transactionId: crypto.randomUUID(),
    writes: [
      { path, content: 'Broken original source', expectedVersion: null },
    ],
  });
  await session.syncFromHost();
  expect(model().customItems?.[0].name).toBe('foreign');
  expect(await model().load(path)).toMatchObject({
    source: 'Broken original source',
    diagnostic: expect.any(String),
  });
  expect(
    new TextDecoder().decode((await session.readRawFile(path)).content),
  ).toBe('Broken original source');
  actions.dispose();
});
it('loads the actual default Skill source and corresponding native rule documents', async () => {
  const { model, actions } = await setup();
  const value = await model().readDefault(
    '.agents/skills/verd-pattern-architecture/SKILL.md',
  );
  expect(typeof value).not.toBe('string');
  if (typeof value === 'string') throw new Error('Expected default documents');
  expect(value.skills.map((skill) => skill.name)).toEqual([
    'verd-authoring',
    'verd-architecture',
  ]);
  expect(value.skills[1].source).toContain(
    '../../architecture/规则说明.verd-doc.json',
  );
  expect(value.rules[0].title).toBe('分层架构 · 编写规则');
  const common = await model().readDefault('');
  expect(
    typeof common !== 'string' && common.skills.map((skill) => skill.name),
  ).toEqual(['verd-authoring']);
  actions.dispose();
});
