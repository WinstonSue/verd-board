#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSelection } from './quality-gate.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function parseCli(input) {
  const args = input[0] === '--' ? input.slice(1) : [...input];
  const action = args.shift() ?? 'ci';
  if (['ci', 'dev'].includes(action)) {
    if (action === 'ci' && args.length)
      throw new Error('Full CI does not accept test filters');
    if (action === 'dev') parseSelection(args);
    return ['run', action, '--', ...args];
  }
  if (action === 'doctor' && !args.length) return [action];
  if (['status', 'logs', 'fetch', 'cancel', 'artifacts'].includes(action)) {
    const id = args.shift();
    if (
      id &&
      /^[a-zA-Z0-9][a-zA-Z0-9-]{5,90}$/.test(id) &&
      (!args.length ||
        (action === 'fetch' && args.length === 1 && args[0] === '--raw'))
    )
      return [action, id, ...args];
  }
  throw new Error(
    'Use pnpm test:remote [ci|dev <selectors>|doctor|status/logs/artifacts/fetch/cancel <ID> [--raw]]',
  );
}
export async function captureProof(root = ROOT) {
  const { hash, sourceInventory } = await import(
    pathToFileURL(path.join(root, 'scripts/release-review.mjs')).href
  );
  return { sourceDigest: hash(await sourceInventory(root)) };
}
export async function verifyProof(
  manifestFile = process.env.REMOTE_TEST_MANIFEST,
  root = ROOT,
) {
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const quality = JSON.parse(
    await fs.readFile(
      path.join(root, '.quality', manifest.task + '.json'),
      'utf8',
    ),
  );
  if (
    quality.mode !== manifest.task ||
    quality.sourceDigest !== manifest.proof?.sourceDigest ||
    (await captureProof(root)).sourceDigest !== manifest.proof?.sourceDigest
  )
    throw new Error('Gate did not validate the captured source');
}
export async function main(args, { execute, root = ROOT } = {}) {
  if (args[0] === '--capture-proof') {
    console.log(JSON.stringify(await captureProof(root)));
    return 0;
  }
  if (args[0] === '--verify-proof') {
    await verifyProof(undefined, root);
    return 0;
  }
  const forwarded = parseCli(args);
  const binary = path.join(os.homedir(), '.local', 'bin', 'remote-test');
  if (execute) return execute(binary, forwarded, { cwd: root });
  await fs.access(binary).catch(() => {
    throw new Error(
      'Install the user-level remote-test tool; configuration: ~/.config/remote-test/config.json',
    );
  });
  return new Promise((resolve, reject) => {
    const child = spawn(binary, forwarded, {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
