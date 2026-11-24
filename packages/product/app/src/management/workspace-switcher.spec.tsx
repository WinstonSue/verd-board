import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from './workspace-switcher';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

it('opens the workspace dropdown and restores focus on Escape', async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const trigger = createRef<HTMLButtonElement>();
  const onHistory = vi.fn().mockResolvedValue({
    status: 'failed',
    code: 'save-failed',
    message: 'Could not save',
  });
  await act(async () =>
    root.render(
      <WorkspaceSwitcher
        locale="en"
        name="B workspace"
        currentHistoryId="current"
        triggerRef={trigger}
        switching={false}
        history={[
          { id: 'current', name: 'B workspace', lastOpenedAt: 50 },
          { id: 'pinned', name: 'Z workspace', lastOpenedAt: 1, pinned: true },
          {
            id: 'patterns',
            name: 'Writing suggestions',
            lastOpenedAt: 60,
            kind: 'agent-patterns',
          },
          { id: 'same-name', name: 'Writing suggestions', lastOpenedAt: 1 },
          { id: 'other', name: 'A workspace', lastOpenedAt: 10 },
        ]}
        onHistory={onHistory}
        onSettings={vi.fn()}
        onCreate={vi.fn()}
        onOpenFolder={vi.fn()}
        onUpdateHistory={vi.fn()}
        onRefreshHistory={vi.fn()}
      />,
    ),
  );
  const panel = container.querySelector<HTMLElement>(
    '.workspace-switcher-panel',
  )!;
  expect(panel.hidden).toBe(true);
  expect(trigger.current?.querySelector('svg')).toBeNull();
  const press = (target: Element, key: string) =>
    act(async () =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true }),
      ),
    );
  await press(trigger.current!, 'ArrowDown');
  expect(panel.hidden).toBe(false);
  const rows = [
    ...panel.querySelectorAll<HTMLButtonElement>('.workspace-switcher-name'),
  ];
  expect(rows.map(({ dataset }) => dataset.testid)).toEqual([
    'workspace-history-pinned',
    'workspace-history-other',
    'workspace-history-current',
    'workspace-history-same-name',
  ]);
  expect(rows[2].closest('[aria-current=true]')).toBeTruthy();
  expect(rows[2].disabled).toBe(true);
  expect(document.activeElement).toBe(rows[0]);
  await press(rows[0], 'ArrowDown');
  expect(document.activeElement).toBe(rows[1]);
  await act(async () => rows[1].click());
  expect(onHistory).toHaveBeenCalledWith('other');
  expect(panel.hidden).toBe(false);
  expect(panel.querySelector('[role=alert]')?.textContent).toBe(
    'Could not save',
  );
  await press(rows[1], 'Escape');
  expect(panel.hidden).toBe(true);
  expect(document.activeElement).toBe(trigger.current);

  await act(async () => trigger.current!.click());
  await act(async () =>
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })),
  );
  expect(panel.hidden).toBe(true);

  const outside = document.createElement('button');
  container.append(outside);
  await press(trigger.current!, 'ArrowDown');
  expect(panel.hidden).toBe(false);
  await act(async () => outside.focus());
  expect(panel.hidden).toBe(true);
  expect(document.activeElement).toBe(outside);
});
