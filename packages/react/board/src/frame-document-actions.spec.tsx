import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createCellStore,
  createDocumentFrameCell,
  createFrameCell,
} from '@sue/board-core';
import { FrameCanvas, type FrameDocumentReferences } from './frame-canvas';

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
