import { afterEach, expect, it, vi } from 'vitest';
import * as agentPatterns from '@sue/verd-board-agent-patterns/agent';
import { createMemoryWorkspaceHost } from '@sue/verd-board-workspace';
import {
  openWorkspaceSession,
  type WorkspaceSession,
} from '@sue/verd-board-workspace';
import { createWorkspaceActionRegistry } from '../session/workspace-actions';
import { createWorkspaceSurfaceActions } from '../session/workspace-surface-actions';
import { createWorkspaceSkillsModel } from './workspace-skills-model';

const sessions: WorkspaceSession[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});
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

it('renders Markdown structure and external links while keeping package references out of workspace navigation', async () => {
  const { model, actions, session } = await setup();
  const source = [
    '# Integration guidance',
    '',
    '- Read the current context.',
    '',
    '| State | Evidence |',
    '| --- | --- |',
    '| Done | Saved locally |',
    '',
    '```json',
    '{"type":"pattern.instantiate"}',
    '```',
    '',
    '[Package rule](other.md) and [external source](https://example.com/source)',
  ].join('\n');
  vi.spyOn(agentPatterns, 'loadPatternGuides').mockResolvedValue([
    {
      path: 'references/integration.md',
      title: 'Integration guidance',
      source,
    },
  ]);
  const before = session.getState().entries;
  const value = await model().readDefault('');
  if (typeof value === 'string') throw new Error('Expected default documents');
  const rule = value.rules[0];
  expect(rule.source).toBe(source);
  const types: string[] = [];
  const visit = (node: typeof rule.document.content) => {
    types.push(node.type);
    node.content?.forEach(visit);
  };
  visit(rule.document.content);
  expect(types).toEqual(
    expect.arrayContaining(['heading', 'bulletList', 'table', 'codeBlock']),
  );
  const rendered = JSON.stringify(rule.document.content);
  expect(rendered).toContain('https://example.com/source');
  expect(rendered).not.toContain('other.md');
  expect(rule.document.plainText).toContain('Saved locally');
  expect(session.getState().entries).toEqual(before);
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
it('loads the actual default Skill source and Markdown rules rendered without persisting native copies', async () => {
  const { model, actions, session } = await setup();
  const entriesBefore = session.getState().entries;
  const value = await model().readDefault(
    '.agents/skills/verd-pattern-architecture/SKILL.md',
  );
  expect(typeof value).not.toBe('string');
  if (typeof value === 'string') throw new Error('Expected default documents');
  expect(value.skills.map((skill) => skill.name)).toEqual([
    'verd-authoring',
    'verd-architecture',
  ]);
  expect(value.skills[1].source).toContain('references/guide.md');
  expect(value.rules.map((rule) => rule.title)).toEqual([
    '内容编写规范',
    '汇报与讲解场景',
    '图表编写规范',
    '分层架构 · 编写规则',
  ]);
  expect(value.rules[0].source).toMatch(/^# 内容编写规范/);
  expect(value.rules[0].document.content.type).toBe('doc');
  expect(
    value.rules
      .at(-1)
      ?.document.content.content?.some((node) => node.type === 'codeBlock'),
  ).toBe(true);
  for (const rule of value.rules) {
    const marks = JSON.stringify(rule.document.content);
    expect(marks).not.toContain('verd://file/pattern-guide');
    expect(marks).not.toContain('\"type\":\"link\"');
  }
  expect(session.getState().entries).toEqual(entriesBefore);
  const common = await model().readDefault('');
  expect(
    typeof common !== 'string' && common.skills.map((skill) => skill.name),
  ).toEqual(['verd-authoring']);
  expect(
    typeof common !== 'string' && common.rules.map((rule) => rule.title),
  ).toEqual(['内容编写规范', '汇报与讲解场景', '图表编写规范']);
  actions.dispose();
});
