import catalogData from '../catalog.json';
import rulesData from '../rules.json';
export interface AgentPattern {
  id: string;
  version: number;
  title: string;
  description: string;
  parameters: Record<string, { type: string; description: string }>;
  templatePaths: string[];
  rootFileId: string;
  guidePath: string;
  skillPath: string;
  ruleIds: string[];
}
export const patterns: readonly AgentPattern[] = catalogData;
export const patternRules = rulesData;
export const patternWorkspaceUrl = new URL('../agent/', import.meta.url);
export const commonSkillPath = 'skills/verd-authoring/SKILL.md';
export const builtinSkillPaths = [
  commonSkillPath,
  ...patterns.map((pattern) => pattern.skillPath),
];
const skillModules = import.meta.glob('../agent/skills/*/SKILL.md', {
  query: '?raw',
  import: 'default',
});
export async function loadBuiltinSkill(patternId?: string): Promise<string> {
  const path = patternId
    ? patterns.find((pattern) => pattern.id === patternId)?.skillPath
    : commonSkillPath;
  const load = path && skillModules['../agent/' + path];
  if (!load) throw new Error('Missing built-in Skill: ' + patternId);
  return (await load()) as string;
}

/** Browser-safe native template loading, shared by the product and embedding hosts. */
const templateModules = import.meta.glob('../agent/**/*.verd*.json', {
  import: 'default',
});
/** Native default guidance is also available inside workspace settings. */
export async function loadPatternGuide(patternId?: string): Promise<unknown> {
  const guidePath = patternId
    ? patterns.find((pattern) => pattern.id === patternId)?.guidePath
    : '图表编写规范.verd-doc.json';
  const load = guidePath && templateModules['../agent/' + guidePath];
  if (!load) throw new Error('Missing pattern guide: ' + patternId);
  return load();
}
export async function loadPatternTemplates(
  patternId: string,
): Promise<unknown[]> {
  const pattern = patterns.find((item) => item.id === patternId);
  if (!pattern) throw new Error('Unknown pattern: ' + patternId);
  return Promise.all(
    pattern.templatePaths.map(async (path) => {
      const load = templateModules['../agent/' + path];
      if (!load) throw new Error('Missing native template: ' + path);
      return load();
    }),
  );
}
