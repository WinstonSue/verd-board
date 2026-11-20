import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { chooseComparison, benchmarkWebFiles } from './benchmark-tests.mjs';
import { runtimeTests } from './e2e-selection.cjs';

test('runtime selections preserve nested paths and distinguish identical filenames', () => {
  const catalog = {
    units: [
      {
        host: 'web',
        runtime: 'production',
        tests: [
          'tests/web-e2e/src/canvas/edit.spec.ts',
          'tests/web-e2e/src/documents/edit.spec.ts',
        ],
      },
      {
        host: 'desktop',
        runtime: 'production',
        tests: ['tests/desktop-e2e/src/edit.spec.ts'],
      },
    ],
  };
  assert.deepEqual(runtimeTests('web', 'production', catalog), [
    '**/src/canvas/edit.spec.ts',
    '**/src/documents/edit.spec.ts',
  ]);
  assert.throws(
    () => runtimeTests('web', 'development', catalog),
    /No classified/,
  );
});

test('benchmark selections follow each runtime catalog after browser coverage migration', () => {
  for (const [mode, runtime] of [
    ['dev', 'development'],
    ['prod', 'production'],
  ]) {
    const registered = runtimeTests('web', runtime);
    for (const file of benchmarkWebFiles(mode))
      assert.ok(registered.includes('**/src/' + file), mode + ': ' + file);
  }
  assert.throws(() => benchmarkWebFiles('unknown'), /Unknown/);
});

test('parallel promotion requires the same passing cases, measured memory and ten percent improvement', () => {
  const baseline = {
    status: 'passed',
    cases: ['a', 'b'],
    durationMs: 1000,
    peakRssBytes: 1000,
    memoryPressure: {
      samples: 2,
      peakLevel: 1,
      pageoutsDelta: 0,
      swapoutsDelta: 0,
      errors: [],
    },
  };
  const faster = { ...baseline, durationMs: 850 };
  assert.equal(chooseComparison(baseline, faster), true);
  for (const candidate of [
    { ...faster, status: 'failed' },
    { ...faster, cases: ['a'] },
    { ...faster, durationMs: 950 },
    { ...faster, peakRssBytes: 0 },
    { ...faster, peakRssBytes: os.totalmem() },
    { ...faster, peakRssBytes: baseline.peakRssBytes + 1 },
    { ...faster, memoryPressure: null },
    { ...faster, memoryPressure: { ...baseline.memoryPressure, peakLevel: 2 } },
    {
      ...faster,
      memoryPressure: { ...baseline.memoryPressure, swapoutsDelta: 1 },
    },
    {
      ...faster,
      memoryPressure: { ...baseline.memoryPressure, pageoutsDelta: 1 },
    },
    {
      ...faster,
      memoryPressure: { ...baseline.memoryPressure, errors: ['unavailable'] },
    },
  ])
    assert.equal(chooseComparison(baseline, candidate), false);
});
