import fs from 'node:fs/promises';
import {
  ROOT,
  plannedTargets,
  checkReleaseReview,
  snapshot,
  readCurrentReview,
} from './release-review.mjs';
import { runCommand, runGate } from './quality-gate.mjs';

const mode = process.argv[2];
if (process.argv.length !== 3)
  throw new Error('Usage: release.mjs version | publish');
if (mode === 'version') {
  const targets = await plannedTargets();
  await checkReleaseReview(ROOT, { prepared: false, targets });
  const before = await snapshot();
  await runCommand('pnpm', ['changeset', 'version']);
  await runCommand(process.execPath, ['scripts/sync-product-version.mjs']);
  const after = await snapshot();
  if (before.sourceDigest !== after.sourceDigest)
    throw new Error(
      'Version preparation changed reviewed business inputs; regenerate and complete the review for the prepared versions',
    );
  const { record, file } = await readCurrentReview();
  record.versions = after.versions;
  await fs.writeFile(file, JSON.stringify(record, null, 2) + '\n');
  await checkReleaseReview();
} else if (mode === 'publish') {
  await runGate('release');
  await runCommand('pnpm', ['changeset', 'publish']);
} else throw new Error('Unknown release mode: ' + mode);
