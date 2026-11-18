import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertWebWorkers,
  startReadyProcess,
  setServiceTarget,
  webE2EOptions,
} from './web-e2e-runtime.mjs';
import { defaultWebWorkers } from './test-concurrency.mjs';
import { ROOT } from './release-review.mjs';

test('Web workers default to two and preserve explicit single-worker addresses', () => {
  assert.equal(webE2EOptions({}).workers, defaultWebWorkers);
  assert.equal(webE2EOptions({ VERD_WEB_E2E_WORKERS: '1' }).workers, 1);
  for (const name of [
    'BASE_URL',
    'VERDBOARD_WEB_PORT',
    'VERDBOARD_SERVICE_PORT',
  ]) {
    const env = {
      [name]: name === 'BASE_URL' ? 'http://127.0.0.1:7320' : '7330',
    };
    assert.equal(webE2EOptions(env).workers, 1);
    assert.throws(
      () => webE2EOptions({ ...env, VERD_WEB_E2E_WORKERS: '2' }),
      /require one worker/,
    );
  }
  for (const value of ['0', '-1', 'two', '1.5'])
    assert.throws(
      () => webE2EOptions({ VERD_WEB_E2E_WORKERS: value }),
      /positive integer/,
    );
  assert.throws(() => assertWebWorkers(2, true), /require one worker/);
});

test('readiness rejects child failure, foreign ports, spawn failure and timeout, cleaning its child', async (t) => {
  await assert.rejects(
    startReadyProcess(process.execPath, [
      '-e',
      'console.error("failed startup");process.exit(7)',
    ]),
    /failed startup/,
  );
  await assert.rejects(
    startReadyProcess(
      process.execPath,
      ['-e', 'process.send({type:"ready",port:1234});setInterval(()=>{},1000)'],
      { port: 4321 },
    ),
    /unexpected port/,
  );
  await assert.rejects(startReadyProcess('/does-not-exist/verd', []), /ENOENT/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-child-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pid = path.join(root, 'pid');
  await assert.rejects(
    startReadyProcess(
      process.execPath,
      [
        '-e',
        'require("node:fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)',
        pid,
      ],
      { timeout: 1000 },
    ),
    /did not become ready/,
  );
  const childPid = Number(await fs.readFile(pid, 'utf8'));
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
});

test('worker frontends isolate ports and proxy targets without a shared service', async (t) => {
  const children = [];
  const servers = [];
  t.after(async () => {
    await Promise.all(children.map((child) => child.stop()));
    await Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(resolve))),
    );
  });
  const origin = async (label) => {
    const server = createServer((_request, response) => response.end(label));
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  const env = { ...process.env };
  for (const name of [
    'BASE_URL',
    'VERDBOARD_WEB_PORT',
    'VERDBOARD_SERVICE_PORT',
    'VERD_WEB_E2E_WORKERS',
  ])
    delete env[name];
  for (let index = 0; index < 2; index++)
    children.push(
      await startReadyProcess(
        process.execPath,
        ['scripts/web-e2e.mjs', 'serve'],
        { cwd: ROOT, env },
      ),
    );
  const [first, second] = children;
  assert.notEqual(first.ready.port, second.ready.port);
  for (const frontend of children) {
    // The client connection must share this worker's frontend port, rather
    // than competing for Vite's standalone WebSocket default port.
    await new Promise((resolve, reject) => {
      const socket = new globalThis.WebSocket(
        `ws://127.0.0.1:${frontend.ready.port}`,
        'vite-hmr',
      );
      const timer = setTimeout(
        () => finish(new Error('HMR connection timed out')),
        5000,
      );
      let finished = false;
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.close();
        if (error) reject(error);
        else resolve();
      }
      socket.onmessage = (event) => {
        try {
          assert.equal(JSON.parse(event.data).type, 'connected');
          finish();
        } catch (error) {
          finish(error);
        }
      };
      socket.onerror = () => finish(new Error('HMR connection failed'));
    });
    const module = await fetch(
      `http://127.0.0.1:${frontend.ready.port}/@fs${ROOT}packages/react/text/src/text-preview.tsx`,
    );
    assert.equal(module.status, 200);
    assert.doesNotMatch(await module.text(), /@react-refresh/);
  }
  await setServiceTarget(first.child, await origin('first'));
  await setServiceTarget(second.child, await origin('second'));
  const read = async (child) =>
    (await fetch(`http://127.0.0.1:${child.ready.port}/api/v1/health`)).text();
  assert.equal(await read(first), 'first');
  assert.equal(await read(second), 'second');
  await setServiceTarget(first.child, await origin('replacement'));
  assert.equal(await read(first), 'replacement');
  assert.equal(await read(second), 'second');
});

test('service builds are reused only for the same source within the gate', async (t) => {
  const { prepareWebE2E } = await import('./web-e2e.mjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-web-build-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let source = 'first source';
  let builds = 0;
  const options = {
    directory,
    reuse: true,
    inventory: async () => source,
    buildService: async (config) => {
      builds++;
      const name = config.build.ssr ? 'test-support.mjs' : 'main.mjs';
      await fs.writeFile(path.join(directory, name), source);
    },
  };
  await prepareWebE2E(options);
  await prepareWebE2E(options);
  assert.equal(builds, 2);
  source = 'changed source';
  await prepareWebE2E(options);
  assert.equal(builds, 4);
  await assert.rejects(
    prepareWebE2E({
      ...options,
      reuse: false,
      buildService: async () => {
        source += ' changed during build';
      },
    }),
    /Source changed/,
  );
});
