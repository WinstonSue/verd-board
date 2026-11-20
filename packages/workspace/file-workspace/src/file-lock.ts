import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

export const digest = (content: string | Uint8Array) =>
  `sha256-${createHash('sha256').update(content).digest('hex')}`;
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
export async function canonicalRoot(root: string): Promise<string> {
  try {
    return await fs.realpath(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(path.resolve(root));
    return path.join(await canonicalRoot(parent), path.basename(root));
  }
}
/** Shared by Desktop and every CLI process; lives outside the content workspace. */
export async function withWorkspaceLock<T>(
  root: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = digest(await canonicalRoot(root));
  const base = path.join(os.tmpdir(), 'verdboard-workspace-locks');
  await fs.mkdir(base, { recursive: true });
  const lock = path.join(base, key),
    recovery = lock + '.reclaim',
    nonce = randomUUID(),
    started = Date.now();
  const owner = { pid: process.pid, nonce },
    ownership = `${lock}.owner-${process.pid}-${nonce}`;
  const bytes = JSON.stringify(owner);
  // A hard link publishes a fully written ownership record atomically.
  await fs.writeFile(ownership, bytes, { flag: 'wx' });
  let acquired = false;
  try {
    for (;;) {
      const reclaiming = await fs
        .readFile(path.join(recovery, 'owner.json'), 'utf8')
        .catch(() => null);
      if (
        !reclaiming &&
        !(await fs.stat(recovery).then(
          () => true,
          () => false,
        ))
      ) {
        try {
          await fs.link(ownership, lock);
          acquired = true;
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const previousBytes = await fs.readFile(lock, 'utf8').catch(() => '');
        let previous: typeof owner | undefined;
        try {
          previous = JSON.parse(previousBytes);
        } catch {
          /* never steal malformed ownership */
        }
        if (previous && Number.isInteger(previous.pid) && previous.pid > 0) {
          let dead = false;
          try {
            process.kill(previous.pid, 0);
          } catch (error) {
            dead = (error as NodeJS.ErrnoException).code === 'ESRCH';
          }
          if (dead) {
            const claimed = await fs.mkdir(recovery).then(
              () => true,
              (error) => {
                if (error.code === 'EEXIST') return false;
                throw error;
              },
            );
            if (claimed)
              try {
                await fs.writeFile(path.join(recovery, 'owner.json'), bytes);
                if (
                  (await fs.readFile(lock, 'utf8').catch(() => '')) ===
                  previousBytes
                )
                  await fs.unlink(lock).catch(() => {});
              } finally {
                await fs.rm(recovery, { recursive: true, force: true });
              }
          }
        }
      } else if (reclaiming) {
        try {
          process.kill(JSON.parse(reclaiming).pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH')
            throw new Error(
              'WORKSPACE_RECOVERY_REQUIRED: interrupted lock recovery at ' +
                recovery,
            );
        }
      }
      if (Date.now() - started > 15000)
        throw new Error(
          'WORKSPACE_BUSY: another writer holds the workspace lock',
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return await task();
  } finally {
    if (acquired && (await fs.readFile(lock, 'utf8').catch(() => '')) === bytes)
      await fs.unlink(lock);
    await fs.unlink(ownership).catch(() => {});
  }
}
