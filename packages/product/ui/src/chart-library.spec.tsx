import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ChartLibrary, OrganizePreview } from './chart-library';

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

describe('OrganizePreview', () => {
  it('localizes recommendation reasons and cancel writes nothing', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <OrganizePreview
          locale="zh"
          owners={[{ frameId: 'A', name: '产品规划' }]}
          rows={[
            {
              fileId: 'C',
              name: '需求脑图',
              path: 'c.verd.json',
              diagram: 'mind',
              sources: '产品规划',
              recommendedOwnerName: '产品规划',
              reason: 'sole-source',
              choice: 'owner',
              ownerFrameId: 'A',
              basisSources: ['A'],
            },
          ]}
          onCancel={onCancel}
          onConfirm={onConfirm}
          onChange={onChange}
        />,
      ),
    );
    expect(container.textContent).toContain('只被这张画布引用');
    expect(container.textContent).not.toContain('sole-source');
    expect(container.querySelector('dialog')?.open).toBe(true);
    const cancel = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('取消'),
    )!;
    await act(async () => {
      cancel.click();
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    container.remove();
  });
});

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
  expect(
    container.querySelector('.chart-library-unorganized')?.textContent,
  ).toBe('Unorganized');
  await act(async () =>
    container.querySelector<HTMLButtonElement>('td button')!.click(),
  );
  expect(onPick).toHaveBeenCalledWith('c');
  await act(async () => root.unmount());
  container.remove();
});
