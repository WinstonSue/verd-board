import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfigPanel, defineSettings } from '@sue/schema-settings-react';
import { settingsDesignComponents } from './settings-design-editors';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const setup = async (disabled = false, mixed = false) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const commit = vi.fn();
  const definition = defineSettings<{
    choice: string | number;
    enabled: boolean;
    scale: number;
    number: number;
  }>({
    fields: [
      {
        key: 'choice',
        editor: 'select',
        label: 'Choice',
        options: [
          { value: 1, label: 'Number one' },
          { value: '1', label: 'String one' },
          { value: 'blocked', label: 'Blocked', disabled: true },
        ],
      },
      { key: 'enabled', editor: 'checkbox', label: 'Enabled' },
      {
        key: 'scale',
        editor: 'range',
        label: 'Scale',
        props: {
          min: 0.25,
          max: 3,
          step: 0.05,
          attributes: { 'data-testid': 'scale', 'aria-valuetext': '1×' },
        },
      },
      {
        key: 'number',
        editor: 'number',
        label: 'Number',
        props: { min: 2, max: 6, step: 0.5 },
      },
    ],
  });
  await act(async () =>
    root.render(
      <ConfigPanel
        definition={definition}
        values={{ choice: 1, enabled: true, scale: 1, number: 4 }}
        identity="editors"
        disabled={disabled}
        fieldStates={{ choice: { mixed }, enabled: { mixed } }}
        components={settingsDesignComponents}
        onCommit={commit}
      />,
    ),
  );
  return commit;
};
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

it('preserves numeric and string option values and disabled options', async () => {
  const commit = await setup();
  const input = container.querySelector<HTMLElement>('[role="combobox"]')!;
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        keyCode: 40,
        bubbles: true,
      }),
    ),
  );
  const options = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ];
  expect(
    options
      .find((option) => option.textContent === 'Blocked')
      ?.getAttribute('aria-disabled'),
  ).toBe('true');
  await act(async () =>
    options.find((option) => option.textContent === 'String one')!.click(),
  );
  expect(commit).toHaveBeenCalledWith(
    expect.objectContaining({
      changes: [{ key: 'choice', kind: 'set', value: '1' }],
    }),
  );
});

it('exposes mixed states and explicitly disables composite controls', async () => {
  const commit = await setup(true, true);
  expect(container.textContent).toContain('Mixed values');
  expect(
    container.querySelector<HTMLInputElement>('[role="combobox"]')!.disabled,
  ).toBe(true);
  const checkbox = container.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  expect(checkbox.disabled).toBe(true);
  expect(checkbox.indeterminate).toBe(true);
  expect(
    container.querySelector('[role="slider"]')?.getAttribute('aria-valuemin'),
  ).toBe('0.25');
  expect(
    container.querySelector('[role="slider"]')?.getAttribute('aria-valuemax'),
  ).toBe('3');
  expect(
    container.querySelector('[role="slider"]')?.getAttribute('aria-valuetext'),
  ).toBe('1×');
  await act(async () => checkbox.click());
  expect(commit).not.toHaveBeenCalled();
});

it('keeps out-of-range numeric text until explicit validation and accepts a corrected value', async () => {
  const commit = await setup();
  const input = container.querySelector<HTMLInputElement>(
    '[role="spinbutton"]',
  )!;
  const type = async (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await type('7.5');
  expect(input.value).toBe('7.5');
  expect(commit).not.toHaveBeenCalled();
  expect(input.getAttribute('aria-invalid')).toBe('true');
  await type('5.5');
  expect(commit).toHaveBeenCalledWith(
    expect.objectContaining({
      changes: [{ key: 'number', kind: 'set', value: 5.5 }],
    }),
  );
});
