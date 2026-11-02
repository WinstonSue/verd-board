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
