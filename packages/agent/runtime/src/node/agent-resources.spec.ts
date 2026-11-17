import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { digest } from './workspace-lock';
import {
  deployAgentResources,
  readAgentResources,
  type AgentResourceManifest,
} from './agent-resources';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, cp: vi.fn(actual.cp), readFile: vi.fn(actual.readFile) };
});
const readFile = vi.mocked(fs.readFile).getMockImplementation()!;
const copy = vi.mocked(fs.cp).getMockImplementation()!;
const roots: string[] = [];
afterEach(async () => {
  vi.mocked(fs.readFile).mockReset().mockImplementation(readFile);
  vi.mocked(fs.cp).mockReset().mockImplementation(copy);
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});
async function bundle(id = 'test-v1') {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-resource-contract-'),
  );
  roots.push(root);
  const source = path.join(root, 'source');
  const files = [
    'bin/verd',
    'bin/verd.cmd',
    'skills/verd-authoring/SKILL.md',
    'rules.json',
    'catalog.json',
    'app/node_modules/@sue/verd-board-agent/dist/cli.js',
    'runtime/node',
    ...Array.from({ length: 64 }, (_, index) => `payload/${index}.txt`),
  ];
  const manifest: AgentResourceManifest = {
    format: 'verd-agent-resources',
    version: 1,
    id,
    toolVersion: 'test',
    specificationVersion: 'test',
    nodeVersion: 'test',
    platform: 'darwin',
    arch: 'arm64',
    files: {},
  };
  for (const file of files) {
    const data = `${id}:${file}`;
    await fs.mkdir(path.dirname(path.join(source, file)), { recursive: true });
    await fs.writeFile(path.join(source, file), data);
    manifest.files[file] = digest(data);
  }
  await fs.writeFile(
    path.join(source, 'manifest.json'),
    JSON.stringify(manifest),
  );
  return { root, source, hub: path.join(root, 'hub'), manifest };
}

describe('verified Agent resource deployment', () => {
  it('verifies every file with at most sixteen concurrent reads', async () => {
    const { source, manifest } = await bundle();
    let active = 0;
    let maximum = 0;
    let completed = 0;
    vi.mocked(fs.readFile).mockImplementation((async (
      file: any,
      options: any,
    ) => {
      if (String(file).endsWith('manifest.json'))
        return readFile(file, options);
      maximum = Math.max(maximum, ++active);
      try {
        return await readFile(file, options);
      } finally {
        active--;
        completed++;
      }
    }) as typeof fs.readFile);
    expect(await readAgentResources(source, true)).toEqual(manifest);
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(16);
    expect(completed).toBe(Object.keys(manifest.files).length);
    expect(active).toBe(0);
  });

  it('rejects all unsafe paths before reading any payload', async () => {
    const { source, manifest } = await bundle();
    manifest.files['../outside'] = digest('outside');
    await fs.writeFile(
      path.join(source, 'manifest.json'),
      JSON.stringify(manifest),
    );
    vi.mocked(fs.readFile).mockClear();
    await expect(readAgentResources(source, true)).rejects.toThrow(
      'unsafe manifest path',
    );
    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('rejects corrupt source files and drains in-flight reads', async () => {
    const { source, hub } = await bundle();
    await fs.writeFile(path.join(source, 'payload/3.txt'), 'corrupt');
    await expect(deployAgentResources(source, hub)).rejects.toThrow(
      'checksum mismatch',
    );
    expect(await fs.readdir(hub).catch(() => [])).toEqual([]);
  });

  it('keeps copied files independent and rejects a corrupted deployed version', async () => {
    const { source, hub } = await bundle();
    const target = await deployAgentResources(source, hub);
    const original = await fs.readFile(path.join(source, 'rules.json'), 'utf8');
    await fs.writeFile(path.join(target, 'rules.json'), 'changed');
    expect(await fs.readFile(path.join(source, 'rules.json'), 'utf8')).toBe(
      original,
    );
    await expect(deployAgentResources(source, hub)).rejects.toThrow(
      'checksum mismatch',
    );
  });

  it('falls back to ordinary copying when cloning is unsupported', async () => {
    const { source, hub, manifest } = await bundle();
    vi.mocked(fs.cp).mockRejectedValueOnce(
      Object.assign(new Error('no clone'), { code: 'ENOTSUP' }),
    );
    const target = await deployAgentResources(source, hub);
    expect(await readAgentResources(target, true)).toEqual(manifest);
    expect(fs.cp).toHaveBeenNthCalledWith(1, source, expect.any(String), {
      recursive: true,
      dereference: true,
      mode: constants.COPYFILE_FICLONE,
    });
    expect(fs.cp).toHaveBeenNthCalledWith(2, source, expect.any(String), {
      recursive: true,
      dereference: true,
    });
  });

  it('cleans failed staging directories without removing older versions', async () => {
    const first = await bundle('old');
    const old = await deployAgentResources(first.source, first.hub);
    const next = await bundle('new');
    vi.mocked(fs.cp).mockImplementationOnce(async (_source, target) => {
      await fs.mkdir(target, { recursive: true });
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    });
    await expect(deployAgentResources(next.source, first.hub)).rejects.toThrow(
      'disk full',
    );
    expect(await fs.readdir(first.hub)).toEqual(['old']);
    expect((await readAgentResources(old, true)).id).toBe('old');
  });
});
