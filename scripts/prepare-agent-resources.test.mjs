import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { nodeArchive } from './prepare-agent-resources.mjs';

test('bundled Node archives and electron-builder resource paths cover supported platform/CPU pairs', async () => {
  const config = JSON.parse(
    await fs.readFile(new URL('../apps/desktop/package.json', import.meta.url)),
  );
  assert.equal(config.build.beforePack, './electron-builder-hooks.cjs');
  assert.ok(
    config.build.extraResources.some(
      (entry) =>
        entry.to === 'agent-tools' && entry.from.includes('${os}-${arch}'),
    ),
  );
  for (const platform of ['darwin', 'linux', 'win32'])
    for (const arch of ['x64', 'arm64']) {
      const archive = nodeArchive(platform, arch);
      assert.ok(archive.includes('v24.18.1-'));
      assert.ok(archive.endsWith(platform === 'win32' ? '.zip' : '.tar.gz'));
      assert.ok(archive.includes(arch));
    }
  assert.throws(() => nodeArchive('darwin', 'universal'));
});

test('Node download cache rechecks official hashes and rejects damaged bytes', async (t) => {
  const { createHash } = await import('node:crypto');
  const os = await import('node:os');
  const path = await import('node:path');
  const { downloadNodeArchive } = await import('./prepare-agent-resources.mjs');
  const cacheRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-node-cache-'),
  );
  t.after(() => fs.rm(cacheRoot, { recursive: true, force: true }));
  const archive = nodeArchive('darwin', 'arm64');
  const bytes = Buffer.from('official archive bytes');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const requests = [];
  const fetchBytes = async (url) => {
    requests.push(url);
    return url.endsWith('SHASUMS256.txt')
      ? Buffer.from(`${sha}  ${archive}\n`)
      : bytes;
  };
  const options = { cacheRoot, fetchBytes };
  assert.deepEqual(
    (await downloadNodeArchive('darwin', 'arm64', options)).bytes,
    bytes,
  );
  assert.deepEqual(
    (await downloadNodeArchive('darwin', 'arm64', options)).bytes,
    bytes,
  );
  assert.equal(requests.filter((url) => url.endsWith(archive)).length, 1);
  assert.equal(
    requests.filter((url) => url.endsWith('SHASUMS256.txt')).length,
    2,
  );
  const cached = path.join(cacheRoot, '24.18.1', sha, archive);
  await fs.writeFile(cached, 'damaged');
  await assert.rejects(
    downloadNodeArchive('darwin', 'arm64', options),
    /Cached Node archive checksum mismatch/,
  );
  await fs.rm(cached);
  await assert.rejects(
    downloadNodeArchive('darwin', 'arm64', {
      cacheRoot,
      fetchBytes: async (url) =>
        url.endsWith('SHASUMS256.txt')
          ? Buffer.from(`${sha}  ${archive}\n`)
          : Buffer.from('wrong download'),
    }),
    /Node archive checksum mismatch/,
  );
  await assert.rejects(fs.access(cached), { code: 'ENOENT' });
  await assert.rejects(
    downloadNodeArchive('darwin', 'arm64', {
      cacheRoot,
      fetchBytes: async () => Buffer.from('missing official hash'),
    }),
    /Official Node checksum missing/,
  );
});
