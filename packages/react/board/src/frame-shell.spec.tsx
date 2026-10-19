import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createDocumentFrameCell,
  createDocumentReferenceCell,
  createFrameCell,
  createFrameReferenceCell,
  frameContentViewport,
  frameTitleBounds,
  type NodeCell,
} from '@sue/board-core';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameDocumentReferences,
} from './frame-canvas';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('keeps document reading and active document editing outside native drag cancellation', async () => {
  const geometry = { x: 10, y: 20, width: 400, height: 300 };
  const editable = createDocumentFrameCell('editable', 'document', geometry);
  const reference = createDocumentReferenceCell(
    'reference',
    'document',
    geometry,
  );
  const frame = createFrameCell('root');
  frame.children = [editable.id, reference.id];
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(() => root.unmount());
    container.remove();
  });
  await act(() =>
    root.render(
      <FrameCanvas
        value={{
          store: {
            rootId: frame.id,
            cells: { root: frame, editable, reference },
          },
        }}
        autoFit={false}
        onChange={() => {}}
        documentReferences={{
          title: () => 'Document',
          render: ({ editing, cellId }) => (
            <p
              data-test-document-text={cellId}
              contentEditable={editing}
              suppressContentEditableWarning
            >
              Selectable document body
            </p>
          ),
        }}
      />,
    ),
  );
  const body = (id: string) =>
    container.querySelector(`[data-test-document-text="${id}"]`)!;
  const down = async (id: string) => {
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    await act(() => body(id).dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(body(id).closest('[data-frame-rich-text]')).toBeNull();
  };
  await down(reference.id);
  await act(() =>
    body(editable.id).dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    ),
  );
  expect(body(editable.id).getAttribute('contenteditable')).toBe('true');
  await down(editable.id);
});

it('invalidates one document body by dependency token on a stable adapter instead of unrelated canvas changes', async () => {
  const geometry = { x: 10, y: 20, width: 400, height: 300 };
  const documentFrame = createDocumentFrameCell(
    'document-frame',
    'source',
    geometry,
  );
  const title: NodeCell = {
    id: 'title',
    kind: 'geometry',
    cellType: 'node',
    geometry,
  };
  const board = {
    ...createFrameCell('root'),
    children: [documentFrame.id, title.id],
  };
  const value = {
    store: {
      rootId: board.id,
      cells: { root: board, 'document-frame': documentFrame, title },
    },
  };
  let revision = {},
    targetRevision = {},
    text = 'Original body';
  const body = vi.fn(() => <div>{text}</div>);
  const getRevision = vi.fn(() => targetRevision);
  const adapter = (): FrameDocumentReferences => ({
    get revision() {
      return revision;
    },
    getRevision,
    title: () => 'Document',
    render: body,
  });
  let references = adapter();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const controller = createRef<FrameCanvasController>();
  cleanups.push(async () => {
    await act(() => root.unmount());
    container.remove();
  });
  const render = async () =>
    act(() =>
      root.render(
        <FrameCanvas
          ref={controller}
          value={value}
          autoFit={false}
          documentReferences={references}
        />,
      ),
    );
  await render();
  expect(getRevision).toHaveBeenCalledWith('source');
  await act(() =>
    controller.current!.runtime.transact({
      id: 'move-title',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...title, geometry: { ...title.geometry, x: 20 } },
        },
      ],
    }),
  );
  references = adapter();
  await render();
  expect(body).toHaveBeenCalledTimes(1);
  text = 'Updated body';
  targetRevision = {};
  revision = {};
  await render();
  expect(body).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('Updated body');
});

