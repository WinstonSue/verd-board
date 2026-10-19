import * as fs from 'fs/promises';
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
      filter: (file) =>
        !path
          .relative(path.join(repoRoot, 'workspace'), file)
          .split(path.sep)
          .includes('.verdboard'),
    });
    const native = (await listing(source)).filter((file) =>
      /\.verd(?:-doc)?\.json$/.test(file),
    );
    await fs.mkdir(path.join(source, '.verdboard', 'trash'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(source, '.verdboard', 'trash', 'private.verd-doc.json'),
      '{}',
    );
    await fs.writeFile(path.join(source, 'unfinished.tmp'), 'private');
    const config = JSON.parse(
      await fs.readFile(path.join(desktopDir, 'package.json'), 'utf8'),
    );
    const matchers = getFileMatchers(
      {
        ...config.build,
        extraResources: config.build.extraResources.map(
          (entry: Record<string, unknown>) => ({ ...entry, from: source }),
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
    expect(await listing(path.join(output, 'workspace'))).toEqual(native);
    expect(
      native.filter((file) => file.endsWith('.verd-doc.json')),
    ).toHaveLength(21);
    expect(native.filter((file) => file.endsWith('.verd.json'))).toHaveLength(
      9,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
