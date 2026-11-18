import path from 'node:path';
import { ROOT, hash, sourceInventory } from './release-review.mjs';
import { releaseInputs } from './release-proof.mjs';
import {
  collectStages,
  assertStagesPassed,
  writeRecord,
} from './gate-runner.mjs';
import { runCommand, localTestExecutionAllowed } from './quality-gate.mjs';
import { testConcurrency } from './test-concurrency.mjs';

if (!localTestExecutionAllowed())
  throw new Error('Script validation runs on the test host');
const files = process.argv.slice(2);
if (
  !files.length ||
  files.some((file) => !/^scripts\/[\w.-]+\.test\.mjs$/.test(file))
)
  throw new Error('Select script test files');
const identity = await releaseInputs();
const record = {
  mode: 'scripts',
  status: 'running',
  sourceDigest: hash(await sourceInventory()),
  identity,
  selection: files,
  steps: [],
};
const checks = [
  ['lint', 'pnpm', ['lint']],
  ['format', 'pnpm', ['format:check']],
  [
    'scripts',
    process.execPath,
    ['--test', '--test-concurrency=' + testConcurrency().scripts, ...files],
  ],
];
try {
  const result = await collectStages(
    checks.map(([id, command, args]) => ({
      id,
      run: () => runCommand(command, args),
    })),
    {
      checkpoint: async () => {
        if (
          (await releaseInputs()).releaseInputDigest !==
          identity.releaseInputDigest
        )
          throw new Error('Source changed during script validation');
      },
    },
  );
  Object.assign(record, result, { steps: result.stages });
  delete record.stages;
  assertStagesPassed(result);
} finally {
  if (record.status === 'running') record.status = 'failed';
  await writeRecord(path.join(ROOT, '.quality/scripts.json'), record);
}
