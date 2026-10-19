import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
export const publicPackages = fs
  .readdirSync(path.join(root, 'packages'))
  .flatMap((layer) =>
    fs.readdirSync(path.join(root, 'packages', layer)).flatMap((name) => {
      const directory = path.join(root, 'packages', layer, name);
      const manifest = path.join(directory, 'package.json');
      if (!fs.existsSync(manifest)) return [];
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      return pkg.private ? [] : [{ directory, pkg }];
    }),
  );

function command(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${program} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

/** Inspect the actual pnpm archive, including publishConfig and workspace rewrites. */
export function packPublicPackages(destination) {
  fs.mkdirSync(destination, { recursive: true });
  return publicPackages.map(({ directory, pkg }) => {
    const result = JSON.parse(
      command(
        'pnpm',
        ['pack', '--json', '--pack-destination', destination],
        directory,
      ),
    );
    const archive = path.resolve(destination, result.filename);
    const files = new Set(
      command('tar', ['-tf', archive], root).trim().split('\n'),
    );
    const packed = JSON.parse(
      command('tar', ['-xOf', archive, 'package/package.json'], root),
    );
    const checkEntry = (entry) => {
      if (typeof entry === 'string') {
        if (
          !entry.startsWith('./dist/') ||
          !files.has(`package/${entry.slice(2)}`)
        )
          throw new Error(`${pkg.name}: missing or source-only entry ${entry}`);
      } else if (entry && typeof entry === 'object') {
        if ('development' in entry)
          throw new Error(`${pkg.name}: development export in archive`);
        Object.values(entry).forEach(checkEntry);
      }
    };
    [packed.main, packed.module, packed.types, packed.exports].forEach(
      checkEntry,
    );
    for (const group of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      for (const [name, version] of Object.entries(packed[group] ?? {})) {
        if (/^(workspace:|file:|link:)/.test(version))
          throw new Error(`${pkg.name}: local dependency ${name}`);
        const internal = publicPackages.find(
          ({ pkg: other }) => other.name === name,
        );
        if (internal && version !== internal.pkg.version)
          throw new Error(
            `${pkg.name}: ${name} must resolve to ${internal.pkg.version}, received ${version}`,
          );
      }
    }
    for (const document of ['README.md', 'CHANGELOG.md']) {
      if (!files.has(`package/${document}`))
        throw new Error(`${pkg.name}: missing ${document}`);
    }
    console.log(`Packed ${pkg.name}@${pkg.version}`);
    return { name: pkg.name, version: pkg.version, archive };
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const dry = process.argv.includes('--dry-run');
  const destination = dry
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'verd-pack-'))
    : path.resolve(process.argv[2] ?? 'tmp/packs');
  try {
    packPublicPackages(destination);
  } finally {
    if (dry) fs.rmSync(destination, { recursive: true, force: true });
  }
}
