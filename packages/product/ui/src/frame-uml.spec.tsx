import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  createCellRegistry,
  applyCellOperations,
  type CellStore,
} from '@sue/board-core';
import {
  createUmlClassFrameSnapshot,
  createUmlClassCell,
  createUmlSequenceFrameSnapshot,
  addUmlCell,
  registerUmlCells,
} from '@sue/board-uml';
import { UmlPalette, UmlProperties } from './frame-uml';
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function mount(sequence = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    registry = createCellRegistry();
  registerUmlCells(registry);
  let store = (
    sequence
      ? createUmlSequenceFrameSnapshot('f', 'r')
      : createUmlClassFrameSnapshot('f', 'r')
  ).store;
  if (!sequence)
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlClassCell('class')),
      registry,
    );
  const dispatch = vi.fn(
    (operations: Parameters<typeof applyCellOperations>[1]) => {
      store = applyCellOperations(store, operations, registry);
    },
  );
  const render = async () =>
    act(async () => {
      root.render(
        sequence ? (
          <UmlPalette
            store={store}
            frameId="f"
            zh
            disabled={false}
            dispatch={dispatch}
          />
        ) : (
          <UmlProperties
            store={store}
            frameId="f"
            cell={store.cells.class}
            zh
            disabled={false}
            dispatch={dispatch}
          />
        ),
      );
    });
  await render();
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return {
    container,
    dispatch,
    render,
    get store() {
      return store;
    },
  };
}
async function type(input: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
describe('UML editor controls', () => {
  it('commits member rows on blur and cancels Escape without adding a history operation', async () => {
    const test = await mount(),
      input = test.container.querySelector('textarea')!;
    await type(input, '+id: string\n-name: string');
    expect(test.dispatch).not.toHaveBeenCalled();
    await act(async () =>
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
    );
    expect(test.dispatch).toHaveBeenCalledTimes(1);
    await test.render();
    await type(input, 'discard');
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    await act(async () =>
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
    );
    expect(test.dispatch).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('+id: string\n-name: string');
  });
  it('creates native participants and messages with an authoritative event sequence', async () => {
    const test = await mount(true);
    const click = async (name: string) => {
      const button = [...test.container.querySelectorAll('button')].find(
        (b) => b.textContent === name,
      )!;
      await act(async () => button.click());
      await test.render();
    };
    await click('参与者');
    await click('Actor');
    await click('消息');
    await click('loop');
    expect(
      Object.values(test.store.cells).filter(
        (c) => c.kind === 'uml-participant',
      ),
    ).toHaveLength(2);
    expect(
      Object.values(test.store.cells).filter((c) => c.kind === 'uml-message'),
    ).toHaveLength(1);
    expect(test.dispatch).toHaveBeenCalledTimes(4);
  });
});
