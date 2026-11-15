import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Settings, X } from 'lucide-react';
import { VmDialog } from './vm-dialog';
import { IconButton } from './icon-button';
import { FileTreeMenu } from '../../workspace/file-tree-menu';
import { FrameTooltip } from '../../canvas/toolbar/frame-tooltip';
vi.mock('@floating-ui/react', async (original) => ({
  ...(await original<typeof import('@floating-ui/react')>()),
  autoUpdate: () => () => {},
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
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
async function render(children: React.ReactNode) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(children));
}
it('opens a native modal, handles Escape and returns focus on unmount', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const close = vi.fn();
  await render(
    <VmDialog title="Settings" onClose={close}>
      <input aria-label="Name" />
    </VmDialog>,
  );
  const dialog = container.querySelector('dialog')!;
  expect(dialog.open).toBe(true);
  await act(async () =>
    dialog.dispatchEvent(new Event('cancel', { cancelable: true })),
  );
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(document.activeElement).toBe(opener);
  opener.remove();
});
it('keeps nested menus and focus tooltips inside the native modal', async () => {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  await render(
    <VmDialog title="Modal" onClose={() => {}}>
      <FileTreeMenu
        label="Actions"
        anchor={anchor}
        items={[
          { id: 'settings', label: 'Settings', icon: Settings, onSelect() {} },
        ]}
        onClose={() => {}}
      />
      <FrameTooltip content="Help" delay={0}>
        <button>Help</button>
      </FrameTooltip>
    </VmDialog>,
  );
  expect(container.querySelector('dialog [role="menu"]')).toBeTruthy();
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Help')!
      .focus(),
  );
  expect(container.querySelector('dialog [role="tooltip"]')?.textContent).toBe(
    'Help',
  );
  anchor.remove();
});
it('renders an accessible icon button and preserves disabled semantics', async () => {
  const click = vi.fn();
  await render(
    <IconButton icon={X} aria-label="Remove" disabled onClick={click} />,
  );
  const button = container.querySelector('button')!;
  expect(button.getAttribute('aria-label')).toBe('Remove');
  expect(button.querySelector('svg')).toBeTruthy();
  button.click();
  expect(click).not.toHaveBeenCalled();
});
