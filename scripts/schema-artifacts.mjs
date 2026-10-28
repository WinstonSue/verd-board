import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export const schemaRuntimePackages = new Set([
  '@sue/schema-settings-core',
  '@sue/schema-settings-react',
  '@sue/schema-core',
  '@sue/schema-core-engine',
  '@sue/schema-core-path',
  '@sue/schema-core-reactive',
  '@sue/schema-core-schema',
  '@sue/schema-core-shared',
  '@sue/schema-core-validator',
  '@sue/schema-view-react',
  '@sue/schema-view-grid',
]);

/** Candidate packages are confined to disposable installs; committed manifests use registry versions. */
export function readSchemaArtifacts() {
  const index = process.argv.indexOf('--schema-artifacts');
  const file =
    index >= 0 ? process.argv[index + 1] : process.env.VERD_SCHEMA_ARTIFACTS;
  if (!file) return {};
  if (!path.isAbsolute(file))
    throw new Error('Schema artifact manifest must be an absolute path');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const names = manifest.packages.map((pkg) => pkg.name);
  if (new Set(names).size !== names.length)
    throw new Error('Duplicate Schema artifact package');
  for (const name of schemaRuntimePackages)
    if (!names.includes(name))
      throw new Error(`Missing Schema runtime package ${name}`);
  return Object.fromEntries(
    manifest.packages.map((pkg) => {
      if (!schemaRuntimePackages.has(pkg.name))
        throw new Error(`Unexpected Schema runtime package ${pkg.name}`);
      const archive = path.resolve(path.dirname(file), pkg.archive);
      const digest = crypto
        .createHash('sha256')
        .update(fs.readFileSync(archive))
        .digest('hex');
      if (digest !== pkg.sha256)
        throw new Error(`Schema archive checksum mismatch: ${pkg.name}`);
      return [pkg.name, `file:${archive}`];
    }),
  );
}
