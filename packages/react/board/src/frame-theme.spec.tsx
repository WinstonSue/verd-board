import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import {
  applyCellOperations,
  createCellStore,
  createFrameCell,
  ThemeColorMode,
  type FrameSnapshot,
} from '@sue/board-core';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';
import { createTestFramePluginSet } from '../../../../tests/fixtures/plugins/ui';
import { FrameCanvas, type FrameCanvasController } from './frame-canvas';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('changes cached Rough shapes and surfaces without changing content, camera, selection, or history', async () => {
  const registry = createTestCellRegistry();
  const frame = createFrameCell('root');
  frame.view = {
    theme: {
      themeColorMode: ThemeColorMode.default,
      boardBackground: '#f8fafc',
    },
  };
  const value: FrameSnapshot = {
    store: applyCellOperations(
      createCellStore(frame),
      [
        {
          type: 'insert_cell',
          parentId: 'root',
          cell: {
            id: 'shape',
            kind: 'geometry',
            cellType: 'node',
            geometry: { x: 10, y: 20, width: 120, height: 60 },
            appearance: { fill: '#fff', strokeColor: '#64748b' },
            content: { label: 'Theme test' },
          },
        },
      ],
      registry,
    ),
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    controller = createRef<FrameCanvasController>(),
    onChange = vi.fn();
  const pluginSet = createTestFramePluginSet();
  const render = (appearance?: 'light' | 'dark') =>
    act(async () =>
      root.render(
        <FrameCanvas
          ref={controller}
          value={value}
          pluginSet={pluginSet}
          appearance={appearance}
          onChange={onChange}
          autoFit={false}
        />,
      ),
    );
  try {
    await render('light');
    const runtime = controller.current!.runtime;
    await act(async () => runtime.select({ focus: ['root'], ids: ['shape'] }));
    const store = JSON.stringify(runtime.store),
      camera = controller.current!.getCamera(),
      history = runtime.history;
    const svg = container.querySelector('svg')!,
      shape = () => container.querySelector('[data-cell-id="shape"]')!;
    const lightFill = shape().getAttribute('fill');
    const roughFill = () =>
      shape()
        .querySelector('[data-shape-renderer="rough"] path')
        ?.getAttribute('fill');
    const lightRough = roughFill();
    await render('dark');
    expect(container.querySelector('svg')).toBe(svg);
    expect(shape().getAttribute('fill')).not.toBe(lightFill);
    expect(roughFill()).not.toBe(lightRough);
    expect(svg.getAttribute('data-board-appearance')).toBe('dark');
    await render('light');
    expect(shape().getAttribute('fill')).toBe(lightFill);
    expect(roughFill()).toBe(lightRough);
    expect(JSON.stringify(runtime.store)).toBe(store);
    expect(runtime.selection.ids).toEqual(['shape']);
    expect(controller.current!.getCamera()).toEqual(camera);
    expect(runtime.history).toBe(history);
    expect(onChange).not.toHaveBeenCalled();
    await render();
    expect(shape().getAttribute('fill')).toBe('#fff');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('restores embedded document interactivity after changing appearance while settings suspend the canvas', async () => {
  const registry = createTestCellRegistry(),
    frame = createFrameCell('root');
  const value: FrameSnapshot = {
    store: applyCellOperations(
      createCellStore(frame),
      [
        {
          type: 'insert_cell',
          parentId: 'root',
          cell: {
            id: 'doc',
            kind: 'document-frame',
            cellType: 'node',
            geometry: { x: 0, y: 0, width: 400, height: 300 },
            data: { targetDocumentId: 'document' },
          },
        },
      ],
      registry,
    ),
  };
  const container = document.createElement('div'),
    root = createRoot(container);
  const references = {
    title: () => 'Document',
    render: (props: { readonly?: boolean }) => (
      <div data-preview-readonly={String(props.readonly)}>Body</div>
    ),
  };
  const onChange = vi.fn();
  const render = (appearance: 'light' | 'dark', suspended: boolean) =>
    act(async () =>
      root.render(
        <FrameCanvas
          value={value}
          registry={registry}
          documentReferences={references}
          appearance={appearance}
          suspended={suspended}
          onChange={onChange}
          autoFit={false}
        />,
      ),
    );
  try {
    await render('light', false);
    expect(
      container
        .querySelector('[data-preview-readonly]')!
        .getAttribute('data-preview-readonly'),
    ).toBe('false');
    await render('dark', true);
    expect(
      container
        .querySelector('[data-preview-readonly]')!
        .getAttribute('data-preview-readonly'),
    ).toBe('true');
    await render('dark', false);
    expect(
      container
        .querySelector('[data-preview-readonly]')!
        .getAttribute('data-preview-readonly'),
    ).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
