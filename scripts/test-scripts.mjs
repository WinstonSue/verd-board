import { readdir } from 'node:fs/promises';
import { runCommand } from './quality-gate.mjs';
import { testConcurrency } from './test-concurrency.mjs';

const tests = (await readdir(new URL('./', import.meta.url)))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => 'scripts/' + name);
await runCommand(process.execPath, [
  '--test',
  '--test-concurrency=' + testConcurrency().scripts,
  ...tests,
]);
