import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withWorkspaceRuntime, REPO_ROOT } from './workspace.mjs';

/** Package only validated portable assets; source runtime state never enters a release. */
export async function prepareBuiltinWorkspaces(
  destination = path.join(REPO_ROOT, 'apps/desktop/build/builtin-workspaces'),
  sources = {},
) {
  await withWorkspaceRuntime(async (runtime) => {
    for (const [name, kind] of [
      ['workspace', 'project'],
      ['agent-patterns', 'agent-patterns'],
    ]) {
      const packageDir = path.join(
        REPO_ROOT,
        'packages/product',
        kind === 'project' ? 'docs' : 'agent-patterns',
      );
      const source =
        sources[kind] ??
        path.join(
          packageDir,
          kind === 'project' ? 'dist/workspace' : 'workspace',
        );
      const descriptor = sources[kind]
        ? null
        : JSON.parse(
            await fs.readFile(
              path.join(packageDir, 'dist/builtin-release.json'),
              'utf8',
            ),
          );
      const release = await runtime.builtin.readBuiltinRelease(source, kind);
      if (descriptor && descriptor.releaseId !== release.releaseId)
        throw new Error('Build resource packages before packaging');
      const target = path.join(destination, name);
      await fs.rm(target, { recursive: true, force: true });
      for (const file of Object.keys(release.files)) {
        await fs.mkdir(path.dirname(path.join(target, file)), {
          recursive: true,
        });
        await fs.copyFile(path.join(source, file), path.join(target, file));
      }
      const copied = await runtime.builtin.readBuiltinRelease(target, kind);
      if (copied.releaseId !== release.releaseId)
        throw new Error('Built-in resources changed during packaging');
      await fs.writeFile(
        path.join(target, '.verdscrolls/release.json'),
        JSON.stringify(descriptor ?? release, null, 2) + '\n',
      );
    }
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await prepareBuiltinWorkspaces();
