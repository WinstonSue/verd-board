import * as fs from 'fs/promises';
import * as path from 'path';

export const STORAGE_FILE = 'verdboard-data.json';
export const LEGACY_STORAGE_FILE = 'drawnix-data.json';

export async function resolveStoragePath(preferred: string): Promise<string> {
  try {
    await fs.access(preferred);
    return preferred;
  } catch {
    const legacy = path.join(path.dirname(preferred), LEGACY_STORAGE_FILE);
    try {
      await fs.access(legacy);
      const data = await fs.readFile(legacy, 'utf-8');
      await fs.writeFile(preferred, data, 'utf-8');
      return preferred;
    } catch {
      return preferred;
    }
  }
}
