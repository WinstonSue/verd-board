import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isWorkspaceFile, workspaceFileId } from '@sue/verd-board-app/headless';
import {
  readNativeSnapshotUnlocked,
  withWorkspaceLock,
} from './workspace-lock';
import { metadataPath, metadataState } from './workspace-metadata';
import { readAgentResources } from './agent-resources';

const START = '<!-- verdscrolls:agent:start -->';
const END = '<!-- verdscrolls:agent:end -->';
export const agentGuideBlock = `${START}
## VerdScrolls workspace

Read \`.verdscrolls/shared/skills/verd-authoring/SKILL.md\` before editing native content.
From this project root run \`.verdscrolls/shared/bin/verd context --json\`
(Windows: \`.verdscrolls\\shared\\bin\\verd.cmd context --json\`).
Use that project context, rules and installed patterns to plan, validate, preview and apply edits.
Project identity, name and reading entries come from \`.verdscrolls/config.json\`.
If shared resources are missing, open this folder in VerdBoard Desktop to repair them,
or run an installed \`verd doctor --repair --workspace . --shared <resource-directory>\`.
${END}`;
const IGNORE =
  '# Project config is portable. Runtime data and machine links are not.\n*\n!.gitignore\n!config.json\n';

export interface AgentSetupDiagnostic {
  code: string;
  message: string;
  path?: string;
}
export interface WorkspaceAgentStatus {
  ready: boolean;
  diagnostics: AgentSetupDiagnostic[];
  resourceId: string | null;
}
export interface WorkspaceProjectContext {
  identity: string | null;
  name: string;
  description: string;
  root: string;
  entryDocumentIds: string[];
  entries: { fileId: string; path: string; format: string; title: string }[];
  toolVersion: string | null;
  specificationVersion: string | null;
  resourceId: string | null;
  rules: string | null;
  skill: string | null;
  launcher: string | null;
  agent: WorkspaceAgentStatus;
}

async function statOrNull(file: string) {
  return fs.lstat(file).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}
