import { createArchitectureFrameSnapshot } from '@sue/board-architecture';
import {
  applyCellOperations,
  createCellStore,
  createFrameCell,
} from '@sue/board-core';
import { createMindFrameSnapshot } from '@sue/board-mind';
import {
  createUmlClassFrameSnapshot,
  createUmlSequenceFrameSnapshot,
} from '@sue/board-uml';
import { createWorkflowFrameSnapshot } from '@sue/board-workflow';
import { describe, expect, it } from 'vitest';
import { createVerdFramePluginSet } from '../frame-plugins';
describe('full product clipboard contributions', () => {
  it.each([
    ['geometry', () => ({ store: createCellStore(createFrameCell('frame')) })],
    ['mind-root', () => createMindFrameSnapshot('frame', 'topic')],
    ['workflow-task', () => createWorkflowFrameSnapshot('frame', 'start')],
    [
      'architecture-module',
      () => createArchitectureFrameSnapshot('frame', 'layer'),
    ],
    ['uml-class', () => createUmlClassFrameSnapshot('frame', 'uml')],
    ['uml-participant', () => createUmlSequenceFrameSnapshot('frame', 'uml')],
  ] as const)(
    'routes text to %s without a sibling plugin claiming the paste',
    (kind, snapshot) => {
      const set = createVerdFramePluginSet(),
        { store } = snapshot();
      let count = 0;
      const request = {
        registry: set.registry,
        store,
        frameId: 'frame',
        at: [20, 30] as [number, number],
        text: 'Pasted text',
        allocateId: () => `paste-${++count}`,
      };
      const contributions = set.extensions
        .map((extension) => extension.plugin?.pasteText?.(request))
        .filter(Boolean);
      expect(contributions).toHaveLength(1);
      const operations = contributions[0]!;
      const next = applyCellOperations(store, operations, set.registry);
      expect(
        Object.values(next.cells).some(
          (cell) =>
            cell.kind === kind &&
            'content' in cell &&
            cell.content?.label === 'Pasted text',
        ),
      ).toBe(true);
    },
  );
  it('attaches an image to a Mind topic while the Draw plugin is also installed', () => {
    const set = createVerdFramePluginSet(),
      { store } = createMindFrameSnapshot('frame', 'topic');
    const request = {
      registry: set.registry,
      store,
      frameId: 'frame',
      hit: store.cells.topic,
      at: [20, 30] as [number, number],
      image: { url: 'data:image/png;base64,a', width: 50, height: 40 },
      allocateId: () => 'image',
    };
    const operations = set.extensions
      .map((extension) => extension.plugin?.pasteImage?.(request))
      .find(Boolean)!;
    expect(operations[0]).toMatchObject({
      type: 'replace_cell',
      cell: { id: 'topic', data: { image: request.image } },
    });
    expect(() =>
      applyCellOperations(store, operations, set.registry),
    ).not.toThrow();
  });
});
