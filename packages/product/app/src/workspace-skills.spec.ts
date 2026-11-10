import { describe, expect, it } from 'vitest';
import {
  parseWorkspaceSkill,
  serializeWorkspaceSkill,
  workspaceSkillDefinitions,
  customSkillDefinition,
  isWorkspaceContentPath,
} from './workspace-skills';

const path = '.agents/skills/verd-workspace/SKILL.md';
describe('standard workspace Skills', () => {
  it('discovers valid custom identities without hiding ordinary folders named skills', () => {
    expect(customSkillDefinition('domain-writing')).toMatchObject({
      scope: 'custom',
      name: 'domain-writing',
    });
    for (const name of [
      'verd-authoring',
      'verd-workspace',
      'verd-architecture',
      '../escape',
      'Uppercase',
      'double--hyphen',
    ])
      expect(() => customSkillDefinition(name)).toThrow();
    expect(isWorkspaceContentPath('skills', [{ path: 'skills' }])).toBe(true);
    expect(
      isWorkspaceContentPath('skills', [
        { path: 'skills' },
        { path: 'skills/verd-authoring/SKILL.md' },
      ]),
    ).toBe(false);
    expect(
      isWorkspaceContentPath('skills', [
        { path: 'skills/verd-authoring/SKILL.md' },
        { path: 'skills/notes.verd-doc.json' },
      ]),
    ).toBe(true);
    expect(isWorkspaceContentPath('skills/notes.verd-doc.json')).toBe(true);
    expect(isWorkspaceContentPath('skills/verd-authoring/SKILL.md')).toBe(
      false,
    );
  });
  it('round-trips multiline YAML and preserves optional metadata, comments and Markdown', () => {
    const source = `---\nname: verd-workspace\ndescription: |\n  Existing description\n# Keep the licence\nlicense: MIT\nmetadata:\n  author: team\nallowed-tools: Read\n---\n# Instructions\nRead [details](references/details.md).\n`;
    const original = parseWorkspaceSkill(path, source, 'v1');
    const updated = serializeWorkspaceSkill(path, {
      ...original,
      description: 'Use: workspace terms',
      body: original.body + 'Use Chinese.\n',
    });
    expect(updated).toContain('# Keep the licence');
    expect(updated).toContain('license: MIT');
    expect(updated).toContain('author: team');
    expect(updated).toContain('allowed-tools: Read');
    expect(parseWorkspaceSkill(path, updated, 'v2')).toMatchObject({
      name: 'verd-workspace',
      scope: 'workspace',
      version: 'v2',
      description: 'Use: workspace terms',
      body: original.body + 'Use Chinese.\n',
    });
  });
  it('uses catalog scopes and rejects unsafe paths, invalid YAML, mismatched names and invalid descriptions', () => {
    expect(
      workspaceSkillDefinitions.find(
        (item) => item.name === 'verd-pattern-architecture',
      ),
    ).toMatchObject({ scope: 'pattern', patternId: 'architecture' });
    expect(() =>
      serializeWorkspaceSkill('../SKILL.md', {
        description: 'valid',
        body: '',
      }),
    ).toThrow();
    for (const source of [
      'no frontmatter',
      '---\nname: [broken\n---\n',
      '---\nname: other\ndescription: valid\n---\n',
    ])
      expect(() => parseWorkspaceSkill(path, source, null)).toThrow();
    for (const description of ['', ' '.repeat(3), 'a'.repeat(1025)])
      expect(() =>
        serializeWorkspaceSkill(path, { description, body: '' }),
      ).toThrow();
  });
});
