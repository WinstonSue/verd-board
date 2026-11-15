import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { ActionResult } from '@sue/board-common';
import type { FrameCell } from '@sue/board-core';
import {
  createUmlParticipantCell,
  createUmlSequenceFrameSnapshot,
  createUmlFragmentCell,
} from '@sue/board-uml';
import { FrameUmlToolPalette } from './frame-uml-tool-palette';

// Test parameter drafts independently of layout; E2E covers the floating shell.
vi.mock('./frame-tool-popover', async () => {
  const { useState } = await import('react');
  return {
    FrameToolPopover({
      label,
      actionId,
      disabled,
      children,
    }: {
      label: string;
      actionId: string;
      disabled?: boolean;
      children(close: () => void): ReactNode;
    }) {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            data-action-id={actionId}
            disabled={disabled}
            onClick={() => setOpen(!open)}
          >
            {label}
          </button>
          {open && <div role="dialog">{children(() => setOpen(false))}</div>}
        </>
      );
    },
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const store = createUmlSequenceFrameSnapshot('frame', 'sequence').store;
  const frame = store.cells.frame as FrameCell;
  const first = createUmlParticipantCell('first');
  const last = createUmlParticipantCell('last');
  const fragment = createUmlFragmentCell('fragment', 'loop');
  Object.assign(store.cells, { first, last, fragment });
  frame.children.push(first.id, last.id, fragment.id);
  let pending = false;
  const execute = vi.fn<(id: string, args?: unknown) => Promise<ActionResult>>(
    async () => ({ status: 'completed' }),
  );
  const render = async () =>
    act(async () =>
      root.render(
        <FrameUmlToolPalette
          store={store}
          frameId="frame"
          language="en"
          labelFor={(id) => id}
          titleFor={(id) => id}
          stateFor={() => ({ visible: true, enabled: !pending })}
          executeAction={execute}
        />,
      ),
    );
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  await render();
  const open = async (id = 'uml.add-message') => {
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(`[data-action-id="${id}"]`)!
        .click(),
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  };
  const choice = (name: string) =>
    Array.from(document.querySelectorAll('[role="dialog"] label'))
      .find((label) => label.querySelector('span')?.textContent === name)!
      .querySelector('select')!;
  const choose = async (name: string, value: string) =>
    act(async () => {
      const select = choice(name);
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  const submit = async () =>
    act(async () => {
      document
        .querySelector<HTMLFormElement>('[role="dialog"] form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
  return {
    store,
    frame,
    fragment,
    execute,
    render,
    open,
    choice,
    choose,
    submit,
    async pending(value: boolean) {
      pending = value;
      await render();
    },
  };
}

it('keeps source, self-call target and branch drafts between parameter popovers without writing content', async () => {
  const view = await mount();
  await view.open();
  await view.choose('Source', 'last');
  await view.choose('Target', 'last');
  await view.choose('Insert into branch', view.fragment.data!.operands[0].id);
  expect(view.execute).not.toHaveBeenCalled();
  await view.submit();
  expect(view.execute).toHaveBeenCalledWith('uml.add-message', {
    sourceId: 'last',
    targetId: 'last',
    operandId: view.fragment.data!.operands[0].id,
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await view.open('uml.add-note');
  expect(view.choice('Source').value).toBe('last');
  expect(view.choice('Target').value).toBe('last');
  await view.submit();
  expect(view.execute).toHaveBeenLastCalledWith('uml.add-note', {
    participantIds: ['last'],
    operandId: view.fragment.data!.operands[0].id,
  });
});

it('refreshes removed endpoints and branches before creating an event', async () => {
  const view = await mount();
  await view.open();
  await view.choose('Source', 'first');
  await view.choose('Target', 'first');
  await view.choose('Insert into branch', view.fragment.data!.operands[0].id);
  delete view.store.cells.first;
  delete view.store.cells.fragment;
  view.frame.children = view.frame.children.filter(
    (id) => id !== 'first' && id !== 'fragment',
  );
  await view.render();
  expect(view.choice('Source').value).toBe('last');
  expect(view.choice('Target').value).toBe('last');
  expect(view.choice('Insert into branch').value).toBe('');
  await view.submit();
  expect(view.execute).toHaveBeenCalledWith('uml.add-message', {
    sourceId: 'last',
    targetId: 'last',
    operandId: undefined,
  });
});

it('keeps a pending form mounted and preserves its draft on rejection for retry', async () => {
  const view = await mount();
  let finish!: (result: ActionResult) => void;
  view.execute.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await view.open();
  await view.choose('Source', 'last');
  await view.submit();
  await view.pending(true);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(
    document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[type="submit"]',
    )!.disabled,
  ).toBe(true);
  await act(async () => {
    finish({ status: 'rejected', code: 'conflict', message: 'Try again' });
  });
  await view.pending(false);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    'Try again',
  );
  expect(view.choice('Source').value).toBe('last');
  await view.submit();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
