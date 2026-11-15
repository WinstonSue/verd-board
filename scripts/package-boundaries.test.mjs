import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentWorkspaceDependencyProblems,
  productSourceImportProblems,
} from './package-boundaries.mjs';
const pkg = (name, directory, dependencies = {}, extra = {}) => ({
  directory: 'packages/' + directory,
  pkg: { name, dependencies, ...extra },
});
test('Agent and workspace may share SDK and content without installing products', () => {
  assert.deepEqual(
    agentWorkspaceDependencyProblems([
      pkg('agent', 'agent/runtime', { workspace: '*', renderer: '*' }),
      pkg('workspace', 'workspace/core', { patterns: '*' }),
      pkg('patterns', 'agent/patterns'),
      pkg('renderer', 'react/board'),
      pkg('product', 'product/app', { workspace: '*' }),
    ]),
    [],
  );
});
test('rejects indirect product dependencies through peers and optional dependencies', () => {
  const problems = agentWorkspaceDependencyProblems([
    pkg('agent', 'agent/runtime', { workspace: '*' }),
    pkg(
      'workspace',
      'workspace/core',
      {},
      { peerDependencies: { adapter: '*' } },
    ),
    pkg(
      'adapter',
      'react/adapter',
      {},
      { optionalDependencies: { product: '*' } },
    ),
    pkg('product', 'product/ui'),
  ]);
  assert.equal(problems.length, 2);
  assert.ok(
    problems.every((problem) =>
      problem.includes('workspace -> adapter -> product'),
    ),
  );
});
test('handles dependency cycles without overlooking a product edge', () => {
  const problems = agentWorkspaceDependencyProblems([
    pkg('agent', 'agent/runtime', { a: '*' }),
    pkg('a', 'engine/a', { b: '*' }),
    pkg('b', 'engine/b', { a: '*', product: '*' }),
    pkg('product', 'product/app'),
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /agent -> a -> b -> product/);
});

test('production source cannot bypass package dependencies with relative product imports', () => {
  const root = '/repo';
  const file = '/repo/packages/agent/runtime/src/preview.ts';
  assert.equal(
    productSourceImportProblems(
      "import { View } from '../../../product/ui/src/index';",
      file,
      root,
    ).length,
    1,
  );
  assert.equal(
    productSourceImportProblems(
      "const app = import('../../../product/app/src/headless');",
      file,
      root,
    ).length,
    1,
  );
  assert.deepEqual(
    productSourceImportProblems(
      "import { FrameCanvas } from '@sue/board-react';",
      file,
      root,
    ),
    [],
  );
});
