import { expect, it } from 'vitest';
import { createArchitectureFrameSnapshot } from '@sue/board-architecture';
import { createArchitecturePlacementTool } from './placement-tool';
it('uses the same stable draft and final placement without mutating the source', () => {
  const snapshot = createArchitectureFrameSnapshot('frame', 'layer');
  const original = JSON.stringify(snapshot);
  const tool = createArchitecturePlacementTool('layer', 'zh', () => {});
  if (!('complete' in tool)) throw new Error('Missing placement tool');
  const context = { zoom: 1, idFor: () => 'new-layer' };
  const points: [number, number][] = [
    [300, 200],
    [760, 460],
  ];
  const preview = tool.preview!(snapshot.store, 'frame', points, context);
  expect(preview).toEqual(
    tool.complete(snapshot.store, 'frame', points, context),
  );
  expect(preview[0]).toMatchObject({
    type: 'insert_cell',
    cell: {
      id: 'new-layer',
      geometry: { x: 300, y: 200, width: 460, height: 260, derived: false },
      data: { memberIds: [] },
    },
  });
  expect(JSON.stringify(snapshot)).toBe(original);
});
