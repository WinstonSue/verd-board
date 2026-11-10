import { spawn } from 'node:child_process';
import path from 'node:path';
export default async function setup() {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/web-e2e.mjs', 'prepare'], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Service test build failed')),
    );
  });
}
