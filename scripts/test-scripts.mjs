import { readdir } from 'node:fs/promises';
import { runCommand } from './quality-gate.mjs';

const tests = (await readdir(new URL('./', import.meta.url)))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => 'scripts/' + name);
await runCommand(process.execPath, ['--test', ...tests]);
