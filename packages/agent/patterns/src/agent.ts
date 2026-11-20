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
/** Markdown is the only maintained source of executable Agent guidance. */
export interface AgentGuideSource {
  path: string;
  title: string;
  source: string;
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
const templateModules = import.meta.glob(
  ['../agent/**/*.verd', '../agent/**/*.verd*.json'],
  {
    query: '?raw',
    import: 'default',
  },
);
const commonGuidePaths = [
  'skills/verd-authoring/references/writing.md',
  'skills/verd-authoring/references/reports.md',
  'skills/verd-authoring/references/diagram-quality.md',
];
const guideModules = import.meta.glob('../agent/skills/*/references/*.md', {
  query: '?raw',
  import: 'default',
});
async function loadGuide(path: string): Promise<AgentGuideSource> {
  const load = guideModules['../agent/' + path];
  if (!load) throw new Error('Missing Agent guide: ' + path);
  const source = (await load()) as string;
  const title = /^#\s+(.+)$/m.exec(source)?.[1]?.trim();
  if (!title) throw new Error('Missing Agent guide title: ' + path);
  return { path, title, source };
}
/** The common writing guide, or the selected pattern's Markdown guide. */
export async function loadPatternGuide(
  patternId?: string,
): Promise<AgentGuideSource> {
  const guidePath = patternId
    ? patterns.find((pattern) => pattern.id === patternId)?.guidePath
    : commonGuidePaths[0];
  if (!guidePath) throw new Error('Missing pattern guide: ' + patternId);
  return loadGuide(guidePath);
}
/** Common, scenario, diagram and selected pattern guidance, in reading order. */
export async function loadPatternGuides(
  patternId?: string,
): Promise<AgentGuideSource[]> {
  const pattern = patternId
    ? patterns.find((item) => item.id === patternId)
    : undefined;
  if (patternId && !pattern)
    throw new Error('Missing pattern guide: ' + patternId);
  const paths = [...commonGuidePaths];
  if (pattern) paths.push(pattern.guidePath);
  return Promise.all([...new Set(paths)].map(loadGuide));
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
      return JSON.parse((await load()) as string);
    }),
  );
}
