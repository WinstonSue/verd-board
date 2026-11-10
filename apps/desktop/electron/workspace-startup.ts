import {
  createLocalWorkspaceManager,
  seedBuiltinWorkspace as seed,
} from '@sue/verd-board-agent/node';
import { listStorageKeys } from './storage-file';

/** Desktop preserves its legacy storage safety check around the shared manager. */
export const seedBuiltinWorkspace = (
  source: string,
  target: string,
  legacyStorage: string,
  appVersion?: string,
) =>
  seed(
    source,
    target,
    async () => (await listStorageKeys(legacyStorage)).length > 0,
    appVersion,
  );

export function createDesktopWorkspaceManager(
  options: Omit<
    Parameters<typeof createLocalWorkspaceManager>[0],
    'hasLegacyStorage'
  > & { legacyStorage(): string },
) {
  return createLocalWorkspaceManager({
    ...options,
    hasLegacyStorage: async () =>
      (await listStorageKeys(options.legacyStorage())).length > 0,
  });
}
