import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Every `.verd.json` canvas file in the workspace, keyed by relative path. */
export const canvasFiles = async (
  userData: string,
): Promise<Record<string, any>> => {
  const files: Record<string, any> = {};
  const walk = async (dir: string, prefix = '') => {
    let listing;
    try {
      listing = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of listing) {
      if (entry.name === '.verdboard') continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.name.endsWith('.verd.json')) {
        files[rel] = JSON.parse(await readFile(path.join(dir, rel), 'utf8'));
      }
    }
  };
  await walk(path.join(userData, 'workspaces', 'default'));
  return files;
};

export const committedCells = async (userData: string) =>
  Object.values(await canvasFiles(userData)).flatMap(
    (file) => Object.values(file.cells ?? {}) as any[],
  );

export const fileWithFrame = async (userData: string, frameId: string) =>
  Object.values(await canvasFiles(userData)).find(
    (file) => file.frame?.id === frameId,
  );

export const fileWithCell = async (userData: string, cellId: string) =>
  Object.values(await canvasFiles(userData)).find(
    (file) => file.cells?.[cellId],
  );

export const workspaceDigest = async (userData: string) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(await canvasFiles(userData)).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
  );
