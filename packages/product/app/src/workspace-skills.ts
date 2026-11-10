import { Document, isMap, parseDocument } from 'yaml';
import {
  patterns,
  builtinSkillPaths,
} from '@sue/verd-board-agent-patterns/agent';
import {
  isProjectInternalPath,
  type FileVersion,
  type FileWriteOp,
  type TrashOp,
} from './host/workspace-host';

export interface WorkspaceSkillDefinition {
  scope: 'workspace' | 'pattern' | 'custom';
  patternId?: string;
  name: string;
  path: string;
}

export interface WorkspaceSkillDocument extends WorkspaceSkillDefinition {
  description: string;
  body: string;
  /** Original text preserves optional YAML fields when editing the form. */
  source: string;
  version: FileVersion | null;
}

export interface WorkspaceSkillCommit {
  transactionId: string;
  writes?: FileWriteOp[];
  trash?: TrashOp[];
}

export const workspaceSkillDefinitions: readonly WorkspaceSkillDefinition[] = [
  { scope: 'workspace' as const, name: 'verd-workspace' },
  ...patterns.map((pattern) => ({
    scope: 'pattern' as const,
    patternId: pattern.id,
    name: 'verd-pattern-' + pattern.id,
  })),
].map((definition) => ({
  ...definition,
  path: `.agents/skills/${definition.name}/SKILL.md`,
}));

export function workspaceSkillDefinition(path: string) {
  const definition = workspaceSkillDefinitions.find(
    (item) => item.path === path,
  );
  if (definition) return definition;
  const match = /^\.agents\/skills\/([^/]+)\/SKILL\.md$/.exec(path);
  if (!match || !isSkillName(match[1]))
    throw new Error('Invalid workspace Skill path: ' + path);
  return { scope: 'custom' as const, name: match[1], path };
}

export function isSkillName(name: string) {
  return name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

export function customSkillDefinition(name: string): WorkspaceSkillDefinition {
  if (!isSkillName(name))
    throw new Error(
      'Skill name requires 1–64 lowercase letters, numbers and single hyphens',
    );
  if (
    name === 'verd-authoring' ||
    patterns.some((pattern) => name === `verd-${pattern.id}`) ||
    workspaceSkillDefinitions.some((definition) => definition.name === name)
  )
    throw new Error('This Skill name is reserved: ' + name);
  return workspaceSkillDefinition(`.agents/skills/${name}/SKILL.md`);
}

/** Raw candidates include malformed names so the UI can show their diagnostics. */
export function workspaceSkillPaths(
  entries: readonly { path: string; kind: string }[],
) {
  return entries
    .filter(
      (entry) =>
        entry.kind === 'file' &&
        /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(entry.path),
    )
    .map((entry) => entry.path)
    .sort();
}

function frontmatter(source: string) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) throw new Error('SKILL.md requires YAML frontmatter');
  const document = parseDocument(match[1]);
  if (document.errors.length || !isMap(document.contents))
    throw new Error(
      'Invalid Skill YAML: ' +
        (document.errors[0]?.message ?? 'expected a mapping'),
    );
  return { document, body: source.slice(match[0].length) };
}

export function parseSkillDocument(source: string, expectedName: string) {
  const { document, body } = frontmatter(source);
  const name = document.get('name');
  const description = document.get('description');
  if (name !== expectedName || !isSkillName(name))
    throw new Error('Skill name must match its directory: ' + expectedName);
  if (
    typeof description !== 'string' ||
    !description.trim() ||
    description.length > 1024
  )
    throw new Error('Skill description must contain 1–1024 characters');
  return { name: expectedName, description, body, source };
}

export function parseWorkspaceSkill(
  path: string,
  source: string,
  version: FileVersion | null,
): WorkspaceSkillDocument {
  const definition = workspaceSkillDefinition(path);
  return {
    ...definition,
    ...parseSkillDocument(source, definition.name),
    version,
  };
}

export function serializeWorkspaceSkill(
  path: string,
  values: { description: string; body: string; source?: string },
): string {
  const definition = workspaceSkillDefinition(path);
  if (values.source) parseWorkspaceSkill(path, values.source, null);
  const document = values.source
    ? frontmatter(values.source).document
    : new Document();
  if (document.get('name') !== definition.name)
    document.set('name', definition.name);
  if (document.get('description') !== values.description)
    document.set('description', values.description);
  const source = `---\n${document.toString()}---\n${values.body}`;
  parseWorkspaceSkill(path, source, null);
  return source;
}

export function isSkillDocumentPath(path: string) {
  return /(?:^|\/)(?:\.agents\/)?skills\/[^/]+\/SKILL\.md$/.test(path);
}

/** Agent guides and Skill internals remain available outside content navigation. */
export function isWorkspaceContentPath(
  path: string,
  entries?: readonly { path: string }[],
) {
  if (isProjectInternalPath(path)) return false;
  if (/(?:^|\/)agents?\.md$/i.test(path)) return false;
  if (path === '.agents' || path.startsWith('.agents/')) return false;
  const builtin = (value: string) =>
    builtinSkillPaths.some((skill) => {
      const directory = skill.slice(0, skill.lastIndexOf('/'));
      return value === directory || value.startsWith(directory + '/');
    });
  if (builtin(path)) return false;
  if (path === 'skills' && entries) {
    const children = entries.filter((entry) =>
      entry.path.startsWith('skills/'),
    );
    return (
      !children.some((entry) => builtin(entry.path)) ||
      children.some((entry) => !builtin(entry.path))
    );
  }
  return true;
}
