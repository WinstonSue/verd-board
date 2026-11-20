import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  patterns,
  builtinSkillPaths,
  commonSkillPath,
  loadBuiltinSkill,
  loadPatternGuide,
  loadPatternGuides,
  patternWorkspaceUrl,
} from './index';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});
async function filesIn(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? filesIn(file) : [file];
      }),
    )
  ).flat();
}
async function checkReferences(file: string, boundary: string) {
  const source = await fs.readFile(file, 'utf8');
  for (const [, bracketed, bare] of source.matchAll(
    /\]\((?:<([^>]+)>|([^\s)]+))\)/g,
  )) {
    const target = bracketed ?? bare;
    if (/^https?:/.test(target)) continue;
    expect(target).not.toMatch(/^verd:/);
    const resolved = fileURLToPath(new URL(target, 'file://' + file));
    expect(path.relative(boundary, resolved)).not.toMatch(/^\.\./);
    expect((await fs.stat(resolved)).isFile()).toBe(true);
  }
}

it('ships standard Skills and resolvable Markdown references separately from native templates', async () => {
  expect(builtinSkillPaths).toHaveLength(patterns.length + 1);
  for (const pattern of patterns) {
    const source = await loadBuiltinSkill(pattern.id);
    expect(source).toMatch(
      new RegExp(`^---\\nname: verd-${pattern.id}\\ndescription:`, 'm'),
    );
    expect(pattern.guidePath).toMatch(
      /^skills\/verd-[\w-]+\/references\/guide\.md$/,
    );
    const references = [
      ...source.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g),
    ].map(([, bracketed, bare]) =>
      fileURLToPath(
        new URL(
          bracketed ?? bare,
          new URL(pattern.skillPath, patternWorkspaceUrl),
        ),
      ),
    );
    expect(references).toContain(
      fileURLToPath(new URL(pattern.guidePath, patternWorkspaceUrl)),
    );
    for (const template of pattern.templatePaths)
      expect(references).toContain(
        fileURLToPath(new URL(template, patternWorkspaceUrl)),
      );
  }
  const root = fileURLToPath(patternWorkspaceUrl);
  const files = await filesIn(root);
  for (const file of files.filter((file) => file.endsWith('.md')))
    await checkReferences(file, root);
  const native = files
    .filter((file) => /\.verd(?:(?:-doc)?\.json)?$/.test(file))
    .map((file) => path.relative(root, file).split(path.sep).join('/'));
  expect(native.sort()).toEqual(
    [...new Set(patterns.flatMap((pattern) => pattern.templatePaths))].sort(),
  );
});

it('loads typed Markdown sources in reading order and rejects unknown patterns', async () => {
  const common = await loadPatternGuide();
  expect(common.path).toBe('skills/verd-authoring/references/writing.md');
  const guides = await loadPatternGuides();
  expect(guides.map((guide) => guide.title)).toEqual([
    '内容编写规范',
    '汇报与讲解场景',
    '图表编写规范',
  ]);
  for (const pattern of patterns) {
    const selected = await loadPatternGuide(pattern.id);
    expect(selected.path).toBe(pattern.guidePath);
    expect(await loadPatternGuides(pattern.id)).toEqual([...guides, selected]);
    expect(selected.source).toBe(
      await fs.readFile(new URL(selected.path, patternWorkspaceUrl), 'utf8'),
    );
    expect(selected.title).toBe(/^#\s+(.+)$/m.exec(selected.source)?.[1]);
  }
  await expect(loadPatternGuides('missing')).rejects.toThrow(
    'Missing pattern guide: missing',
  );
  await expect(loadPatternGuide('missing')).rejects.toThrow(
    'Missing pattern guide: missing',
  );
});

it('keeps all common references and the license readable from an isolated shared Skill copy', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-common-skill-'),
  );
  temporary.push(directory);
  await fs.cp(
    fileURLToPath(new URL('skills/verd-authoring', patternWorkspaceUrl)),
    directory,
    { recursive: true },
  );
  expect(await fs.readFile(path.join(directory, 'SKILL.md'), 'utf8')).toBe(
    await loadBuiltinSkill(),
  );
  for (const file of (await filesIn(directory)).filter((file) =>
    file.endsWith('.md'),
  ))
    await checkReferences(file, directory);
  expect(
    await fs.readFile(
      path.join(directory, 'references/plain-report-skills.LICENSE.txt'),
      'utf8',
    ),
  ).toContain('Copyright (c) 2026 45degreeYouthLee');
  expect(commonSkillPath).toBe('skills/verd-authoring/SKILL.md');
});
