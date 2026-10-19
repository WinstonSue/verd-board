import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import {
  createCellRegistry,
  applyCellOperations,
  type EdgeCell,
} from '@sue/board-core';
import { FrameCanvas, type FrameCanvasController } from '@sue/board-react';
import { cloneFrameImageSvg } from '../../board/src/frame-export';
import {
  createUmlSequenceFrameSnapshot,
  createUmlParticipantCell,
  createUmlMessageCell,
  createUmlFragmentCell,
  addUmlCell,
  addUmlActivation,
  layoutUmlSequence,
} from '@sue/board-uml';
import { createUmlFrameExtensions } from './index';
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it('renders projected message routes, activation and fragments without persisting derived geometry', async () => {
  const registry = createCellRegistry(),
    extensions = createUmlFrameExtensions(registry);
  let store = createUmlSequenceFrameSnapshot('f', 'root').store;
  for (const id of ['a', 'b'])
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlParticipantCell(id)),
      registry,
    );
  const message = createUmlMessageCell('message', 'a', 'b');
  message.labels = [{ text: 'Long message '.repeat(40) }];
  store = applyCellOperations(store, addUmlCell(store, 'f', message), registry);
  store = applyCellOperations(
    store,
    addUmlCell(store, 'f', createUmlFragmentCell('loop', 'loop')),
    registry,
  );
  let n = 0;
  store = applyCellOperations(
    store,
    addUmlActivation(store, 'f', 'b', 0, 1, () => `event${n++}`),
    registry,
  );
  const before = JSON.stringify(store),
    container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    controller = createRef<FrameCanvasController>();
  const rect = vi
    .spyOn(SVGSVGElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({
      x: 0,
      y: 0,
      width: 1000,
      height: 700,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 700,
      toJSON() {},
    } as DOMRect);
  try {
    await act(async () =>
      root.render(
        <FrameCanvas
          ref={controller}
          value={{ store }}
          registry={registry}
          extensions={extensions}
          autoFit={false}
        />,
      ),
    );
    expect(container.querySelectorAll('[data-uml-lifeline]')).toHaveLength(2);
    expect(container.querySelector('[data-uml-activation]')).not.toBeNull();
    expect(container.querySelector('[data-uml-fragment]')).not.toBeNull();
    const image = cloneFrameImageSvg(container.querySelector('svg')!);
    expect(image.querySelector('[data-uml-activation]')).not.toBeNull();
    expect(image.querySelector('[data-frame-export-exclude]')).toBeNull();
    const bounds = controller.current!.getContentBounds();
    const layout = layoutUmlSequence(store, 'f');
    expect(bounds.height).toBeGreaterThan(300);
    expect((layout.edges.get('message') as EdgeCell).route.mode).toBe('fixed');
    expect(JSON.stringify(controller.current!.runtime.store)).toBe(before);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    rect.mockRestore();
  }
});
