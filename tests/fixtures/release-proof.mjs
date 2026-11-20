import { fullStageIds } from '../../scripts/release-proof.mjs';
import { digest } from '../../scripts/test-catalog.mjs';

export function releaseProofFixture(identity, extra = {}) {
  const unit = {
    id: 'fixture:unit',
    fingerprint: 'fixture-input',
    tests: ['fixture.spec.ts'],
    action: 'run',
  };
  const verification = {
    format: 'verd-test-plan',
    version: 1,
    mode: 'release',
    catalogDigest: 'fixture',
    units: [unit],
  };
  verification.digest = digest(verification);
  const requiredStages = [...fullStageIds, 'fixture:unit'];
  return {
    format: 'verd-quality',
    version: 3,
    runId: 'same-run',
    mode: 'release',
    status: 'passed',
    selection: null,
    identity,
    verification,
    planDigest: verification.digest,
    requiredStages,
    stageUnits: { 'fixture:unit': ['fixture:unit'] },
    steps: requiredStages.map((id) => ({
      id,
      status: 'passed',
      ...(id === unit.id ? { units: [unit.id], args: unit.tests } : {}),
    })),
    ...extra,
  };
}
