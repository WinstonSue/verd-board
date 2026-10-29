import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { validateCellStore } from '@sue/board-core';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';

it('retains the real legacy text marks in a valid minimal workflow fixture', () => {
  const file = JSON.parse(
    readFileSync(
      path.resolve(
        process.cwd(),
        '../../../tests/fixtures/diagrams/theme-text-sources.verd.json',
      ),
      'utf8',
    ),
  );
  expect(
    validateCellStore(
      {
        rootId: file.frame.id,
        cells: { ...file.cells, [file.frame.id]: file.frame },
      },
      createTestCellRegistry(),
    ),
  ).toEqual([]);
  expect(JSON.stringify(file.cells['text-task'].content.text)).toContain(
    '#24354b',
  );
});
