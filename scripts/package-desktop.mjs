import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  mkdir,
  rename,
  cp,
  rm,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGate } from './quality-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'apps/desktop');
const output = path.join(desktop, 'release');
const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== '--with-zip'))
  throw new Error('Usage: pnpm package:desktop [--with-zip]');

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${program} exited with ${result.status}`);
}

async function unregisterMacApps(directory) {
  if (process.platform !== 'darwin') return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(directory, entry.name);
    if (entry.name.endsWith('.app'))
      spawnSync(
        '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
        ['-u', file],
        { stdio: 'ignore' },
      );
    else await unregisterMacApps(file);
  }
}

async function nativeFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.verdboard', '.verdscrolls'].includes(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(
        ...(await nativeFiles(path.join(directory, entry.name), relative)),
      );
    else if (/\.verd(?:-doc)?\.json$/.test(entry.name)) files.push(relative);
  }
  return files.sort();
}

async function validateMacApp(app, config) {
  const contents = path.join(app, 'Contents');
  const plist = JSON.parse(
    execFileSync(
      'plutil',
      ['-convert', 'json', '-o', '-', path.join(contents, 'Info.plist')],
      { encoding: 'utf8' },
    ),
  );
  if (
    plist.CFBundleIdentifier !== config.build.appId ||
    plist.CFBundleDisplayName !== config.productName ||
    plist.CFBundleShortVersionString !== config.version
  )
    throw new Error(
      'Packaged application identity/version does not match source',
    );
  const resources = path.join(contents, 'Resources');
  const icon = plist.CFBundleIconFile;
  if (
    !icon ||
    icon === 'electron.icns' ||
    !path.basename(icon).endsWith('.icns')
  )
    throw new Error('Packaged application is missing its brand icon');
  if (
    !(await readFile(path.join(resources, icon))).equals(
      await readFile(path.join(desktop, 'build/icon.icns')),
    )
  )
    throw new Error('Packaged application icon differs from source');
  const require = createRequire(import.meta.url);
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const asar = createRequire(builderRequire.resolve('app-builder-lib'))(
    '@electron/asar',
  );
  const metadata = JSON.parse(
    asar
      .extractFile(path.join(resources, 'app.asar'), 'package.json')
      .toString(),
  );
  if (metadata.productName !== config.productName)
    throw new Error('Missing runtime productName');
  const source = path.join(root, 'workspace');
  const bundled = path.join(resources, 'workspace');
  const expected = await nativeFiles(source);
  if (JSON.stringify(expected) !== JSON.stringify(await nativeFiles(bundled)))
    throw new Error('Packaged native workspace file list differs from source');
  for (const file of expected) {
    if (
      !(await readFile(path.join(source, file))).equals(
        await readFile(path.join(bundled, file)),
      )
    )
      throw new Error(`Packaged workspace differs: ${file}`);
  }
  console.log(
    `Validated ${expected.length} native workspace files, identity and brand icon`,
  );
}

async function validateMacDmg(file, config, staging) {
  const mount = path.join(staging, 'verify-volume');
  await mkdir(mount);
  execFileSync(
    'hdiutil',
    ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, file],
    { stdio: 'pipe' },
  );
  try {
    await validateMacApp(path.join(mount, 'VerdBoard.app'), config);
    if (
      !(await readFile(path.join(mount, '.VolumeIcon.icns'))).equals(
        await readFile(path.join(desktop, 'build/icon.icns')),
      )
    )
      throw new Error('Installer volume is missing its brand icon');
  } finally {
    await unregisterMacApps(mount);
    execFileSync('hdiutil', ['detach', mount], { stdio: 'pipe' });
  }
}

await runGate('release');
const staging = await mkdtemp(path.join(tmpdir(), 'verd-desktop-package-'));
try {
  const require = createRequire(import.meta.url);
  const { build, Platform } = require('electron-builder');
  const config = JSON.parse(
    await readFile(path.join(desktop, 'package.json'), 'utf8'),
  );
  const platform =
    process.platform === 'darwin'
      ? Platform.MAC
      : process.platform === 'win32'
        ? Platform.WINDOWS
        : Platform.LINUX;
  const targets =
    process.platform === 'darwin'
      ? ['dmg', ...(flags.includes('--with-zip') ? ['zip'] : [])]
      : undefined;
  const artifacts = await build({
    projectDir: desktop,
    targets: platform.createTarget(targets),
    publish: 'never',
    config: {
      ...config.build,
      beforePack: path.resolve(desktop, config.build.beforePack),
      directories: { ...config.build.directories, output: staging },
    },
  });
  if (process.platform === 'darwin') {
    const app = path.join(
      staging,
      process.arch === 'arm64' ? 'mac-arm64' : 'mac',
      'VerdBoard.app',
    );
    await validateMacApp(app, config);
    for (const file of artifacts.filter((file) => file.endsWith('.dmg')))
      await validateMacDmg(file, config, staging);
    run(
      'pnpm',
      [
        'exec',
        'playwright',
        'test',
        '--config',
        'tests/desktop-e2e/playwright.packaged.config.ts',
        '--output',
        'test-results/desktop-packaged',
        'packaged.spec.ts',
      ],
      {
        env: { ...process.env, VERDBOARD_PACKAGED_APP: app },
      },
    );
  }
  const installers = artifacts.filter((file) =>
    /\.(dmg|zip|exe|AppImage|deb)$/.test(file),
  );
  if (!installers.length) throw new Error('No installers were generated');
  // Archive only after validation, so a failed build leaves the last release intact.
  const previous = await readdir(output).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (previous.length) {
    await unregisterMacApps(output);
    const archive = path.join(desktop, 'release-history', `${Date.now()}`);
    await mkdir(path.dirname(archive), { recursive: true });
    await rename(output, archive);
    // Loose app bundles cause duplicate Launchpad entries; installers remain recoverable.
    for (const entry of await readdir(archive)) {
      if (/^(mac(?:-.+)?|win-unpacked|linux(?:-.+)?-unpacked)$/.test(entry))
        await rm(path.join(archive, entry), { recursive: true, force: true });
    }
  }
  await mkdir(output, { recursive: true });
  const checksums = [];
  for (const file of installers) {
    await cp(file, path.join(output, path.basename(file)));
    const hash = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
    checksums.push(`${hash}  ${path.basename(file)}`);
  }
  await writeFile(path.join(output, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
  console.log(`Installers: ${output}`);
} finally {
  await unregisterMacApps(staging);
  await rm(staging, { recursive: true, force: true });
  // LaunchServices may disable an identical installed bundle when a temporary
  // copy is unregistered. Restore the canonical local installation last.
  if (process.platform === 'darwin') {
    const installed = '/Applications/VerdBoard.app';
    if (
      await access(installed).then(
        () => true,
        () => false,
      )
    )
      execFileSync(
        '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
        ['-f', installed],
        { stdio: 'pipe' },
      );
  }
}
