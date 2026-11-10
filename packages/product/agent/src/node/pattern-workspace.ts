import { stageBuiltinWorkspace } from './builtin-workspace';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recommendationWorkspaceUrl } from '@sue/verd-board-agent-patterns/recommendations';
import { validateNativeWorkspace } from '@sue/verd-board-app/headless';
import {
  withWorkspaceLock,
  readNativeSnapshotUnlocked,
} from './workspace-lock';

/** Existing Desktop copies win. Explicit CLI destinations never get overwritten. */
export async function initializePatternWorkspace(
  target: string,
  options: {
    preserveExisting?: boolean;
    source?: string;
    appVersion?: string;
  } = {},
): Promise<{ path: string; created: boolean }> {
  target = path.resolve(target);
  return withWorkspaceLock(target, async () => {
    const exists = await fs.lstat(target).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (exists) {
      if (!options.preserveExisting || !(await fs.lstat(target)).isDirectory())
        throw new Error('TARGET_EXISTS: choose a new workspace directory');
      if ((await fs.readdir(target)).length)
        return { path: target, created: false };
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    const staging = await fs.mkdtemp(target + '.seed-');
    try {
      await stageBuiltinWorkspace(
        options.source ?? fileURLToPath(recommendationWorkspaceUrl),
        staging,
        'agent-patterns',
        options.appVersion,
      );
      const snapshot = await readNativeSnapshotUnlocked(staging);
      const errors = [
        ...snapshot.diagnostics,
        ...validateNativeWorkspace(snapshot.entries, {
          folderIds: snapshot.folderIds,
        }),
      ].filter((d) => d.severity === 'error');
      if (errors.length)
        throw new Error(
          'Invalid pattern workspace: ' +
            errors.map((d) => d.message).join('; '),
        );
      if (exists) {
        try {
          await fs.rmdir(target);
        } catch (error) {
          if (
            ['ENOTEMPTY', 'EEXIST'].includes(
              (error as NodeJS.ErrnoException).code ?? '',
            )
          )
            return { path: target, created: false };
          throw error;
        }
      }
      await fs.rename(staging, target);
      return { path: target, created: true };
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  });
}