it('keeps document bodies cached during parent selection and refreshes editing or source renderers', async () => {
  const geometry = { x: 10, y: 20, width: 400, height: 300 };
  const documentFrame = createDocumentFrameCell(
    'document-frame',
    'source',
    geometry,
  );
  const a: NodeCell = { id: 'a', kind: 'geometry', cellType: 'node', geometry };
  const b = { ...a, id: 'b' };
  const board = {
    ...createFrameCell('root'),
    children: [documentFrame.id, a.id, b.id],
  };
  const value = {
    store: {
      rootId: board.id,
      cells: { root: board, 'document-frame': documentFrame, a, b },
    },
  };
  const body = vi.fn<FrameDocumentReferences['render']>((props) => (
    <div data-test-document-editing={String(props.editing)}>
      Body
      {props.editing && <button onClick={props.onExitEdit}>Exit</button>}
    </div>
  ));
  let references: FrameDocumentReferences = {
    title: () => 'Document',
    render: body,
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const controller = createRef<FrameCanvasController>();
  cleanups.push(async () => {
    await act(() => root.unmount());
    container.remove();
  });
  const render = async () =>
    act(() =>
      root.render(
        <FrameCanvas
          ref={controller}
          value={value}
          autoFit={false}
          onChange={() => {}}
          documentReferences={references}
        />,
      ),
    );
  await render();
  for (const id of [a.id, b.id, a.id])
    await act(() =>
      controller.current!.runtime.select({ focus: [board.id], ids: [id] }),
    );
  expect(body).toHaveBeenCalledTimes(1);
  await act(() =>
    container
      .querySelector('[data-test-document-editing]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
  );
  expect(
    container.querySelector('[data-test-document-editing="true"]'),
  ).not.toBeNull();
  await act(() =>
    container.querySelector<HTMLButtonElement>('button')!.click(),
  );
  expect(
    container.querySelector('[data-test-document-editing="false"]'),
  ).not.toBeNull();
  const updated = vi.fn(() => <div>Updated source</div>);
  references = { ...references, render: updated };
  await render();
  expect(updated).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Updated source');
});

it('renders owned Frames and canvas/document references through one clipped shell with the border last', async () => {
  const geometry = { x: 10, y: 20, width: 400, height: 300 };
  const frame = createFrameCell('frame', geometry);
  const reference = createFrameReferenceCell('reference', 'target', geometry);
  const editable = createDocumentFrameCell('editable', 'document', geometry);
  const readonly = createDocumentReferenceCell(
    'readonly',
    'document',
    geometry,
  );
  const target = createFrameCell('target');
  const rootFrame = createFrameCell('root');
  rootFrame.children = [frame.id, reference.id, editable.id, readonly.id];
  const value = {
    store: {
      rootId: rootFrame.id,
      cells: { root: rootFrame, frame, reference, editable, readonly, target },
    },
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(() => root.unmount());
    container.remove();
  });
  await act(() =>
    root.render(
      <FrameCanvas
        value={value}
        autoFit={false}
        documentReferences={{
          title: () => 'Source document',
          renderHeaderActions: () => <button type="button">Details</button>,
          render: () => <div>Body</div>,
        }}
      />,
    ),
  );
  const title = frameTitleBounds(geometry);
  const content = frameContentViewport(geometry);
  for (const id of rootFrame.children) {
    const group = container.querySelector(`[data-cell-id="${id}"]`)!;
    const shell = group.querySelector(':scope > [data-frame-shell]')!;
    const outline = group.querySelector(':scope > [data-frame-outline]')!;
    const header = group.querySelector(':scope > [data-frame-header]')!;
    const contents = group.querySelector(':scope > [data-frame-contents]')!;
    expect(shell.getAttribute('rx')).toBe('12');
    expect(outline.getAttribute('rx')).toBe('12');
    expect(outline.getAttribute('pointer-events')).toBe('none');
    expect(
      outline.compareDocumentPosition(header) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(
      outline.compareDocumentPosition(contents) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    const text = group.querySelector('[data-frame-title-text]')!;
    expect(text.getAttribute('x')).toBe(String(title.x));
    expect(text.getAttribute('y')).toBe(String(title.y));
    expect(text.getAttribute('height')).toBe(String(title.height));
    const clipId = contents.getAttribute('clip-path')!.slice(5, -1);
    const clip = document.getElementById(clipId)!.querySelector('rect')!;
    for (const [key, dimension] of Object.entries(content))
      expect(clip.getAttribute(key)).toBe(String(dimension));
    if (id === editable.id || id === readonly.id) {
      const body = contents.querySelector('foreignObject')!;
      for (const [key, dimension] of Object.entries(content))
        expect(body.getAttribute(key)).toBe(String(dimension));
      const actions = group.querySelector('[data-document-header-actions]')!;
      expect(actions.closest('[data-frame-header]')).toBe(header);
      expect(actions.hasAttribute('data-frame-export-exclude')).toBe(true);
      expect(Number(text.getAttribute('width'))).toBeLessThan(title.width);
    }
  }
});
