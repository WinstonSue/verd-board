import * as fs from 'fs/promises';
import { createHash } from 'node:crypto';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { expect, it } from 'vitest';

const desktopDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(desktopDir, '../..');
const builderRequire = createRequire(
  createRequire(import.meta.url).resolve('electron-builder'),
);
const { getFileMatchers, copyFiles } = builderRequire(
  'app-builder-lib/out/fileMatcher.js',
);

const listing = async (root: string, prefix = ''): Promise<string[]> => {
  const result: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      result.push(...(await listing(path.join(root, entry.name), relative)));
    else result.push(relative);
  }
  return result.sort();
};

it('electron-builder includes every native document and nested diagram while excluding runtime data', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-resources-'));
  try {
    const source = path.join(dir, 'source');
    const output = path.join(dir, 'resources');
    await fs.cp(path.join(repoRoot, 'workspace'), source, {
      recursive: true,
      filter: (file) => {
        const relative = path
          .relative(path.join(repoRoot, 'workspace'), file)
          .split(path.sep)
          .join('/');
        return (
          !relative.startsWith('.verdboard') &&
          (!relative.startsWith('.verdscrolls/') ||
            ['.verdscrolls/config.json', '.verdscrolls/.gitignore'].includes(
              relative,
            ))
        );
      },
    });
    const bytes = new Uint8Array([0, 10, 255]);
    const assetPath =
      '.verdscrolls/resources/assets/' +
      createHash('sha256').update(bytes).digest('hex') +
      '.bin';
    await fs.mkdir(path.dirname(path.join(source, assetPath)), {
      recursive: true,
    });
    await fs.writeFile(path.join(source, assetPath), bytes);
    await fs.mkdir(path.join(source, '.verdscrolls/resources/history'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(source, '.verdscrolls/resources/history/local.snapshot.json'),
      '{}',
    );
    const native = (await listing(source)).filter((file) =>
      /\.verd(?:(?:-doc)?\.json)?$/.test(file),
    );
    await fs.mkdir(path.join(source, '.verdscrolls', 'trash'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(source, '.verdscrolls', 'trash', 'private.verd-doc.json'),
      '{}',
    );
    await fs.writeFile(path.join(source, 'unfinished.tmp'), 'private');
    const { prepareBuiltinWorkspaces } =
      await import('../../../scripts/prepare-builtin-workspaces.mjs');
    const prepared = path.join(dir, 'prepared');
    await prepareBuiltinWorkspaces(prepared, { project: source });
    const config = JSON.parse(
      await fs.readFile(path.join(desktopDir, 'package.json'), 'utf8'),
    );
    const matchers = getFileMatchers(
      {
        ...config.build,
        extraResources: config.build.extraResources.map(
          (entry: Record<string, unknown>) => ({
            ...entry,
            from: path.join(
              prepared,
              entry.to === 'workspace' ? 'workspace' : 'agent-patterns',
            ),
          }),
        ),
      },
      'extraResources',
      output,
      {
        defaultSrc: desktopDir,
        macroExpander: (value: string) => value,
        customBuildOptions: {},
        globalOutDir: path.join(desktopDir, 'release'),
      },
    );
    await copyFiles(matchers, null, false);
    expect(await listing(path.join(output, 'workspace'))).toEqual(
      [
        ...native,
        'AGENTS.md',
        '.verdscrolls/config.json',
        '.verdscrolls/.gitignore',
        '.verdscrolls/release.json',
        assetPath,
      ].sort(),
    );
    expect(native).toContain('架构图/项目导览.verd');
    expect(native).toContain('文档/架构/系统架构.verd-doc.json');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
