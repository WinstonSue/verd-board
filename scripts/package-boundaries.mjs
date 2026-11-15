import path from 'node:path';
/** Check the entire production dependency closure, including peers and optional packages. */
export function agentWorkspaceDependencyProblems(packages) {
  const byName = new Map(
    packages.map(({ pkg, directory }) => [pkg.name, { pkg, directory }]),
  );
  const problems = [];
  const product = new Set(
    packages
      .filter(({ directory }) =>
        /packages\/product\//.test(directory.replaceAll('\\', '/')),
      )
      .map(({ pkg }) => pkg.name),
  );
  for (const { pkg, directory } of packages) {
    if (
      !/packages\/(?:agent|workspace)\//.test(directory.replaceAll('\\', '/'))
    )
      continue;
    const visited = new Set();
    const visit = (name, chain) => {
      if (product.has(name)) {
        problems.push(
          `${pkg.name} depends on product: ${[...chain, name].join(' -> ')}`,
        );
        return;
      }
      if (visited.has(name)) return;
      visited.add(name);
      const current = byName.get(name)?.pkg;
      for (const dependency of Object.keys({
        ...current?.dependencies,
        ...current?.peerDependencies,
        ...current?.optionalDependencies,
      }))
        visit(dependency, [...chain, name]);
    };
    visit(pkg.name, []);
  }
  return problems;
}

/** Production source may not bypass manifests by reaching into a product directory. */
export function productSourceImportProblems(source, file, root) {
  const problems = [];
  const productDirectory = path.resolve(root, 'packages/product') + path.sep;
  for (const match of source.matchAll(
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g,
  )) {
    const specifier = match[1];
    if (
      specifier.startsWith('.') &&
      path.resolve(path.dirname(file), specifier).startsWith(productDirectory)
    ) {
      problems.push(
        `${path.relative(root, file)} imports product source ${specifier}`,
      );
    }
  }
  return problems;
}
