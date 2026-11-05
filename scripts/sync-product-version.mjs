import fs from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const product = JSON.parse(
  await fs.readFile(new URL('packages/product/app/package.json', root), 'utf8'),
);
for (const file of [
  'apps/desktop/package.json',
  'packages/product/docs/package.json',
  'packages/product/agent-patterns/package.json',
]) {
  const url = new URL(file, root);
  const pkg = JSON.parse(await fs.readFile(url, 'utf8'));
  if (pkg.version === product.version) continue;
  pkg.version = product.version;
  await fs.writeFile(url, JSON.stringify(pkg, null, 2) + '\n');
}
