import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Canvas interaction tests create their own content; empty workspaces stay empty. */
export async function seedEmptyCanvas(workspace: string) {
  await mkdir(workspace, { recursive: true });
  await writeFile(
    path.join(workspace, '画布.verd'),
    JSON.stringify({
      format: 'verd-frame',
      version: 2,
      frame: {
        id: 'desktop-test-board',
        kind: 'frame',
        cellType: 'frame',
        name: '画布',
        geometry: { x: 0, y: 0, width: 1200, height: 800 },
        children: [],
        groups: [],
      },
      cells: {},
    }),
    { flag: 'wx' },
  );
}

/** Every `.verd` canvas file in the workspace, keyed by relative path. */
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
      if (['.verdscrolls', '.verdscrolls'].includes(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.name.endsWith('.verd')) {
        files[rel] = JSON.parse(
          await readFile(path.join(dir, entry.name), 'utf8'),
        );
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
