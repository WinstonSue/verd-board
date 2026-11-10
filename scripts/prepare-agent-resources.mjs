import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { packPublicPackages, root } from './pack-public.mjs';
import { readSchemaArtifacts } from './schema-artifacts.mjs';

export const NODE_VERSION = '24.18.1';
export function nodeArchive(platform, arch) {
  if (
    !['darwin', 'linux', 'win32'].includes(platform) ||
    !['arm64', 'x64'].includes(arch)
  )
    throw new Error('Unsupported agent runtime target');
  return `node-v${NODE_VERSION}-${platform === 'win32' ? 'win' : platform}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
}
function run(cmd, args, cwd, env = process.env, inheritOutput = false) {
  const result = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: inheritOutput ? 'inherit' : 'pipe',
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${cmd}: ${result.error ?? (result.stderr || result.stdout || result.signal || result.status)}`,
    );
  return result.stdout;
}
const hash = (bytes) =>
  'sha256-' + createHash('sha256').update(bytes).digest('hex');
async function download(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Download failed ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
export async function prepareAgentResources(
  destination,
  { platform = process.platform, arch = process.arch } = {},
) {
  const archive = nodeArchive(platform, arch);
  const target = path.resolve(destination);
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-agent-resources-'),
  );
  try {
    // Use official HTTPS checksums, then verify the exact downloaded archive before extraction.
    const base = `https://nodejs.org/download/release/v${NODE_VERSION}/`;
    const sums = (await download(base + 'SHASUMS256.txt')).toString();
    const expected = sums
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .find(([, name]) => name === archive)?.[0];
    if (!/^[a-f0-9]{64}$/.test(expected ?? ''))
      throw new Error('Official Node checksum missing for ' + archive);
    const bytes = await download(base + archive);
    if (hash(bytes) !== 'sha256-' + expected)
      throw new Error('Node archive checksum mismatch');
    const archivePath = path.join(scratch, archive);
    await fs.writeFile(archivePath, bytes);
    const unpacked = path.join(scratch, 'unpacked');
    await fs.mkdir(unpacked);
    if (platform === 'win32') {
      if (process.platform === 'win32') {
        const script = path.join(scratch, 'expand.ps1');
        await fs.writeFile(
          script,
          'param([string]$ArchivePath, [string]$DestinationPath)\n$ErrorActionPreference = "Stop"\nExpand-Archive -LiteralPath $ArchivePath -DestinationPath $DestinationPath\n',
        );
        run(
          'powershell.exe',
          ['-NoProfile', '-File', script, archivePath, unpacked],
          root,
        );
      } else run('unzip', ['-q', archivePath, '-d', unpacked], root);
    } else run('tar', ['-xzf', archivePath, '-C', unpacked], root);
    const stage = path.join(scratch, 'bundle');
    await fs.mkdir(path.join(stage, 'runtime'), { recursive: true });
    const nodeRoot = path.join(
      unpacked,
      archive.replace(/\.(zip|tar.gz)$/, ''),
    );
    await fs.copyFile(
      path.join(nodeRoot, platform === 'win32' ? 'node.exe' : 'bin/node'),
      path.join(stage, 'runtime', platform === 'win32' ? 'node.exe' : 'node'),
    );
    if (platform !== 'win32')
      await fs.chmod(path.join(stage, 'runtime/node'), 0o755);
    await fs.copyFile(
      path.join(nodeRoot, 'LICENSE'),
      path.join(stage, 'runtime/LICENSE'),
    );
    await fs.writeFile(path.join(stage, 'runtime/SHASUMS256.txt'), sums);

    const packs = packPublicPackages(path.join(scratch, 'packs'));
    const archives = Object.fromEntries(
      packs.map((p) => [p.name, `file:${p.archive}`]),
    );
    const app = path.join(stage, 'app');
    await fs.mkdir(app);
    const npmrc = (await fs.readFile(path.join(root, '.npmrc'), 'utf8'))
      .split('\n')
      .filter((l) => /^(registry|@sue:registry|@ylib:registry)=/.test(l))
      .join('\n');
    await fs.writeFile(
      path.join(app, '.npmrc'),
      npmrc + '\nnode-linker=hoisted\n',
    );
    await fs.writeFile(
      path.join(app, 'pnpm-workspace.yaml'),
      `packages: []\nnodeLinker: hoisted\noverrides: ${JSON.stringify({ ...archives, ...readSchemaArtifacts() })}\n`,
    );
    await fs.writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        dependencies: {
          '@sue/verd-board-agent': archives['@sue/verd-board-agent'],
          '@sue/verd-board-agent-patterns':
            archives['@sue/verd-board-agent-patterns'],
        },
      }),
    );
    run(
      'pnpm',
      [
        'install',
        '--prod',
        '--ignore-scripts',
        '--prefer-offline',
        '--no-frozen-lockfile',
        '--config.node-linker=hoisted',
      ],
      app,
      process.env,
      true,
    );
    // No package manager or machine-specific install metadata is needed at runtime.
    for (const f of [
      '.npmrc',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'node_modules/.modules.yaml',
      'node_modules/.pnpm/lock.yaml',
      'node_modules/.bin',
      'node_modules/.package-map.json',
      'node_modules/.pnpm-workspace-state-v1.json',
    ])
      await fs.rm(path.join(app, f), { recursive: true, force: true });
    await fs.writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({ private: true, type: 'module' }),
    );
    const agent = path.join(app, 'node_modules/@sue/verd-board-agent');
    const patterns = path.join(
      app,
      'node_modules/@sue/verd-board-agent-patterns',
    );
    const { parseSkillDocument } = await import(
      pathToFileURL(
        path.join(app, 'node_modules/@sue/verd-board-app/dist/headless.js'),
      ).href
    );
    const catalog = JSON.parse(
      await fs.readFile(path.join(patterns, 'catalog.json'), 'utf8'),
    );
    for (const relative of [
      'skills/verd-authoring/SKILL.md',
      ...catalog.map((item) => item.skillPath),
    ]) {
      if (!/^skills\/verd-[\w-]+\/SKILL\.md$/.test(relative))
        throw new Error('Invalid Agent Skill path: ' + relative);
      parseSkillDocument(
        await fs.readFile(path.join(patterns, 'agent', relative), 'utf8'),
        relative.split('/')[1],
      );
    }
    await fs.cp(
      path.join(patterns, 'agent/skills/verd-authoring'),
      path.join(stage, 'skills/verd-authoring'),
      {
        recursive: true,
      },
    );
    await fs.copyFile(
      path.join(patterns, 'catalog.json'),
      path.join(stage, 'catalog.json'),
    );
    await fs.cp(path.join(patterns, 'agent'), path.join(stage, 'patterns'), {
      recursive: true,
    });
    const cli = path.join(agent, 'dist/cli.js');
    await fs.writeFile(
      path.join(stage, 'rules.json'),
      run(process.execPath, [cli, 'rules', '--json'], app, {
        ...process.env,
        NODE_OPTIONS: '',
      }),
    );
    await fs.mkdir(path.join(stage, 'bin'));
    await fs.writeFile(
      path.join(stage, 'bin/verd'),
      '#!/bin/sh\nBASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P) || exit 2\nexport VERD_AGENT_RESOURCES="$BASE"\nunset NODE_OPTIONS NODE_PATH\nexec "$BASE/runtime/node" "$BASE/app/node_modules/@sue/verd-board-agent/dist/cli.js" "$@"\n',
      { mode: 0o755 },
    );
    await fs.writeFile(
      path.join(stage, 'bin/verd.cmd'),
      '@echo off\r\nsetlocal\r\nset "VERD_AGENT_RESOURCES=%~dp0.."\r\nset "NODE_OPTIONS="\r\nset "NODE_PATH="\r\n"%~dp0..\\runtime\\node.exe" "%~dp0..\\app\\node_modules\\@sue\\verd-board-agent\\dist\\cli.js" %*\r\nexit /b %errorlevel%\r\n',
    );
    const files = {};
    async function inventory(dir, prefix = '') {
      for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        const rel = prefix + e.name;
        if (e.isSymbolicLink())
          throw new Error(
            'Runtime bundle contains a nonportable symlink: ' + rel,
          );
        if (e.isDirectory()) await inventory(path.join(dir, e.name), rel + '/');
        else files[rel] = hash(await fs.readFile(path.join(dir, e.name)));
      }
    }
    await inventory(stage);
    const toolVersion = packs.find(
      (p) => p.name === '@sue/verd-board-agent',
    ).version;
    const specificationVersion = packs.find(
      (p) => p.name === '@sue/verd-board-agent-patterns',
    ).version;
    const id = `${toolVersion}-${platform}-${arch}-${hash(JSON.stringify(files)).slice(7, 23)}`;
    await fs.writeFile(
      path.join(stage, 'manifest.json'),
      JSON.stringify(
        {
          format: 'verd-agent-resources',
          version: 1,
          id,
          toolVersion,
          specificationVersion,
          nodeVersion: NODE_VERSION,
          platform,
          arch,
          files,
        },
        null,
        2,
      ),
    );
    // Refuse an existing destination; callers choose isolated staging or remove their own generated output first.
    if (
      await fs.lstat(target).then(
        () => true,
        () => false,
      )
    )
      throw new Error('Agent resource destination already exists: ' + target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(stage, target, { recursive: true });
    return {
      path: target,
      id,
      files: Object.keys(files).length,
      nodeArchive: archive,
      checksum: expected,
    };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (!args[0])
    throw new Error(
      'Usage: node scripts/prepare-agent-resources.mjs DEST [PLATFORM] [ARCH]',
    );
  console.log(
    JSON.stringify(
      await prepareAgentResources(args[0], {
        platform: args[1] ?? process.platform,
        arch: args[2] ?? process.arch,
      }),
    ),
  );
}
