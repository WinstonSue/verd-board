import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  validateNativeWorkspace,
  workspaceFileId,
} from '@sue/verd-board-app/headless';
import { digest, readNativeSnapshotUnlocked } from './workspace-lock';

export type BuiltinWorkspaceKind = 'project' | 'agent-patterns';
export const isBuiltinAsset = (relative: string) =>
  relative === 'AGENTS.md' ||
  relative === '.verdscrolls/config.json' ||
  relative === '.verdscrolls/.gitignore' ||
  (!relative.split('/').some((p) => p.startsWith('.')) &&
    /\.verd(?:-doc)?\.json$/.test(relative));

/** The same whitelist, checksum and authoring validation serves seeding and updates. */
export async function readBuiltinRelease(
  source: string,
  kind: BuiltinWorkspaceKind,
  appVersion?: string,
) {
  const files: Record<string, string> = {};
  async function walk(dir = '') {
    for (const e of (
      await fs.readdir(path.join(source, dir), { withFileTypes: true })
    ).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const relative = dir ? dir + '/' + e.name : e.name;
      if (
        e.isDirectory() &&
        (!relative.split('/').some((part) => part.startsWith('.')) ||
          relative === '.verdscrolls')
      )
        await walk(relative);
      else if (isBuiltinAsset(relative)) {
        if (!e.isFile() || e.isSymbolicLink())
          throw new Error('Invalid built-in asset: ' + relative);
        files[relative] = digest(
          await fs.readFile(path.join(source, relative)),
        );
      }
    }
  }
  await walk();
  for (const required of [
    'AGENTS.md',
    '.verdscrolls/config.json',
    '.verdscrolls/.gitignore',
  ])
    if (!files[required])
      throw new Error('Missing built-in asset: ' + required);
  const config = JSON.parse(
    await fs.readFile(path.join(source, '.verdscrolls/config.json'), 'utf8'),
  );
  const snapshot = await readNativeSnapshotUnlocked(source);
  const errors = [
    ...snapshot.diagnostics,
    ...validateNativeWorkspace(snapshot.entries, {
      folderIds: snapshot.folderIds,
    }),
  ].filter((d) => d.severity === 'error');
  const ids = new Set(
    snapshot.entries.map((e) => workspaceFileId(e.file as never)),
  );
  if (
    typeof config.value?.name !== 'string' ||
    !config.value.name.trim() ||
    typeof config.value?.project?.description !== 'string' ||
    !Array.isArray(config.value.project.entryDocumentIds) ||
    !config.value.project.entryDocumentIds.length ||
    config.value.project.entryDocumentIds.some((id: string) => !ids.has(id))
  )
    throw new Error('Invalid built-in project configuration');
  if (errors.length)
    throw new Error(
      'Invalid built-in workspace: ' + errors.map((d) => d.message).join('; '),
    );
  const stored = await fs
    .readFile(path.join(source, '.verdscrolls/release.json'), 'utf8')
    .then(JSON.parse, (error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  if (
    stored &&
    (stored.kind !== kind ||
      stored.releaseId !== digest(JSON.stringify(files)) ||
      JSON.stringify(stored.files) !== JSON.stringify(files))
  )
    throw new Error('Built-in release checksum mismatch');
  return {
    ...(stored?.packageName
      ? {
          packageName: stored.packageName as string,
          packageVersion: stored.packageVersion as string,
          minimumAppVersion: stored.minimumAppVersion as string,
        }
      : {}),
    appVersion: stored?.appVersion ?? appVersion,
    source: 'bundled' as const,
    format: 'verd-builtin-workspace' as const,
    version: 1,
    kind,
    releaseId: digest(JSON.stringify(files)),
    files,
    config,
  };
}

export async function stageBuiltinWorkspace(
  source: string,
  target: string,
  kind: BuiltinWorkspaceKind,
  appVersion?: string,
) {
  const release = await readBuiltinRelease(source, kind, appVersion);
  for (const [relative, hash] of Object.entries(release.files)) {
    const bytes = await fs.readFile(path.join(source, relative));
    if (digest(bytes) !== hash)
      throw new Error('Built-in resources changed; retry');
    await fs.mkdir(path.dirname(path.join(target, relative)), {
      recursive: true,
    });
    await fs.writeFile(path.join(target, relative), bytes);
  }
  const config = structuredClone(release.config);
  config.value.identity = randomUUID();
  await fs.writeFile(
    path.join(target, '.verdscrolls/config.json'),
    JSON.stringify(config, null, 2) + '\n',
  );
  await fs.writeFile(
    path.join(target, '.verdscrolls/instance.json'),
    JSON.stringify({
      appVersion: release.appVersion,
      source: release.source,
      packageName: release.packageName,
      packageVersion: release.packageVersion,
      generation: randomUUID(),
      kind,
      releaseId: release.releaseId,
    }),
  );
  await fs.writeFile(
    path.join(target, '.verdscrolls/release.json'),
    JSON.stringify(release, null, 2) + '\n',
  );
  return release;
}
