import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { FindBar, type FindBarProps } from './find-bar';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const setup = async (overrides: Partial<FindBarProps> = {}) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const inputRef = { current: null as HTMLInputElement | null };
  const props: FindBarProps = {
    locale: 'zh',
    label: '查找画布',
    placement: 'floating',
    query: 'cat',
    matchCase: false,
    index: 0,
    count: 3,
    unit: 'cells',
    inputRef,
    onQuery: vi.fn(),
    onMatchCase: vi.fn(),
    onStep: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  await act(async () => root.render(<FindBar {...props} />));
  return { props, input: inputRef.current! };
};
const key = async (
  element: HTMLElement,
  key: string,
  options: KeyboardEventInit = {},
) =>
  act(async () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
const fill = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

it('shares result navigation, case toggle and close without leaking editor shortcuts', async () => {
  const { props, input } = await setup();
  expect(document.activeElement).toBe(input);
  expect(
    container.querySelector('[role="status"]')?.getAttribute('aria-label'),
  ).toContain('匹配图元');
  await key(input, 'Enter');
  await key(input, 'Enter', { shiftKey: true });
  expect(props.onStep).toHaveBeenNthCalledWith(1, 1);
  expect(props.onStep).toHaveBeenNthCalledWith(2, -1);
  const toggle = container.querySelector<HTMLButtonElement>(
    '[aria-label="区分大小写"]',
  )!;
  await act(async () => toggle.click());
  expect(props.onMatchCase).toHaveBeenCalledWith(true);
  const escaped = vi.fn();
  document.body.addEventListener('keydown', escaped);
  await key(toggle, 'h');
  document.body.removeEventListener('keydown', escaped);
  expect(escaped).not.toHaveBeenCalled();
  await key(toggle, 'f', { ctrlKey: true });
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(3);
  await key(toggle, 'Escape');
  expect(props.onClose).toHaveBeenCalledOnce();
});

it('keeps IME text local until composition ends and ignores IME Enter/Escape', async () => {
  const { props, input } = await setup();
  await act(async () =>
    input.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    ),
  );
  await fill(input, '中文');
  await key(input, 'Enter');
  await key(input, 'Escape');
  expect(input.value).toBe('中文');
  expect(props.onQuery).not.toHaveBeenCalled();
  expect(props.onStep).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  await act(async () =>
    input.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    ),
  );
  expect(props.onQuery).toHaveBeenLastCalledWith('中文');
});

it('disables result navigation when empty and reports text occurrence units', async () => {
  const { props, input } = await setup({ count: 0, index: -1, unit: 'text' });
  expect(container.querySelector('[role="status"]')?.textContent).toBe('0/0');
  expect(
    container.querySelector('[role="status"]')?.getAttribute('aria-label'),
  ).toContain('文字匹配');
  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="下一个"]')!
      .disabled,
  ).toBe(true);
  await key(input, 'Enter');
  expect(props.onStep).not.toHaveBeenCalled();
});
