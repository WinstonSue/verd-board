import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  testConcurrency,
  vitestArguments,
  defaultWebWorkers,
} from './test-concurrency.mjs';

test('unit process budget shrinks on small machines and rejects nested oversubscription', () => {
  assert.deepEqual(testConcurrency({}, 1), {
    budget: 1,
    packages: 1,
    workers: 1,
    scripts: 1,
    web: defaultWebWorkers,
    desktop: 1,
  });
  assert.deepEqual(
    vitestArguments(
      testConcurrency(
        { VERD_UNIT_TEST_PACKAGES: '2', VERD_UNIT_TEST_WORKERS: '2' },
        8,
      ),
    ),
    ['--maxWorkers=2', '--minWorkers=1'],
  );
  assert.equal(
    testConcurrency(
      { VERD_UNIT_TEST_PACKAGES: '4', VERD_UNIT_TEST_WORKERS: '1' },
      8,
    ).packages,
    4,
  );
  assert.throws(
    () =>
      testConcurrency(
        { VERD_UNIT_TEST_PACKAGES: '4', VERD_UNIT_TEST_WORKERS: '2' },
        8,
      ),
    /budget/,
  );
  for (const value of ['0', '-1', '1.5', 'four'])
    assert.throws(
      () => testConcurrency({ VERD_UNIT_TEST_WORKERS: value }, 8),
      /positive integer/,
    );
});
