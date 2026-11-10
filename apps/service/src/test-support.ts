/** Built only by the E2E launcher; never part of the running service API. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { migrateLegacyCellWorkspace } from '../../../packages/product/app/src/migration/cell-workspace';
import { partitionCellStore } from '@sue/verd-board-app/headless';

export async function seedLegacyWorkspace(
  root: string,
  input: [string, unknown][],
) {
  const records = new Map(input);
  const snapshot = await migrateLegacyCellWorkspace({
    listKeys: async () => [...records.keys()],
    getItem: async (key) => records.get(key) ?? null,
    setItem: async (key, value) => {
      records.set(key, value);
    },
    removeItem: async (key) => {
      records.delete(key);
    },
  });
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const files = partitionCellStore(snapshot.store).files;
  for (const [index, file] of files.entries())
    await fs.writeFile(
      path.join(root, `${index}.verd.json`),
      JSON.stringify(file),
    );
  await fs.mkdir(path.join(root, '.verdscrolls'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.verdscrolls/config.json'),
    JSON.stringify({
      version: 1,
      value: { identity: crypto.randomUUID(), workspaceInitialized: true },
    }),
  );
  await fs.writeFile(
    path.join(root, '.verdscrolls/session.json'),
    JSON.stringify({
      format: 'verd-workspace-session',
      version: 1,
      activeView: 'file',
      tabs: [{ fileId: snapshot.store.rootId }],
      activeTabId: snapshot.store.rootId,
      expandedDirs: [],
    }),
  );
  return records.get('legacy_workspace_backup');
}
