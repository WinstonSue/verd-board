import {
  applyCellOperations,
  createCellStore,
  createDocumentFrameCell,
  createFrameCell,
  type CellTransaction,
  type FrameSnapshot,
} from '@sue/board-core';
import { createInlineText } from '@sue/board-common';
import { act, createRef, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestFramePluginSet } from '../../../../tests/fixtures/plugins/ui';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameDocumentReferences,
  type FrameIntentResult,
} from './frame-canvas';
const testFramePluginSet = createTestFramePluginSet();

// Keep the tests focused on the canvas barrier rather than ProseMirror input.
vi.mock('./frame-text-editor', () => ({
  FrameTextEditor: ({
    text,
    onChange,
  }: ComponentProps<typeof import('./frame-text-editor').FrameTextEditor>) => (
    <button
      data-test-text-commit
      onClick={() =>
        void onChange({ oldText: text, newText: createInlineText('Changed') })
      }
    >
      {text.plainText}
    </button>
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

async function mountHostText(kind: 'node' | 'edge' = 'node') {
  const frame = createFrameCell('root');
  frame.children = ['node', 'other', 'edge'];
  let value: FrameSnapshot = {
    store: {
      ...createCellStore(frame),
      cells: {
        root: frame,
        node: {
          id: 'node',
          name: 'Named node',
          kind: 'geometry',
          cellType: 'node',
          geometry: { x: 10, y: 10, width: 120, height: 60 },
          content: { label: 'Original' },
        },
        other: {
          id: 'other',
          kind: 'geometry',
          cellType: 'node',
          geometry: { x: 250, y: 10, width: 120, height: 60 },
        },
        edge: {
          id: 'edge',
          kind: 'arrow',
          cellType: 'edge',
          source: { cellId: 'node' },
          target: { cellId: 'other' },
          route: { mode: 'straight' },
          labels: [{ text: 'Original' }],
        },
      },
    },
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const controller = createRef<FrameCanvasController>();
  let acknowledge!: (result: FrameIntentResult) => void;
  let transaction!: CellTransaction;
  const onIntent = vi.fn(
    (next: CellTransaction) =>
      new Promise<FrameIntentResult>((resolve) => {
        transaction = next;
        acknowledge = resolve;
      }),
  );
  const render = () =>
    root.render(
      <FrameCanvas
        ref={controller}
        pluginSet={testFramePluginSet}
        value={value}
        frameId="root"
        autoFit={false}
        adapter={{ toFrameSnapshot: (snapshot: FrameSnapshot) => snapshot }}
        onIntent={onIntent}
      />,
    );
  await act(async () => render());
  if (kind === 'node') {
    await act(async () => {
      controller.current!.runtime.select({ focus: ['root'], ids: ['node'] });
      await controller.current!.executeAction('canvas.selection.edit');
    });
  } else
    await act(async () =>
      container
        .querySelector('[data-cell-id="edge"]')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
    );
  const editor = () =>
    container.querySelector<HTMLButtonElement>('[data-test-text-commit]')!;
  expect(editor()).toBeTruthy();
  return {
    controller,
    editor,
    onIntent,
    accept: (result: FrameIntentResult) => acknowledge(result),
    echo: async () =>
      act(async () => {
        value = {
          store: applyCellOperations(
            value.store,
            transaction.operations,
            controller.current!.runtime.registry,
          ),
        };
        render();
      }),
  };
}

for (const kind of ['node', 'edge'] as const) {
  it(`waits for both the ${kind} text host receipt and controlled content echo`, async () => {
    const view = await mountHostText(kind);
    await act(async () => view.editor().click());
    expect(view.onIntent).toHaveBeenCalledOnce();
    let settled = false;
    let barrier!: ReturnType<FrameCanvasController['flushEditing']>;
    await act(async () => {
      barrier = view.controller.current!.flushEditing();
      void barrier.then(() => {
        settled = true;
      });
      await Promise.resolve();
    });
    expect(settled).toBe(false);
    await act(async () => view.accept({ status: 'accepted' }));
    expect(settled).toBe(false);
    await view.echo();
    expect(await barrier).toEqual({ status: 'accepted' });
    expect(view.onIntent).toHaveBeenCalledOnce();
  });

  it(`reports a denied ${kind} text commit after the editor has closed`, async () => {
    const view = await mountHostText(kind);
    await act(async () => view.editor().click());
    let barrier!: ReturnType<FrameCanvasController['flushEditing']>;
    await act(async () => {
      barrier = view.controller.current!.flushEditing();
    });
    await act(async () =>
      view.accept({ status: 'rejected', message: 'Conflict' }),
    );
    expect(await barrier).toEqual({ status: 'rejected', message: 'Conflict' });
    await act(async () => {
      expect(await view.controller.current!.flushEditing()).toEqual({
        status: 'rejected',
        message: 'Conflict',
      });
    });
  });
}

it('rejects a canvas text flush during composition and permits it after composition ends', async () => {
  const view = await mountHostText();
  await act(async () =>
    view
      .editor()
      .dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true }),
      ),
  );
  expect(await view.controller.current!.flushEditing()).toEqual({
    status: 'rejected',
    message: 'composing',
  });
  expect(view.editor()).toBeTruthy();
  expect(view.onIntent).not.toHaveBeenCalled();
  await act(async () =>
    view
      .editor()
      .dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
  );
  let result!: FrameIntentResult;
  await act(async () => {
    result = await view.controller.current!.flushEditing();
  });
  expect(result).toEqual({ status: 'accepted' });
  expect(view.onIntent).not.toHaveBeenCalled();
});

for (const outcome of ['completed', 'rejected'] as const)
  it(`waits for an embedded document ${outcome} receipt before leaving its editing occurrence`, async () => {
    const frame = createFrameCell('root');
    frame.children = ['document'];
    const value = {
      store: {
        ...createCellStore(frame),
        cells: {
          root: frame,
          document: createDocumentFrameCell('document', 'source', {
            x: 10,
            y: 10,
            width: 540,
            height: 440,
          }),
        },
      },
    };
    let acknowledge!: (
      result: Awaited<
        ReturnType<NonNullable<FrameDocumentReferences['flushEditing']>>
      >,
    ) => void;
    const receipt = new Promise<
      Awaited<ReturnType<NonNullable<FrameDocumentReferences['flushEditing']>>>
    >((resolve) => {
      acknowledge = resolve;
    });
    const flush = vi.fn(() => receipt);
    const savedView = {
      cellId: 'document',
      state: { hostProtocol: 'opaque', offset: 12 },
    };
    const restoreView = vi.fn(
      async (_view: unknown, activate: (id: string) => void) => {
        activate('root/document');
        return { status: 'completed' as const };
      },
    );
    const references: FrameDocumentReferences = {
      title: () => 'Source',
      flushEditing: flush,
      captureEditingView: () => savedView,
      restoreEditingView: restoreView,
      render: (props) => (
        <div data-body-editing={props.editing ? 'yes' : 'no'}>Body</div>
      ),
    };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const controller = createRef<FrameCanvasController>();
    await act(async () =>
      root.render(
        <FrameCanvas
          ref={controller}
          pluginSet={testFramePluginSet}
          value={value}
          autoFit={false}
          onChange={vi.fn()}
          documentReferences={references}
        />,
      ),
    );
    await act(async () =>
      container
        .querySelector('[data-body-editing]')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
    );
    expect(container.querySelector('[data-body-editing="yes"]')).toBeTruthy();
    expect(controller.current!.captureDocumentEditingView()).toEqual(savedView);
    await act(async () => {
      expect(
        await controller.current!.restoreDocumentEditingView(savedView),
      ).toEqual({ status: 'completed' });
    });
    expect(restoreView).toHaveBeenCalledWith(
      savedView,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    // Pointer capture runs before a navigation button's click handler.
    await act(async () =>
      document.body.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true }),
      ),
    );
    expect(flush).toHaveBeenCalledWith('root/document');
    expect(container.querySelector('[data-body-editing="yes"]')).toBeTruthy();
    let settled = false;
    let barrier!: ReturnType<FrameCanvasController['flushEditing']>;
    await act(async () => {
      barrier = controller.current!.flushEditing();
      void barrier.then(() => {
        settled = true;
      });
      await Promise.resolve();
    });
    expect(settled).toBe(false);
    await act(async () =>
      acknowledge(
        outcome === 'completed'
          ? { status: 'completed' }
          : { status: 'rejected', code: 'host-rejected', message: 'Conflict' },
      ),
    );
    expect(await barrier).toEqual(
      outcome === 'completed'
        ? { status: 'accepted' }
        : { status: 'rejected', message: 'Conflict' },
    );
    expect(container.querySelector('[data-body-editing="yes"]') !== null).toBe(
      outcome !== 'completed',
    );
    await act(async () => {
      expect(await controller.current!.flushEditing()).toEqual(
        outcome === 'completed'
          ? { status: 'accepted' }
          : { status: 'rejected', message: 'Conflict' },
      );
    });
  });

