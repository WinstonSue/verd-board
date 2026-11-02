import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceSwitcherDialog } from './workspace-switcher-dialog';
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function () {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function () {
  this.open = false;
};
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});
it.each([false, true])(
  'pins the current workspace first even when absent from history (%s)',
  async (inHistory) => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <WorkspaceSwitcherDialog
          locale="en"
          name="Current workspace"
          currentHistoryId="current"
          history={[
            {
              id: 'other',
              name: 'A very long workspace name '.repeat(8),
              lastOpenedAt: 20,
            },
            ...(inHistory
              ? [{ id: 'current', name: 'Current workspace', lastOpenedAt: 1 }]
              : []),
          ]}
          onHistory={vi.fn()}
          onSettings={vi.fn()}
          onCreate={vi.fn()}
          onOpenFolder={vi.fn()}
          onOpenBuiltin={vi.fn()}
          onOpenPatterns={vi.fn()}
          onUpdateHistory={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    const first = container.querySelector('.workspace-switcher-row')!;
    expect(first.getAttribute('aria-current')).toBe('true');
    expect(first.textContent).toContain('Current');
    expect(
      first.querySelector<HTMLButtonElement>('.workspace-switcher-name')
        ?.disabled,
    ).toBe(true);
    if (inHistory)
      expect(
        first.querySelector<HTMLButtonElement>('[aria-label="Remove record"]')
          ?.disabled,
      ).toBe(true);
    expect(
      [...container.querySelectorAll('.workspace-switcher-operation')].every(
        (item) => item.querySelector('svg'),
      ),
    ).toBe(true);
    expect(container.querySelectorAll('.workspace-switcher-row')).toHaveLength(
      2,
    );
  },
);
