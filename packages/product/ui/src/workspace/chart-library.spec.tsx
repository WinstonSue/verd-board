import { createActionRegistry } from '@sue/board-common';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ChartLibrary } from './chart-library';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('marks the active picker mode and keeps the list in its scroll container', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onPickerMode = vi.fn();
  const onPick = vi.fn();
  await act(async () =>
    root.render(
      <ChartLibrary
        locale="en"
        owners={[]}
        picker="chart"
        onPickerMode={onPickerMode}
        onPick={onPick}
        onOpen={vi.fn()}
        onBack={vi.fn()}
        rows={[
          {
            frameId: 'c',
            name: 'Plan',
            path: 'docs/c.verd.json',
            diagram: 'mind',
            placement: 'unorganized',
            referenceLabel: '0 references',
            conflicted: true,
          },
        ]}
      />,
    ),
  );
  const modes = container.querySelectorAll<HTMLButtonElement>(
    '[role="group"] button',
  );
  expect(modes[0].getAttribute('aria-pressed')).toBe('true');
  expect(modes[1].getAttribute('aria-pressed')).toBe('false');
  await act(async () => modes[1].click());
  expect(onPickerMode).toHaveBeenCalledWith('preview');
  expect(container.querySelector('.chart-library-scroll table')).toBeTruthy();
  expect(container.querySelector('tr[data-conflict="true"]')).toBeTruthy();
  expect(container.querySelector('[aria-label="Ownership"]')).toBeNull();
  expect(container.textContent).not.toContain('Unorganized');
  await act(async () =>
    container.querySelector<HTMLButtonElement>('td button')!.click(),
  );
  expect(onPick).toHaveBeenCalledWith('c');
  await act(async () => root.unmount());
  container.remove();
});

it('uses captured workspace actions for names, availability and execution instead of legacy callbacks', async () => {
  let paused = false,
    exists = true;
  const execute = vi.fn(),
    legacyOpen = vi.fn();
  const actions = createActionRegistry({
    getContext: () => ({ paused, exists }),
    refresh: () => ({ paused, exists }),
  });
  actions.register({
    id: 'workspace.file.open',
    label: { zh: '动作打开', en: 'Action open' },
    category: 'workspace',
    effect: 'view',
    validateArgs: (args: unknown): args is { fileId: string } =>
      !!args &&
      typeof args === 'object' &&
      (args as { fileId?: unknown }).fileId === 'chart',
    getState: (c) => ({
      enabled: !c.paused && c.exists,
      reason: !c.exists ? 'missing-target' : c.paused ? 'pending' : undefined,
    }),
    execute: (_c, args) => {
      execute(args.fileId);
      return { status: 'completed' };
    },
  });
  actions.seal();
  const container = document.createElement('div'),
    root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ChartLibrary
          actionSource={actions}
          locale="en"
          rows={[
            {
              frameId: 'chart',
              name: 'Plan',
              path: 'plan.verd.json',
              diagram: 'mind',
              placement: 'standalone',
              referenceLabel: '0 references',
            },
          ]}
          owners={[]}
          onOpen={legacyOpen}
          onBack={() => {}}
        />,
      ),
    );
    const button = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Action open',
    )!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(execute).toHaveBeenCalledWith('chart');
    expect(legacyOpen).not.toHaveBeenCalled();
    await act(async () => {
      paused = true;
      actions.invalidate();
    });
    expect(button.disabled).toBe(true);
    await act(async () => {
      paused = false;
      exists = false;
      actions.invalidate();
    });
    expect(button.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    actions.dispose();
  }
});
