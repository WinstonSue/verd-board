import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { chooseComparison } from './benchmark-tests.mjs';

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