it('keeps document shell actions outside the body, isolates pointer gestures and omits actions from exports', async () => {
  const frame = createFrameCell('root');
  frame.children = ['document'];
  const document = createDocumentFrameCell('document', 'source', {
    x: 10,
    y: 10,
    width: 540,
    height: 440,
  });
  const value = {
    store: { ...createCellStore(frame), cells: { root: frame, document } },
  };
  const opened = vi.fn();
  const changed = vi.fn();
  const references: FrameDocumentReferences = {
    title: () => 'A very long source document title',
    renderHeaderActions: (props) => (
      <>
        <button type="button" onClick={opened}>
          Details
        </button>
        {props.editing && (
          <button type="button" onClick={props.onExitEdit}>
            Done
          </button>
        )}
      </>
    ),
    render: (props) => (
      <div data-body-editing={props.editing ? 'yes' : 'no'}>Body</div>
    ),
  };
  container = window.document.createElement('div');
  window.document.body.append(container);
  root = createRoot(container);
  const render = async (exporting = false, readonly = false) =>
    act(async () =>
      root.render(
        <FrameCanvas
          pluginSet={testFramePluginSet}
          value={value}
          frameId="root"
          autoFit={false}
          onChange={changed}
          documentReferences={references}
          exporting={exporting}
          readonly={readonly}
          tool={{ mode: 'select' }}
        />,
      ),
    );
  await render();
  const header = container.querySelector('[data-document-header-actions]')!;
  expect(header.closest('foreignObject')).toBe(header);
  expect(
    header.querySelector('button')!.closest('[data-document-preview-body]'),
  ).toBeNull();
  expect(header.hasAttribute('data-frame-export-exclude')).toBe(true);
  const button = header.querySelector('button')!;
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 500,
        clientY: 25,
        buttons: 1,
      }),
    );
    container.querySelector('svg')!.dispatchEvent(
      new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 600,
        clientY: 100,
        buttons: 1,
      }),
    );
    container.querySelector('svg')!.dispatchEvent(
      new MouseEvent('pointerup', {
        bubbles: true,
        clientX: 600,
        clientY: 100,
      }),
    );
    button.click();
  });
  expect(opened).toHaveBeenCalledTimes(1);
  expect(changed).not.toHaveBeenCalled();
  await act(async () =>
    container
      .querySelector('[data-body-editing]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
  );
  expect(container.querySelector('[data-body-editing="yes"]')).toBeTruthy();
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((node) => node.textContent === 'Done')!
      .click(),
  );
  expect(container.querySelector('[data-body-editing="no"]')).toBeTruthy();
  await render(false, true);
  expect(
    container.querySelector('[data-document-header-actions] button'),
  ).toBeTruthy();
  await render(true);
  expect(container.querySelector('[data-document-header-actions]')).toBeNull();
});
