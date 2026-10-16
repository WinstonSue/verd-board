import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_STORAGE_FILE,
  STORAGE_FILE,
  resolveStoragePath,
} from './migrate-storage';

describe('desktop storage migration', () => {
  let dir = '';

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('copies legacy drawnix-data.json to verdboard-data.json once', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'verdboard-storage-'));
    const preferred = path.join(dir, STORAGE_FILE);
    await writeFile(
      path.join(dir, LEGACY_STORAGE_FILE),
      JSON.stringify({ main_board_content: { children: [{ id: 'a' }] } }),
      'utf-8',
    );

    const resolved = await resolveStoragePath(preferred);
    expect(resolved).toBe(preferred);
    const copied = JSON.parse(await readFile(preferred, 'utf-8'));
    expect(copied.main_board_content.children[0].id).toBe('a');
  });

  it('keeps an existing verdboard-data.json file', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'verdboard-storage-'));
    const preferred = path.join(dir, STORAGE_FILE);
    await writeFile(preferred, JSON.stringify({ current: true }), 'utf-8');
    await writeFile(
      path.join(dir, LEGACY_STORAGE_FILE),
      JSON.stringify({ current: false }),
      'utf-8',
    );

    await resolveStoragePath(preferred);
    expect(JSON.parse(await readFile(preferred, 'utf-8')).current).toBe(true);
  });
});
