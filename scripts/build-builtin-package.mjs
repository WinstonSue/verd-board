import fs from 'node:fs/promises';
import path from 'node:path';
import { withWorkspaceRuntime, REPO_ROOT } from './workspace.mjs';
export async function buildBuiltinPackage(kind, check = false) {
  const project = kind === 'project';
  const dir = path.join(
    REPO_ROOT,
    'packages/product',
    project ? 'docs' : 'agent-patterns',
  );
  const source = path.join(
    REPO_ROOT,
    project ? 'workspace' : 'packages/product/agent-patterns/workspace',
  );
  const pkg = JSON.parse(
    await fs.readFile(path.join(dir, 'package.json'), 'utf8'),
  );
  await withWorkspaceRuntime(async ({ builtin }) => {
    const release = {
      ...(await builtin.readBuiltinRelease(source, kind)),
      packageName: pkg.name,
      packageVersion: pkg.version,
      minimumAppVersion: pkg.verdBuiltin.minimumAppVersion,
    };
    const manifest = path.join(dir, 'dist/builtin-release.json');
    if (check) {
      if (
        JSON.stringify(JSON.parse(await fs.readFile(manifest, 'utf8'))) !==
        JSON.stringify(release)
      )
        throw new Error('Resource release is stale; build before packing');
      const packed = await builtin.readBuiltinRelease(
        project ? path.join(dir, 'dist/workspace') : source,
        kind,
      );
      if (packed.releaseId !== release.releaseId)
        throw new Error('Resource contents are stale');
      return;
    }
    await fs.mkdir(path.dirname(manifest), { recursive: true });
    if (project) {
      const target = path.join(dir, 'dist/workspace');
      await fs.rm(target, { recursive: true, force: true });
      for (const file of Object.keys(release.files)) {
        await fs.mkdir(path.dirname(path.join(target, file)), {
          recursive: true,
        });
        await fs.copyFile(path.join(source, file), path.join(target, file));
      }
    }
    await fs.writeFile(manifest, JSON.stringify(release, null, 2) + '\n');
  });
}
if (process.argv[1]?.endsWith('build-builtin-package.mjs'))
  await buildBuiltinPackage(process.argv[2], process.argv.includes('--check'));
