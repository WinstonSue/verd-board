import { collectStages, assertStagesPassed } from './gate-runner.mjs';
import { runCommand } from './quality-gate.mjs';

const projects = [
  'apps/desktop/tsconfig.typecheck.json',
  'packages/product/app/tsconfig.json',
  'tsconfig.cells.json',
  'apps/service/tsconfig.json',
  'apps/web/tsconfig.app.json',
  'packages/workspace/core/tsconfig.json',
];
assertStagesPassed(
  await collectStages(
    projects.map((project) => ({
      id: project,
      run: () => runCommand('pnpm', ['exec', 'tsc', '--noEmit', '-p', project]),
    })),
  ),
);
