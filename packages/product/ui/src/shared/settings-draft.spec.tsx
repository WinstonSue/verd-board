import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsDraftInput, SettingsDraftProvider } from './settings-draft';
import { validMindMaxWidth } from '@sue/board-mind';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let drafts: Map<string, () => Promise<boolean>>;
const setup = async (
  props: Partial<Parameters<typeof SettingsDraftInput>[0]> = {},
) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  drafts = new Map();
  const onSave = vi.fn();
  await act(async () =>
    root.render(
      <SettingsDraftProvider drafts={drafts}>
        <SettingsDraftInput
          value="Original"
          label="Draft"
          testId="draft"
          onSave={onSave}
          {...props}
        />
      </SettingsDraftProvider>,
    ),
  );
  return {
    input: container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    )!,
    onSave,
  };
};
const enter = async (input: HTMLElement, key = 'Enter') =>
  act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
const type = async (
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) =>
  act(async () => {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

it('keeps IME composition local and does not flush it when closing', async () => {
  const { input, onSave } = await setup({ multiline: true });
  await act(async () =>
    input.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    ),
  );
  await type(input, '项目');
  await enter(input);
  expect(await drafts.get('draft')!()).toBe(false);
  expect(onSave).not.toHaveBeenCalled();
  await act(async () =>
    input.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    ),
  );
  await act(async () => expect(await drafts.get('draft')!()).toBe(true));
  expect(onSave).toHaveBeenCalledWith('项目');
});

it('waits for an in-flight save without submitting the same draft twice', async () => {
  let finish!: () => void;
  const onSave = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { input } = await setup({ onSave });
  await type(input, 'Changed');
  await enter(input);
  let finished = false;
  const closing = drafts.get('draft')!().then((accepted) => {
    finished = true;
    return accepted;
  });
  expect(finished).toBe(false);
  await act(async () => {
    finish();
    expect(await closing).toBe(true);
  });
  expect(onSave).toHaveBeenCalledTimes(1);
});

it('retains rejected text, focuses the field and allows a later retry', async () => {
  const onSave = vi
    .fn()
    .mockResolvedValueOnce({ status: 'rejected', message: 'Disk unavailable' })
    .mockResolvedValueOnce({ status: 'accepted' });
  const { input } = await setup({ onSave, multiline: true });
  await type(input, 'Keep this draft');
  await act(async () => expect(await drafts.get('draft')!()).toBe(false));
  expect(input.value).toBe('Keep this draft');
  expect(document.activeElement).toBe(input);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Disk unavailable',
  );
  await act(async () => expect(await drafts.get('draft')!()).toBe(true));
  expect(onSave).toHaveBeenCalledTimes(2);
});

it('rejects invalid numeric drafts without clamping and recovers after synchronous validation errors', async () => {
  const saved = vi.fn();
  const { input } = await setup({
    numeric: true,
    value: 320,
    onSave: (value) => {
      if (!value || !validMindMaxWidth(Number(value)))
        throw new Error('Invalid width');
      saved(Number(value));
    },
  });
  await type(input, '1');
  await enter(input);
  expect(input.value).toBe('1');
  expect(saved).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Invalid width',
  );
  await type(input, '400');
  await act(async () => expect(await drafts.get('draft')!()).toBe(true));
  expect(saved).toHaveBeenCalledWith(400);
});
