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

it('edits existing ownership, cancels without writing, and hides writes in readonly and picker modes', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onChangeOrganization = vi.fn(async () => {});
  const props = {
    rows: [
      {
        frameId: 'c',
        name: 'Plan',
        path: 'docs/c.verd.json',
        diagram: 'mind' as const,
        placement: 'owned' as const,
        ownerFrameId: 'a',
        ownerName: 'Alpha',
        referenceLabel: '',
      },
    ],
    owners: [
      { frameId: 'a', name: 'Alpha' },
      { frameId: 'b', name: 'Beta' },
    ],
    onOpen: vi.fn(),
    onBack: vi.fn(),
    onChangeOrganization,
  };
  const render = async (patch = {}) =>
    act(async () => root.render(<ChartLibrary {...props} {...patch} />));
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) => element.textContent === name,
    )!;
  const click = async (name: string) => act(async () => button(name).click());
  const choose = async (value: string) =>
    act(async () => {
      const select =
        container.querySelector<HTMLSelectElement>('dialog select')!;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  await render();
  await click('调整归属…');
  expect(
    container.querySelector<HTMLSelectElement>('dialog select')!.value,
  ).toBe('owner:a');
  await choose('owner:b');
  await click('取消');
  expect(onChangeOrganization).not.toHaveBeenCalled();
  for (const [value, organization] of [
    ['owner:b', { kind: 'subgraph', ownerFrameId: 'b' }],
    ['standalone', { kind: 'standalone' }],
    ['unorganized', { kind: 'subgraph' }],
  ] as const) {
    await click('调整归属…');
    await choose(value);
    await click('确定');
    expect(onChangeOrganization).toHaveBeenLastCalledWith('c', organization);
    expect(container.querySelector('dialog')).toBeNull();
  }
  await render({ readonly: true });
  expect(button('调整归属…')).toBeUndefined();
  await render({ picker: 'chart' });
  expect(button('调整归属…')).toBeUndefined();
  await render({ rows: [{ ...props.rows[0], diagram: 'canvas' }] });
  expect(button('调整归属…')).toBeUndefined();
  await act(async () => root.unmount());
  container.remove();
});

it('keeps failed ownership changes available for retry and blocks duplicate submissions', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let reject!: (error: Error) => void;
  const onChangeOrganization = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  await act(async () =>
    root.render(
      <ChartLibrary
        rows={[
          {
            frameId: 'c',
            name: 'Plan',
            path: 'c.verd.json',
            diagram: 'mind',
            placement: 'standalone',
            referenceLabel: '',
          },
        ]}
        owners={[]}
        onOpen={vi.fn()}
        onBack={vi.fn()}
        onChangeOrganization={onChangeOrganization}
      />,
    ),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="调整归属 Plan"]')!
      .click(),
  );
  const dialog = container.querySelector('dialog')!;
  await act(async () => {
    const select = dialog.querySelector('select')!;
    select.value = 'unorganized';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const submit = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
  await act(async () => submit.click());
  expect(submit.disabled).toBe(true);
  expect(
    dialog.querySelector<HTMLButtonElement>('[type="button"]')!.disabled,
  ).toBe(true);
  await act(async () =>
    dialog
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await act(async () =>
    dialog.dispatchEvent(
      new Event('cancel', { bubbles: true, cancelable: true }),
    ),
  );
  expect(onChangeOrganization).toHaveBeenCalledOnce();
  expect(container.querySelector('dialog')).toBe(dialog);
  await act(async () => reject(new Error('Save failed')));
  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(
    'Save failed',
  );
  expect(submit.disabled).toBe(false);
  await act(async () => root.unmount());
  container.remove();
});