/** Same-directory publication, never follow a pre-existing symlink. Caller holds workspace lock. */
async function publish(file: string, content: string, previous: string | null) {
  const stat = await statOrNull(file);
  if (stat && (!stat.isFile() || stat.isSymbolicLink()))
    throw new Error('Path is not an ordinary file: ' + file);
  const current = stat ? await fs.readFile(file, 'utf8') : null;
  if (current !== previous)
    throw new Error('File changed during AI setup: ' + file);
  if (current === content) return;
  const tmp = file + '.agent-' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(tmp, content, { flag: 'wx' });
    // Create-only publication cannot overwrite an AGENTS file created concurrently.
    if (previous === null) await fs.link(tmp, file);
    else {
      const latest = await fs.lstat(file);
      if (
        !latest.isFile() ||
        latest.isSymbolicLink() ||
        (await fs.readFile(file, 'utf8')) !== previous
      )
        throw new Error('File changed during AI setup: ' + file);
      await fs.rename(tmp, file);
    }
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
export function updateAgentGuide(source: string): string {
  const starts = source.split(START).length - 1,
    ends = source.split(END).length - 1;
  if (!starts && !ends)
    return (
      source +
      (source && !source.endsWith('\n') ? '\n' : '') +
      (source ? '\n' : '') +
      agentGuideBlock +
      '\n'
    );
  if (starts !== 1 || ends !== 1 || source.indexOf(END) < source.indexOf(START))
    throw new Error(
      'Malformed VerdScrolls managed block; preserve the file and resolve its markers',
    );
  return (
    source.slice(0, source.indexOf(START)) +
    agentGuideBlock +
    source.slice(source.indexOf(END) + END.length)
  );
}

/** Shared by Desktop open and CLI init/repair. Metadata migration and config init happen first. */
export async function initializeWorkspaceAgentUnlocked(
  root: string,
  resources?: string,
): Promise<WorkspaceAgentStatus> {
  const diagnostics: AgentSetupDiagnostic[] = [];
  const report = (code: string, error: unknown, file: string) =>
    diagnostics.push({
      code,
      path: file,
      message: error instanceof Error ? error.message : String(error),
    });
  const ignore = metadataPath(root, '.gitignore');
  try {
    const stat = await statOrNull(ignore);
    const old =
      stat?.isFile() && !stat.isSymbolicLink()
        ? await fs.readFile(ignore, 'utf8')
        : null;
    // This file is exclusively managed; an unfamiliar file is preserved.
    if (old !== null && old !== IGNORE)
      throw new Error(
        'Existing metadata .gitignore is not managed by VerdScrolls',
      );
    await publish(ignore, IGNORE, old);
  } catch (error) {
    report('agent.ignore-conflict', error, ignore);
  }
  const guide = path.join(root, 'AGENTS.md');
  try {
    const stat = await statOrNull(guide);
    if (stat && (!stat.isFile() || stat.isSymbolicLink()))
      throw new Error(
        'AGENTS.md is a directory or external symlink; it was preserved',
      );
    const old = stat ? await fs.readFile(guide, 'utf8') : null;
    await publish(guide, updateAgentGuide(old ?? ''), old);
  } catch (error) {
    report('agent.guide-conflict', error, guide);
  }
  if (resources) {
    const link = metadataPath(root, 'shared');
    try {
      resources = await fs.realpath(resources);
      const manifest = await readAgentResources(resources);
      if (
        manifest.platform !== process.platform ||
        manifest.arch !== process.arch
      )
        throw new Error(
          'Shared tools target a different operating system or CPU',
        );
      const stat = await statOrNull(link);
      if (stat && !stat.isSymbolicLink())
        throw new Error(
          'shared is not a managed directory link; it was preserved',
        );
      const same =
        stat &&
        (await fs.realpath(link).then(
          (p) => p === resources,
          () => false,
        ));
      if (!same) {
        const tmp = metadataPath(root, '.shared-' + randomUUID());
        try {
          await fs.symlink(
            resources,
            tmp,
            process.platform === 'win32' ? 'junction' : 'dir',
          );
          // Junction rename cannot replace another junction on Windows.
          if (stat) await fs.unlink(link);
          await fs.rename(tmp, link);
        } finally {
          await fs.unlink(tmp).catch(() => {});
        }
      }
    } catch (error) {
      report('agent.shared-conflict', error, link);
    }
  }
  const status = await inspectWorkspaceAgentUnlocked(root);
  return {
    ...status,
    ready: status.ready && diagnostics.length === 0,
    diagnostics: [...diagnostics, ...status.diagnostics],
  };
}

export async function inspectWorkspaceAgentUnlocked(
  root: string,
): Promise<WorkspaceAgentStatus> {
  const diagnostics: AgentSetupDiagnostic[] = [];
  let resourceId: string | null = null;
  try {
    if (await metadataState(root, '.verdboard'))
      diagnostics.push({
        code: 'workspace.migration-required',
        message:
          'Legacy metadata requires migration, or an older application is still writing. Close it and reopen in Desktop.',
      });
    await metadataState(root, '.verdscrolls');
  } catch (error) {
    diagnostics.push({
      code: 'workspace.metadata-conflict',
      message: String(error),
    });
  }
  try {
    const configPath = metadataPath(root, 'config.json');
    const stat = await fs.lstat(configPath);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('config.json must be an ordinary file');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    if (
      !Number.isInteger(config.version) ||
      !config.value ||
      typeof config.value.identity !== 'string'
    )
      throw new Error('Invalid project config or missing identity');
    if (
      (await fs.readFile(metadataPath(root, '.gitignore'), 'utf8')) !== IGNORE
    )
      throw new Error('Missing or conflicting metadata .gitignore');
  } catch (error) {
    diagnostics.push({
      code: 'agent.config-unready',
      message: String(error),
      path: '.verdscrolls/config.json',
    });
  }
  try {
    const journals = await fs
      .readdir(metadataPath(root, 'transactions'))
      .catch((error) => {
        if (error.code === 'ENOENT') return [] as string[];
        throw error;
      });
    if (journals.some((name) => name.endsWith('.json')))
      diagnostics.push({
        code: 'workspace.recovery-required',
        message:
          'Pending recovery records were preserved. Reopen in Desktop or run verd doctor --repair; resolve any reported recovery conflict before writing.',
        path: '.verdscrolls/transactions',
      });
  } catch (error) {
    diagnostics.push({
      code: 'workspace.recovery-unreadable',
      message: String(error),
    });
  }
  try {
    const guide = path.join(root, 'AGENTS.md'),
      stat = await fs.lstat(guide);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('AGENTS.md must be an ordinary file');
    const text = await fs.readFile(guide, 'utf8');
    if (!text.includes(agentGuideBlock))
      throw new Error('AGENTS.md has no current managed guide');
  } catch (error) {
    diagnostics.push({
      code: 'agent.guide-unready',
      message: String(error),
      path: 'AGENTS.md',
    });
  }
  try {
    const link = metadataPath(root, 'shared');
    if (!(await fs.lstat(link)).isSymbolicLink())
      throw new Error('shared must be a directory link');
    const manifest = await readAgentResources(link);
    if (
      manifest.platform !== process.platform ||
      manifest.arch !== process.arch
    )
      throw new Error(
        'Shared tools target a different operating system or CPU',
      );
    for (const required of [
      'bin/verd',
      'bin/verd.cmd',
      'skills/verd-authoring/SKILL.md',
      'rules.json',
      'catalog.json',
    ])
      await fs.access(path.join(link, required));
    resourceId = manifest.id;
  } catch (error) {
    diagnostics.push({
      code: 'agent.shared-unready',
      message:
        'Shared tools unavailable. Open this folder in Desktop or run verd doctor --repair --shared PATH. ' +
        String(error),
      path: '.verdscrolls/shared',
    });
  }
  return { ready: diagnostics.length === 0, diagnostics, resourceId };
}

export const inspectWorkspaceAgent = (root: string) =>
  withWorkspaceLock(root, () => inspectWorkspaceAgentUnlocked(root));
export const readWorkspaceProjectContext = (root: string) =>
  withWorkspaceLock(root, async (): Promise<WorkspaceProjectContext> => {
    root = await fs.realpath(root);
    const config = JSON.parse(
      await fs.readFile(metadataPath(root, 'config.json'), 'utf8'),
    );
    if (!config?.value || typeof config.value.identity !== 'string')
      throw new Error(
        'WORKSPACE_CONFIG_INVALID: missing project identity; run verd doctor',
      );
    const value = config.value;
    const agent = await inspectWorkspaceAgentUnlocked(root);
    const snapshot = await readNativeSnapshotUnlocked(root);
    const manifest = agent.resourceId
      ? await readAgentResources(metadataPath(root, 'shared'))
      : null;
    return {
      identity: value.identity,
      name:
        typeof value.name === 'string' && value.name.trim()
          ? value.name
          : path.basename(root),
      description:
        typeof value.project?.description === 'string'
          ? value.project.description
          : '',
      root,
      entryDocumentIds: Array.isArray(value.project?.entryDocumentIds)
        ? value.project.entryDocumentIds.filter(
            (id: unknown) => typeof id === 'string',
          )
        : [],
      entries: snapshot.entries.flatMap((e) =>
        isWorkspaceFile(e.file)
          ? [
              {
                fileId: workspaceFileId(e.file),
                path: e.path,
                format: e.file.format,
                title:
                  e.file.format === 'verd-document'
                    ? e.file.title
                    : (e.file.frame.name ?? e.path),
              },
            ]
          : [],
      ),
      toolVersion: manifest?.toolVersion ?? null,
      specificationVersion: manifest?.specificationVersion ?? null,
      resourceId: manifest?.id ?? null,
      rules: manifest ? '.verdscrolls/shared/rules.json' : null,
      skill: manifest
        ? '.verdscrolls/shared/skills/verd-authoring/SKILL.md'
        : null,
      launcher: manifest
        ? '.verdscrolls/shared/bin/' +
          (process.platform === 'win32' ? 'verd.cmd' : 'verd')
        : null,
      agent: {
        ...agent,
        diagnostics: [
          ...agent.diagnostics,
          ...snapshot.diagnostics.map((d) => ({
            code: d.code,
            message: d.message,
            path: d.path,
          })),
        ],
      },
    };
  });
