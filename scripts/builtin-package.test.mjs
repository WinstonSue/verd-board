import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  prepareBuiltinWorkspaces,
  copyBuiltinWorkspaces,
} from './prepare-builtin-workspaces.mjs';
test('bundled native assets match their manifest and the product version', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-bundled-'));
  try {
    await prepareBuiltinWorkspaces(dir);
    const product = JSON.parse(
      await fs.readFile(
        new URL('../packages/product/app/package.json', import.meta.url),
        'utf8',
      ),
    );
    for (const name of ['workspace', 'agent-patterns']) {
      const root = path.join(dir, name);
      const manifest = JSON.parse(
        await fs.readFile(path.join(root, '.verdscrolls/release.json'), 'utf8'),
      );
      assert.equal(manifest.appVersion, product.version);
      assert.equal(manifest.source, 'bundled');
      assert.equal(manifest.packageName, undefined);
      for (const [file, digest] of Object.entries(manifest.files)) {
        assert.equal(
          'sha256-' +
            createHash('sha256')
              .update(await fs.readFile(path.join(root, file)))
              .digest('hex'),
          digest,
          file,
        );
        assert.ok(
          !file.includes('instance.json') && !file.includes('session.json'),
        );
      }
    }
    const copy = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-bundled-copy-'));
    try {
      await copyBuiltinWorkspaces(dir, copy);
      assert.deepEqual(
        await fs.readFile(
          path.join(copy, 'workspace/.verdscrolls/release.json'),
        ),
        await fs.readFile(
          path.join(dir, 'workspace/.verdscrolls/release.json'),
        ),
      );
      await fs.writeFile(
        path.join(copy, 'workspace/文档导航.verd-doc.json'),
        '{}',
      );
      await assert.rejects(copyBuiltinWorkspaces(copy, dir));
    } finally {
      await fs.rm(copy, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
