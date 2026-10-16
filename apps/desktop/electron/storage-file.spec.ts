import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getStorageValue,
  listStorageKeys,
  removeStorageValue,
  setStorageValue,
  writeStorageAtomic,
} from './storage-file';

describe('desktop storage file', () => {
  let dir = '';

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not wipe a corrupt JSON file on read', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'verdboard-storage-file-'));
    const filePath = path.join(dir, 'verdboard-data.json');
    const corrupt = '{ not-json';
    await writeFile(filePath, corrupt, 'utf-8');

    await expect(
      getStorageValue(filePath, 'main_board_content'),
    ).rejects.toThrow('Corrupt storage file');

    expect(await readFile(filePath, 'utf-8')).toBe(corrupt);
    expect(await readFile(`${filePath}.bak`, 'utf-8')).toBe(corrupt);
  });

  it('rejects writes to corrupt JSON and preserves the original and backup', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'verdboard-storage-file-'));
    const filePath = path.join(dir, 'verdboard-data.json');
    const corrupt = '{ broken';
    await writeFile(filePath, corrupt, 'utf-8');

    await expect(
      setStorageValue(filePath, 'main_board_content', { children: [] }),
    ).rejects.toThrow('Corrupt storage file');

    expect(await readFile(`${filePath}.bak`, 'utf-8')).toBe(corrupt);
    expect(await readFile(filePath, 'utf-8')).toBe(corrupt);
  });

  it.each(['null', '[]', '123', '"text"'])(
    'rejects invalid storage roots (%s) on read, enumeration, write and removal',
    async (corrupt) => {
      dir = await mkdtemp(path.join(tmpdir(), 'verdboard-storage-file-'));
      const filePath = path.join(dir, 'verdboard-data.json');
      await writeFile(filePath, corrupt, 'utf-8');
      await expect(
        getStorageValue(filePath, 'main_board_content'),
      ).rejects.toThrow('Corrupt storage file');
      await expect(listStorageKeys(filePath)).rejects.toThrow(
        'Corrupt storage file',
      );
      await expect(
        setStorageValue(filePath, 'main_board_content', {}),
      ).rejects.toThrow('Corrupt storage file');
      await expect(
        removeStorageValue(filePath, 'main_board_content'),
      ).rejects.toThrow('Corrupt storage file');
      expect(await readFile(filePath, 'utf-8')).toBe(corrupt);
      expect(await readFile(`${filePath}.bak`, 'utf-8')).toBe(corrupt);
    },
  );

  it('writes atomically via tmp + rename', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'verdboard-storage-file-'));
    const filePath = path.join(dir, 'verdboard-data.json');

    await writeStorageAtomic(filePath, { main_board_content: { ok: true } });

    expect(JSON.parse(await readFile(filePath, 'utf-8'))).toEqual({
      main_board_content: { ok: true },
    });
  });

  it('stores board, workflow, registry, and mind keys in the same file', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'verdboard-storage-file-'));
    const filePath = path.join(dir, 'verdboard-data.json');

    await setStorageValue(filePath, 'main_board_content', { children: [] });
    await setStorageValue(filePath, 'main_workflow_content', {
      version: 1,
      start: { label: 'Start' },
    });
    await setStorageValue(filePath, 'main_workflow_registry', {
      activeId: 'main',
      documents: {},
    });
    await setStorageValue(filePath, 'main_mind_content', {
      version: 1,
      roots: [],
    });

    expect(await getStorageValue(filePath, 'main_board_content')).toEqual({
      children: [],
    });
    expect(await getStorageValue(filePath, 'main_workflow_content')).toEqual({
      version: 1,
      start: { label: 'Start' },
    });
    expect(await getStorageValue(filePath, 'main_workflow_registry')).toEqual({
      activeId: 'main',
      documents: {},
    });
    expect(await getStorageValue(filePath, 'main_mind_content')).toEqual({
      version: 1,
      roots: [],
    });
    expect(JSON.parse(await readFile(filePath, 'utf-8'))).toEqual({
      main_board_content: { children: [] },
      main_workflow_content: { version: 1, start: { label: 'Start' } },
      main_workflow_registry: { activeId: 'main', documents: {} },
      main_mind_content: { version: 1, roots: [] },
    });
  });

  it('stores a frame content document beside the board snapshot', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'verdboard-storage-file-'));
    const filePath = path.join(dir, 'verdboard-data.json');
    await setStorageValue(filePath, 'mind/system', {
      version: 2,
      root: { type: 'mind' },
    });
    await expect(getStorageValue(filePath, 'mind/system')).resolves.toEqual({
      version: 2,
      root: { type: 'mind' },
    });
    await expect(
      setStorageValue(filePath, 'mind/../secret', { ok: true }),
    ).rejects.toThrow('Unsupported storage key');
  });

  it('rejects unknown storage keys', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'verdboard-storage-file-'));
    const filePath = path.join(dir, 'verdboard-data.json');
    await expect(
      setStorageValue(filePath, 'not_allowed', { ok: true }),
    ).rejects.toThrow('Unsupported storage key');
  });
});
