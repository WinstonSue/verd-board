import fs from 'node:fs/promises';
import path from 'node:path';
import { digest } from './test-catalog.mjs';
import { writeRecord } from './gate-runner.mjs';

export function verificationCache(root, env = process.env) {
  if (env.VERD_VERIFICATION_CACHE) {
    const configured = env.VERD_VERIFICATION_CACHE;
    return configured.startsWith('~/')
      ? path.join(env.HOME, configured.slice(2))
      : path.resolve(root, configured);
  }
  return path.join(root, '.quality/verification-cache');
}

export function validVerification(proof, unit) {
  if (!proof) return false;
  const { digest: checksum, ...body } = proof;
  return (
    proof.format === 'verd-unit-verification' &&
    proof.version === 1 &&
    proof.status === 'passed' &&
    proof.unit === unit.id &&
    proof.fingerprint === unit.fingerprint &&
    proof.complete === true &&
    Array.isArray(proof.stages) &&
    proof.stages.length > 0 &&
    proof.stages.every(
      (stage) =>
        stage.id &&
        stage.status === 'passed' &&
        (stage.exitCode === undefined || stage.exitCode === 0),
    ) &&
    Boolean(proof.runId && proof.finishedAt) &&
    digest(proof.tests) === digest(unit.tests) &&
    checksum === digest(body)
  );
}

export async function readVerification(directory, unit) {
  const proof = await fs
    .readFile(path.join(directory, unit.fingerprint + '.json'), 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    });
  return validVerification(proof, unit) ? proof : null;
}

export async function saveVerification(
  directory,
  unit,
  runId,
  stages,
  env = process.env,
) {
  // Untrusted PR runs may consume a default-branch baseline, but never publish one.
  if (env.GITHUB_ACTIONS === 'true' && env.VERD_VERIFICATION_WRITE !== '1')
    return;
  if (!stages.length || stages.some((stage) => stage.status !== 'passed'))
    throw new Error('Cannot save incomplete verification: ' + unit.id);
  const proof = {
    format: 'verd-unit-verification',
    version: 1,
    unit: unit.id,
    fingerprint: unit.fingerprint,
    tests: unit.tests,
    status: 'passed',
    complete: true,
    runId,
    finishedAt: new Date().toISOString(),
    stages: stages.map(({ id, status, exitCode }) => ({
      id,
      status,
      exitCode,
    })),
  };
  proof.digest = digest(proof);
  await writeRecord(path.join(directory, unit.fingerprint + '.json'), proof);
  return proof;
}
