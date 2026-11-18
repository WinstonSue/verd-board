import os from 'node:os';
import profile from './test-profile.json' with { type: 'json' };

export const defaultWebWorkers = profile.webWorkers;

export function testConcurrency(
  env = process.env,
  cpus = os.availableParallelism(),
) {
  const budget = Math.max(1, Math.min(4, cpus));
  const integer = (name, fallback) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1)
      throw new Error(name + ' must be a positive integer');
    return value;
  };
  const packages = integer(
    'VERD_UNIT_TEST_PACKAGES',
    Math.min(profile.unitPackages, budget),
  );
  const workers = integer(
    'VERD_UNIT_TEST_WORKERS',
    Math.min(profile.unitWorkers, Math.floor(budget / packages)),
  );
  if (packages * workers > budget)
    throw new Error(
      'Unit package and worker concurrency exceeds CPU budget ' + budget,
    );
  return {
    budget,
    packages,
    workers,
    scripts: Math.min(2, budget),
    web: profile.webWorkers,
    desktop: 1,
  };
}

export const vitestArguments = (settings = testConcurrency()) => [
  '--maxWorkers=' + settings.workers,
  '--minWorkers=1',
];
