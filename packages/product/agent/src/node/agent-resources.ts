import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, withWorkspaceLock } from './workspace-lock';

export interface AgentResourceManifest {
  format: 'verd-agent-resources';
  version: 1;
  id: string;
  toolVersion: string;
  specificationVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  files: Record<string, string>;
}
export async function readAgentResources(
  root: string,
  verify = false,
): Promise<AgentResourceManifest> {
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, 'manifest.json'), 'utf8'),
  ) as AgentResourceManifest;
  if (
    manifest.format !== 'verd-agent-resources' ||
    manifest.version !== 1 ||
    !/^[a-zA-Z0-9][\w.-]*$/.test(manifest.id) ||
    !manifest.files ||
    typeof manifest.toolVersion !== 'string' ||
    typeof manifest.specificationVersion !== 'string' ||
    typeof manifest.nodeVersion !== 'string' ||
    !['darwin', 'linux', 'win32'].includes(manifest.platform) ||
    !['x64', 'arm64'].includes(manifest.arch)
  )
    throw new Error('AGENT_RESOURCES_INVALID: invalid manifest');
  for (const required of [
    'bin/verd',
    'bin/verd.cmd',
    'skills/verd-authoring/SKILL.md',
    'rules.json',
    'catalog.json',
    'app/node_modules/@sue/verd-board-agent/dist/cli.js',
    manifest.platform === 'win32' ? 'runtime/node.exe' : 'runtime/node',
  ])
    if (!manifest.files[required])
      throw new Error('AGENT_RESOURCES_INVALID: missing ' + required);
  for (const [relative, hash] of Object.entries(manifest.files)) {
    if (
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).some((p) => p === '..' || p === '.' || !p) ||
      /^[a-zA-Z]:/.test(relative) ||
      !/^sha256-[a-f0-9]{64}$/.test(hash)
    )
      throw new Error('AGENT_RESOURCES_INVALID: unsafe manifest path');
    if (verify && digest(await fs.readFile(path.join(root, relative))) !== hash)
      throw new Error(
        'AGENT_RESOURCES_INVALID: checksum mismatch: ' + relative,
      );
  }
  return manifest;
}

/** Publish a complete version once, outside the app bundle. Older versions are retained. */
export async function deployAgentResources(
  source: string,
  directory: string,
): Promise<string> {
  const manifest = await readAgentResources(source, true);
  return withWorkspaceLock(directory, async () => {
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, manifest.id);
    const present = await fs.lstat(target).then(
      () => true,
      () => false,
    );
    if (present) {
      const deployed = await readAgentResources(target, true);
      if (JSON.stringify(deployed) !== JSON.stringify(manifest))
        throw new Error(
          'AGENT_RESOURCES_CONFLICT: version directory is occupied',
        );
      return target;
    }
    const staging = path.join(directory, '.deploy-' + randomUUID());
    try {
      await fs.cp(source, staging, { recursive: true, dereference: true });
      await readAgentResources(staging, true);
      await fs.rename(staging, target);
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
    return target;
  });
}
