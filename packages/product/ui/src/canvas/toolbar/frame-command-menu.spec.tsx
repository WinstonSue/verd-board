import { Copy } from 'lucide-react';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import {
  FrameCommandMenu,
  type FrameCommandMenuItem,
} from './frame-command-menu';

// Positioning and clipping are checked in the browser and Desktop regressions.
vi.mock('@floating-ui/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@floating-ui/react')>()),
  autoUpdate: () => () => {},
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const key = async (value: string) =>
  act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

async function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const run = vi.fn();
  const close = vi.fn();
  const entries: FrameCommandMenuItem[] = [
    { id: 'copy', label: 'Copy', icon: Copy, group: 'edit', onSelect: run },
    {
      id: 'cut',
      label: 'Cut',
      icon: Copy,
      group: 'edit',
      disabled: true,
      onSelect: run,
    },
    {
      id: 'align',
      label: 'Align',
      icon: Copy,
      group: 'arrange',
      children: [
        {
          id: 'left',
          label: 'Left',
          icon: Copy,
          group: 'align',
          onSelect: run,
        },
        {
          id: 'right',
          label: 'Right',
          icon: Copy,
          group: 'align',
          onSelect: run,
        },
      ],
    },
  ];
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button data-trigger onClick={() => setOpen(true)}>
          Canvas
        </button>
        <input data-outside />
        {open && (
          <FrameCommandMenu
            point={[20, 30]}
            label="Edit canvas"
            items={entries}
            onClose={() => {
              close();
              setOpen(false);
            }}
          />
        )}
      </>
    );
  }
  await act(async () => root.render(<Harness />));
  const trigger = container.querySelector<HTMLButtonElement>('[data-trigger]')!;
  trigger.focus();
  await act(async () => trigger.click());
  const item = (id: string) =>
    document.querySelector<HTMLButtonElement>(`[data-item-id="${id}"]`)!;
  return { container, trigger, run, close, item };
}

it('navigates enabled commands and nested menus, restores focus and executes once', async () => {
  const test = await mount();
  expect(document.activeElement).toBe(test.item('copy'));
  await key('ArrowDown');
  expect(document.activeElement).toBe(test.item('align'));
  await key('ArrowRight');
  expect(document.activeElement).toBe(test.item('left'));
  await key('End');
  expect(document.activeElement).toBe(test.item('right'));
  await key('ArrowDown');
  expect(document.activeElement).toBe(test.item('left'));
  await key('ArrowLeft');
  expect(document.activeElement).toBe(test.item('align'));
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  await key(' ');
  expect(document.activeElement).toBe(test.item('left'));
  await key('Escape');
  expect(document.activeElement).toBe(test.item('align'));
  expect(test.close).not.toHaveBeenCalled();
  await key('ArrowRight');
  await key('Enter');
  expect(test.run).toHaveBeenCalledTimes(1);
  expect(test.close).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(test.trigger);
});

it('opens a submenu on hover without stealing focus and preserves outside focus on dismissal', async () => {
  const test = await mount();
  await act(async () =>
    test
      .item('align')
      .dispatchEvent(new MouseEvent('pointerover', { bubbles: true })),
  );
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2);
  expect(document.activeElement).toBe(test.item('copy'));
  const outside =
    test.container.querySelector<HTMLInputElement>('[data-outside]')!;
  await act(async () => {
    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    outside.focus();
  });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(outside);
  expect(test.run).not.toHaveBeenCalled();
});

it('closes on Tab and returns to the original surface on Escape', async () => {
  const test = await mount();
  await key('Tab');
  expect(test.close).toHaveBeenCalledTimes(1);
  test.trigger.focus();
  await act(async () => test.trigger.click());
  await key('Escape');
  expect(test.close).toHaveBeenCalledTimes(2);
  expect(document.activeElement).toBe(test.trigger);
});
