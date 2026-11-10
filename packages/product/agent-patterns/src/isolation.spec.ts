import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';

afterEach(() => {
  vi.doUnmock('../recommendations.json');
  vi.doUnmock('../catalog.json');
  vi.doUnmock('../workspace/rich-document/模板.verd-doc.json');
  vi.resetModules();
});

it('user recommendation metadata and templates cannot change executable Agent defaults', async () => {
  const before = await import('./agent');
  const defaults = {
    patterns: structuredClone(before.patterns),
    rules: structuredClone(before.patternRules),
    skill: await before.loadBuiltinSkill(),
    templates: await before.loadPatternTemplates('rich-document'),
  };
  vi.doMock('../recommendations.json', () => ({
    default: [
      {
        id: 'user-only',
        title: 'User advice',
        description: 'Not an instruction',
        version: 1,
        parameters: {},
        guidePath: 'rich-document/规则说明.verd-doc.json',
        templatePaths: ['rich-document/模板.verd-doc.json'],
        rootFileId: 'user-only',
      },
    ],
  }));
  vi.doMock('../workspace/rich-document/模板.verd-doc.json', () => ({
    default: { userRecommendation: 'Changed user template' },
  }));
  vi.resetModules();
  const recommendations = await import('./recommendations');
  expect(recommendations.recommendations[0].id).toBe('user-only');
  expect(
    await recommendations.loadRecommendationTemplates('user-only'),
  ).toEqual([{ userRecommendation: 'Changed user template' }]);
  const agent = await import('./agent');
  expect(agent.patterns).toEqual(defaults.patterns);
  expect(agent.patternRules).toEqual(defaults.rules);
  expect(await agent.loadBuiltinSkill()).toBe(defaults.skill);
  expect(await agent.loadPatternTemplates('rich-document')).toEqual(
    defaults.templates,
  );
  expect(agent.patternWorkspaceUrl.pathname).toContain('/agent/');
  await expect(
    fs.stat(new URL('skills', recommendations.recommendationWorkspaceUrl)),
  ).rejects.toThrow();
});

it('Agent catalog changes cannot alter user recommendation loading', async () => {
  const before = await import('./recommendations');
  const catalog = structuredClone(before.recommendations);
  const templates = await before.loadRecommendationTemplates('rich-document');
  vi.doMock('../catalog.json', () => ({ default: [] }));
  vi.resetModules();
  expect((await import('./agent')).patterns).toEqual([]);
  const after = await import('./recommendations');
  expect(after.recommendations).toEqual(catalog);
  expect(await after.loadRecommendationTemplates('rich-document')).toEqual(
    templates,
  );
});
