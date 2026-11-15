import { describe, expect, it } from 'vitest';
import { createFrameCell } from '@sue/board-core';
import { createFrameFile } from '../frames/frame-files';
import { cellOwnerIndex, resolveWorkspaceTarget } from './target-navigation';

describe('workspace target ownership', () => {
  const node = {
    id: 'module',
    kind: 'geometry',
    cellType: 'node' as const,
    geometry: { x: 0, y: 0, width: 40, height: 20 },
  };
  const source = createFrameFile(createFrameCell('source'));
  const destination = {
    ...createFrameFile(createFrameCell('destination')),
    cells: { module: node },
  };
  it('follows a stable cell identity after a move to another file', () => {
    const files = new Map([
      ['source', { file: source }],
      ['destination', { file: destination }],
    ]);
    expect(
      resolveWorkspaceTarget(
        { kind: 'cell', fileId: 'source', cellId: 'module' },
        files,
        new Map(),
      ),
    ).toEqual({
      status: 'resolved',
      target: { kind: 'cell', fileId: 'destination', cellId: 'module' },
    });
  });
  it('reports ambiguous IDs instead of choosing the first file', () => {
    const duplicate = { ...source, cells: destination.cells };
    expect(cellOwnerIndex([duplicate, destination]).get('module')).toBeNull();
    expect(
      resolveWorkspaceTarget(
        { kind: 'cell', fileId: 'source', cellId: 'module' },
        new Map([
          ['source', { file: duplicate }],
          ['destination', { file: destination }],
        ]),
        new Map(),
      ),
    ).toMatchObject({ status: 'unavailable', code: 'ambiguous-cell' });
  });
  it('retains an existing file fallback for a deleted target', () => {
    expect(
      resolveWorkspaceTarget(
        { kind: 'cell', fileId: 'source', cellId: 'missing' },
        new Map([['source', { file: source }]]),
        new Map(),
      ),
    ).toEqual({
      status: 'unavailable',
      code: 'missing-cell',
      fallback: { kind: 'file', fileId: 'source' },
    });
  });
});
