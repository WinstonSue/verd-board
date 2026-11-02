import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
for (const name of ['docs', 'agent-patterns'])
  test(`${name} actual npm archive matches its resource manifest`, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-content-pack-'));
    try {
      const cwd = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../packages/product',
        name,
      );
      execFileSync('pnpm', ['pack', '--pack-destination', dir], {
        cwd,
        stdio: 'pipe',
      });
      const archive = path.join(
        dir,
        (await fs.readdir(dir)).find((f) => f.endsWith('.tgz')),
      );
      const read = (p) =>
        execFileSync('tar', ['-xOf', archive, 'package/' + p]);
      const manifest = JSON.parse(read('dist/builtin-release.json'));
      const prefix = name === 'docs' ? 'dist/workspace/' : 'workspace/';
      const listing = execFileSync('tar', ['-tf', archive], {
        encoding: 'utf8',
      }).split('\n');
      for (const [file, digest] of Object.entries(manifest.files))
        assert.equal(
          'sha256-' +
            createHash('sha256')
              .update(read(prefix + file))
              .digest('hex'),
          digest,
          file,
        );
      for (const file of listing.filter(
        (f) => f.startsWith('package/' + prefix) && !f.endsWith('/'),
      ))
        assert.ok(
          manifest.files[file.slice(('package/' + prefix).length)],
          file,
        );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
