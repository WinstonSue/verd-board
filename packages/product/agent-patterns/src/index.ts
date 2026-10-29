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
