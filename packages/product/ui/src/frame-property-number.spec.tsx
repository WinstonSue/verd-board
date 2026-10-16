import React, { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FramePropertyNumber } from './frame-property-number';
import { FramePropertyPanel, FramePropertyGroup } from './frame-property-panel';
import { I18nProvider } from './i18n';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function mount(
  initial: Partial<ComponentProps<typeof FramePropertyNumber>> = {},
) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onCommit = vi.fn();
  let props = { value: 10, onCommit, 'aria-label': 'Number', ...initial };
  const render = async (
    patch: Partial<ComponentProps<typeof FramePropertyNumber>> = {},
  ) => {
    props = { ...props, ...patch };
    await act(async () =>
      root.render(
        <I18nProvider defaultLanguage="en" persistLanguage={false}>
          <FramePropertyNumber {...props} />
        </I18nProvider>,
      ),
    );
  };
  await render();
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const input = () => container.querySelector('input')!;
  return { container, input, onCommit, render };
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}
async function blur(input: HTMLInputElement) {
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

describe('property number drafts', () => {
  it('commits only on Enter or blur, does not duplicate Enter on blur and ignores unchanged values', async () => {
    const test = await mount();
    await type(test.input(), '24');
    expect(test.onCommit).not.toHaveBeenCalled();
    await key(test.input(), 'Enter');
    await blur(test.input());
    expect(test.onCommit.mock.calls).toEqual([[24]]);
    await test.render({ value: 24 });
    await type(test.input(), '24.0');
    await blur(test.input());
    expect(test.onCommit).toHaveBeenCalledTimes(1);
    await type(test.input(), '25');
    await blur(test.input());
    expect(test.onCommit.mock.calls).toEqual([[24], [25]]);
  });
  it.each(['', '-1', '21', '1e309'])(
    'keeps invalid draft %s on Enter and restores it on blur',
    async (draft) => {
      const test = await mount({ min: 0, max: 20 });
      await type(test.input(), draft);
      await key(test.input(), 'Enter');
      expect(test.input().getAttribute('aria-invalid')).toBe('true');
      expect(test.container.querySelector('[role="alert"]')).not.toBeNull();
      expect(test.onCommit).not.toHaveBeenCalled();
      await blur(test.input());
      expect(test.input().value).toBe('10');
      expect(test.input().getAttribute('aria-invalid')).toBeNull();
    },
  );
  it('accepts negative positions and decimal widths, and normalizes integer pixel fields', async () => {
    const test = await mount({ step: 0.5 });
    await type(test.input(), '-12.25');
    await key(test.input(), 'Enter');
    expect(test.onCommit).toHaveBeenLastCalledWith(-12.25);
    await test.render({ precision: 0 });
    await type(test.input(), '-12.5');
    await key(test.input(), 'Enter');
    expect(test.onCommit).toHaveBeenLastCalledWith(-12);
  });
  it('validates integer-only Mind widths without changing other precision rules', async () => {
    const test = await mount({ validate: Number.isInteger });
    await type(test.input(), '16.5');
    await key(test.input(), 'Enter');
    expect(test.onCommit).not.toHaveBeenCalled();
    expect(test.input().getAttribute('aria-invalid')).toBe('true');
  });
  it('Esc restores the latest value and cancels an error without committing', async () => {
    const test = await mount();
    await type(test.input(), '');
    await key(test.input(), 'Enter');
    await test.render({ value: 17 });
    expect(test.input().value).toBe('');
    await key(test.input(), 'Escape');
    await blur(test.input());
    expect(test.input().value).toBe('17');
    expect(test.onCommit).not.toHaveBeenCalled();
  });
  it('leaves mixed values untouched until a number is entered', async () => {
    const test = await mount({ value: undefined, mixed: true });
    expect(test.input().value).toBe('');
    expect(test.input().placeholder).toBe('Mixed values');
    await blur(test.input());
    await key(test.input(), 'Enter');
    expect(test.onCommit).not.toHaveBeenCalled();
    await type(test.input(), '0');
    await key(test.input(), 'Enter');
    expect(test.onCommit).toHaveBeenCalledWith(0);
  });
  it('cancels drafts on selection and permission changes, including late blur from the removed input', async () => {
    const test = await mount({ identity: 'a' });
    await type(test.input(), '21');
    const previous = test.input();
    await test.render({ identity: 'b', value: 12 });
    await blur(previous);
    expect(test.input().value).toBe('12');
    await type(test.input(), '30');
    await test.render({ disabled: true });
    await key(test.input(), 'Enter');
    await test.render({ disabled: false });
    expect(test.input().value).toBe('12');
    expect(test.onCommit).not.toHaveBeenCalled();
  });
});

it('keeps group collapse in the canvas session and exposes button state', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(async () => root.unmount());
  });
  const render = (identity: string, session = 'canvas', reveal = 0) =>
    act(async () =>
      root.render(
        <FramePropertyPanel
          key={session}
          title="Properties"
          open
          identity={identity}
          disabled={false}
        >
          <FramePropertyGroup id="geometry" title="Geometry">
            <span>Fields</span>
          </FramePropertyGroup>
          <FramePropertyGroup
            id="arrange"
            title="Arrange"
            defaultCollapsed
            reveal={reveal}
          >
            <span>Commands</span>
          </FramePropertyGroup>
        </FramePropertyPanel>,
      ),
    );
  await render('a');
  const buttons = () => container.querySelectorAll('button');
  expect(buttons()[0].getAttribute('aria-expanded')).toBe('true');
  expect(buttons()[1].getAttribute('aria-expanded')).toBe('false');
  await act(async () => {
    buttons()[1].click();
  });
  await render('b');
  expect(buttons()[1].getAttribute('aria-expanded')).toBe('true');
  await render('b', 'another canvas');
  expect(buttons()[1].getAttribute('aria-expanded')).toBe('false');
  await render('b', 'another canvas', 1);
  expect(buttons()[1].getAttribute('aria-expanded')).toBe('true');
});
