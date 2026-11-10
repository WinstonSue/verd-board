import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import {
  patterns,
  builtinSkillPaths,
  loadBuiltinSkill,
  patternWorkspaceUrl,
} from './index';

it('ships standard Skill entrances for every pattern with resolvable source references', async () => {
  expect(builtinSkillPaths).toHaveLength(patterns.length + 1);
  expect(await loadBuiltinSkill()).toContain('name: verd-authoring');
  expect(await loadBuiltinSkill()).toContain('workflow.port-direction');
  const quality = JSON.parse(
    await fs.readFile(
      new URL('图表编写规范.verd-doc.json', patternWorkspaceUrl),
      'utf8',
    ),
  );
  expect(quality.text.plainText).toContain('workflow.port-direction');
  for (const pattern of patterns) {
    const source = await loadBuiltinSkill(pattern.id);
    expect(source).toMatch(
      new RegExp(`^---\\nname: verd-${pattern.id}\\ndescription:`, 'm'),
    );
    expect(source).toContain(pattern.guidePath);
    for (const template of pattern.templatePaths)
      expect(source).toContain(template);
    const references = [...source.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)];
    expect(references.length).toBeGreaterThanOrEqual(4);
    for (const [, bracketed, bare] of references)
      expect(
        (
          await fs.stat(
            new URL(
              bracketed ?? bare,
              new URL(pattern.skillPath, patternWorkspaceUrl),
            ),
          )
        ).isFile(),
      ).toBe(true);
  }
});
