import * as fs from 'node:fs/promises';
import path from 'node:path';

/** Give both hosts a real subprocess with predictable Codex CLI responses. */
export async function prepareFakeCodex(directory: string) {
  const script = path.join(directory, 'fake-codex.mjs');
  await fs.copyFile(path.join(__dirname, 'local-codex.mjs'), script);
  if (process.platform !== 'win32') {
    await fs.chmod(script, 0o700);
    return { executable: script, preload: undefined };
  }

  // Use the test runner's PE executable on Windows and add the fixture
  // entrypoint only to calls targeting that explicitly selected executable.
  const executable = await fs.realpath(process.execPath);
  const preload = path.join(directory, 'fake-codex.cjs');
  await fs.writeFile(
    preload,
    [
      "const processTools = require('node:child_process');",
      "const { syncBuiltinESMExports } = require('node:module');",
      'const executable = ' + JSON.stringify(executable.toLowerCase()) + ';',
      'const script = ' + JSON.stringify(script) + ';',
      'for (const [method, command] of [["spawn", "exec"], ["execFile", "--version"]]) {',
      '  const original = processTools[method];',
      '  processTools[method] = (file, args, ...rest) => original(',
      '    file, typeof file === "string" && file.toLowerCase() === executable && args?.[0] === command',
      '      ? [script, ...args] : args, ...rest);',
      '}',
      'syncBuiltinESMExports();',
    ].join('\n'),
  );
  return { executable, preload };
}
