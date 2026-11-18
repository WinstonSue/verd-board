import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { build, createServer } from 'vite';
import { buildInContext } from './build-context.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'dev';
const serviceRoot = path.join(root, 'apps/service');
const explicitResources = process.env.VERD_AGENT_RESOURCES;
const children = new Set();
const forwardSignal = (signal) => {
  for (const child of children) child.kill(signal);
};
process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));
process.on('exit', () => forwardSignal('SIGTERM'));
const run = (command, args, env = process.env) =>
  new Promise((resolve, reject) => {
    if (command === 'pnpm' && process.env.npm_execpath) {
      args = [process.env.npm_execpath, ...args];
      command = process.execPath;
    }
    const child = spawn(command, args, {
      cwd: root,
      stdio:
        command === process.execPath
          ? ['inherit', 'inherit', 'inherit', 'ipc']
          : 'inherit',
      env,
    });
    children.add(child);
    child.on('error', reject);
    child.on('exit', (code) => {
      children.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
async function prepareResources() {
  if (explicitResources) {
    const { readAgentResources } = await import(
      pathToFileURL(path.join(root, 'packages/agent/runtime/dist/node.js')).href
    );
    await readAgentResources(explicitResources, true);
    return;
  }
  const { publicPackages } = await import('./pack-public.mjs');
  await run('pnpm', [
    'exec',
    'turbo',
    'run',
    'build',
    ...publicPackages.map(({ pkg }) => `--filter=${pkg.name}`),
  ]);
  const { readAgentResources } = await import(
    pathToFileURL(path.join(root, 'packages/agent/runtime/dist/node.js')).href
  );
  const { NODE_VERSION } = await import('./prepare-agent-resources.mjs');
  const hash = createHash('sha256').update(
    JSON.stringify([process.platform, process.arch, NODE_VERSION]),
  );
  async function fingerprint(location) {
    const stat = await fs.lstat(location);
    if (stat.isDirectory())
      for (const name of (await fs.readdir(location)).sort())
        await fingerprint(path.join(location, name));
    else if (stat.isFile()) {
      hash.update(path.relative(root, location));
      hash.update(await fs.readFile(location));
    }
  }
  for (const { directory } of [...publicPackages].sort((a, b) =>
    a.directory.localeCompare(b.directory),
  )) {
    await fingerprint(path.join(directory, 'package.json'));
    await fingerprint(path.join(directory, 'dist'));
  }
  const cacheRoot = path.join(serviceRoot, 'build/agent-resources');
  await fs.mkdir(cacheRoot, { recursive: true });
  const target = path.join(cacheRoot, hash.digest('hex'));
  const present = await fs.access(target).then(
    () => true,
    () => false,
  );
  if (present) await readAgentResources(target, true);
  else {
    console.log('Preparing current Agent CLI resources…');
    const staging = path.join(cacheRoot, '.prepare-' + randomUUID());
    try {
      await run(process.execPath, [
        'scripts/prepare-agent-resources.mjs',
        staging,
      ]);
      await readAgentResources(staging, true);
      await fs.rename(staging, target);
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
  const manifest = path.join(serviceRoot, 'build/agent-source.json');
  const temporary = manifest + '.' + randomUUID() + '.tmp';
  await fs.writeFile(
    temporary,
    JSON.stringify({ path: path.relative(root, target) }),
  );
  await fs.rename(temporary, manifest);
  process.env.VERD_AGENT_RESOURCES = target;
}
async function serviceBuild() {
  await buildInContext({
    marker: process.env.VERD_WEB_BUILD_CONTEXT,
    directory: path.join(serviceRoot, 'dist'),
    build: () =>
      build({
        root: serviceRoot,
        configFile: path.join(serviceRoot, 'vite.config.ts'),
      }),
  });
}
if (mode === 'build' || mode === 'build-e2e' || mode === 'service-build') {
  await prepareResources();
  const { prepareBuiltinWorkspaces, copyBuiltinWorkspaces } =
    await import('./prepare-builtin-workspaces.mjs');
  const builtin = path.join(serviceRoot, 'build/builtin-workspaces');
  if (process.env.VERD_BUILTIN_WORKSPACES)
    await copyBuiltinWorkspaces(process.env.VERD_BUILTIN_WORKSPACES, builtin);
  else await prepareBuiltinWorkspaces(builtin);
  if (mode !== 'service-build')
    await build({
      root: path.join(root, 'apps/web'),
      configFile: path.join(
        root,
        mode === 'build-e2e'
          ? 'apps/web/vite.e2e.config.ts'
          : 'apps/web/vite.config.ts',
      ),
    });
  await serviceBuild();
} else if (mode === 'start') {
  await run(process.execPath, [path.join(serviceRoot, 'dist/main.mjs')]);
} else if (mode === 'dev') {
  await prepareResources();
  let child;
  let vite;
  let closing = false;
  let restarting = Promise.resolve();
  let firstReady;
  let firstError;
  const ready = new Promise((resolve, reject) => {
    firstReady = resolve;
    firstError = reject;
  });
  async function stopChild() {
    const previous = child;
    if (!previous || previous.exitCode !== null) return;
    await new Promise((resolve) => {
      previous.once('exit', resolve);
      previous.kill('SIGTERM');
    });
    children.delete(previous);
  }
  async function restart() {
    await stopChild();
    if (closing) return;
    const running = spawn(
      process.execPath,
      [path.join(serviceRoot, 'dist/main.mjs'), '--dev'],
      {
        cwd: root,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        env: process.env,
      },
    );
    child = running;
    children.add(running);
    await new Promise((resolve, reject) => {
      running.once('error', reject);
      const exited = (code) =>
        reject(new Error(`Local service exited during startup (${code})`));
      running.once('exit', exited);
      running.on('message', (message) => {
        if (message?.type === 'ready') {
          running.off('exit', exited);
          resolve();
        }
      });
    });
    running.once('exit', (code) => {
      children.delete(running);
      if (!closing && child === running && code) {
        process.exitCode = code;
        void close();
      }
    });
    firstReady();
  }
  const watcher = await build({
    root: serviceRoot,
    configFile: path.join(serviceRoot, 'vite.config.ts'),
    build: { watch: {} },
  });
  watcher.on('event', (event) => {
    if (event.code === 'END')
      restarting = restarting.then(restart).catch((error) => {
        firstError(error);
        console.error(error);
      });
    else if (event.code === 'ERROR') console.error(event.error);
  });
  async function close() {
    if (closing) return;
    closing = true;
    await watcher.close();
    await vite?.close();
    await restarting;
    await stopChild();
  }
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());
  process.on('exit', () => {
    for (const running of children) running.kill('SIGTERM');
  });
  try {
    await ready;
    vite = await createServer({
      root: path.join(root, 'apps/web'),
      configFile: path.join(root, 'apps/web/vite.config.ts'),
    });
    await vite.listen();
    vite.printUrls();
  } catch (error) {
    await close();
    throw error;
  }
} else throw new Error('Expected dev, build, service-build or start');
