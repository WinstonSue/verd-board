import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  mkdir,
  cp,
  rm,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  runGate,
  localTestExecutionAllowed,
  gateDiagnostics,
} from './quality-gate.mjs';
import { assertReleaseContext, artifactFiles } from './release-proof.mjs';
import { writeRecord } from './gate-runner.mjs';
import { replaceReleaseDirectory } from './package-output.mjs';
import { hash } from './release-review.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'apps/desktop');
const output = path.join(desktop, 'release');
export function parseFlags(flags) {
  if (flags.some((flag) => !['--with-zip', '--full'].includes(flag)))
    throw new Error('Usage: pnpm package:desktop [--with-zip] [--full]');
  return [...new Set(flags)];
}

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

async function cleanupPackageStaging(staging) {
  await unregisterMacApps(staging);
  await rm(staging, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
  // Restore the canonical installation after unregistering temporary copies.
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

async function nativeFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.verdboard', '.verdscrolls'].includes(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(
        ...(await nativeFiles(path.join(directory, entry.name), relative)),
      );
    else if (/\.verd(?:(?:-doc)?\.json)?$/.test(entry.name))
      files.push(relative);
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

export async function packageDesktop(input = []) {
  const flags = parseFlags(input);
  if (!localTestExecutionAllowed()) {
    const { main } = await import('./remote-test.mjs');
    return main(['package', ...flags]);
  }
  return runGate('release', flags.includes('--full') ? ['--full'] : [], {
    consume: async ({ context, contextFile }) => {
      const previousContext = process.env.VERD_RELEASE_CONTEXT;
      const previousRun = process.env.VERD_RELEASE_RUN_ID;
      process.env.VERD_RELEASE_CONTEXT = contextFile;
      process.env.VERD_RELEASE_RUN_ID = context.proof.runId;
      const evidence = {
        format: 'verd-desktop-package',
        version: 1,
        status: 'failed',
        release: context.proof,
      };
      try {
        await assertReleaseContext(context);
        await buildPackage(flags, context, evidence);
        evidence.status = 'passed';
      } catch (error) {
        evidence.error = error.message;
        throw error;
      } finally {
        await writeRecord(path.join(root, '.quality/package.json'), evidence);
        if (previousContext === undefined)
          delete process.env.VERD_RELEASE_CONTEXT;
        else process.env.VERD_RELEASE_CONTEXT = previousContext;
        if (previousRun === undefined) delete process.env.VERD_RELEASE_RUN_ID;
        else process.env.VERD_RELEASE_RUN_ID = previousRun;
      }
      return 0;
    },
  });
}

async function buildPackage(flags, context, evidence) {
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
        beforePack: path.resolve(desktop, config.build.beforePack),
        directories: { output: staging },
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
      const previousDiagnostics = new Set(
        (await gateDiagnostics()).map((report) => report.index),
      );
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
      if (process.env.REMOTE_TEST_JOB_DIR) {
        evidence.diagnostics = (await gateDiagnostics()).filter(
          (report) => !previousDiagnostics.has(report.index),
        );
        if (
          evidence.diagnostics.length !== 1 ||
          evidence.diagnostics.some((report) => !report.complete)
        )
          throw new Error('Packaged E2E diagnostics are missing or incomplete');
      }
    }
    evidence.validations = {
      application: process.platform === 'darwin' ? 'passed' : 'not-applicable',
      installer: process.platform === 'darwin' ? 'passed' : 'not-applicable',
      e2e: process.platform === 'darwin' ? 'passed' : 'not-applicable',
    };
    await assertReleaseContext(context);
    const installers = artifacts.filter((file) =>
      /\.(dmg|zip|exe|AppImage|deb)$/.test(file),
    );
    if (!installers.length) throw new Error('No installers were generated');
    const prepared = path.join(staging, 'verified-installers');
    await mkdir(prepared);
    const checksums = [];
    for (const file of installers) {
      await cp(file, path.join(prepared, path.basename(file)));
      const digest = createHash('sha256')
        .update(await readFile(file))
        .digest('hex');
      checksums.push(`${digest}  ${path.basename(file)}`);
    }
    await writeFile(
      path.join(prepared, 'SHA256SUMS'),
      `${checksums.join('\n')}\n`,
    );
    evidence.files = await artifactFiles(prepared);
    await replaceReleaseDirectory(
      prepared,
      output,
      path.join(desktop, 'release-history', String(Date.now())),
      async (directory) => {
        if (hash(await artifactFiles(directory)) !== hash(evidence.files))
          throw new Error('Installer bytes changed while staging');
      },
    );
    console.log(`Installers: ${output}`);
  } catch (cause) {
    await cleanupPackageStaging(staging).catch((cleanupError) => {
      console.error('Unable to clean temporary desktop package', cleanupError);
    });
    throw cause;
  }
  await cleanupPackageStaging(staging);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    process.exitCode = await packageDesktop(process.argv.slice(2));
  } catch (error) {
    console.error(error.stack);
    process.exitCode = error.exitCode ?? 1;
  }
}
