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
  ruleIds: string[];
}
export const patterns: readonly AgentPattern[] = catalogData;
export const patternRules = rulesData;
export const patternWorkspaceUrl = new URL('../workspace/', import.meta.url);

/** Browser-safe native template loading, shared by the product and embedding hosts. */
const templateModules = import.meta.glob('../workspace/**/*.verd*.json', {
  import: 'default',
});
export async function loadPatternTemplates(
  patternId: string,
): Promise<unknown[]> {
  const pattern = patterns.find((item) => item.id === patternId);
  if (!pattern) throw new Error('Unknown pattern: ' + patternId);
  return Promise.all(
    pattern.templatePaths.map(async (path) => {
      const load = templateModules['../workspace/' + path];
      if (!load) throw new Error('Missing native template: ' + path);
      return load();
    }),
  );
}
