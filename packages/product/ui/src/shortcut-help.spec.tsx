import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShortcutHelp } from './shortcut-help';
import type { ShortcutLocale, ShortcutScene } from './shortcut-catalog';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const leakedKey = vi.fn();

function Harness({
  scene = 'mind',
  locale = 'zh',
}: {
  scene?: ShortcutScene;
  locale?: ShortcutLocale;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <div onKeyDown={leakedKey}>
      <button ref={opener} onClick={() => setOpen(true)}>
        Open help
      </button>
      {open && (
        <ShortcutHelp
          scene={scene}
          locale={locale}
          returnFocusRef={opener}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
const click = (element: Element) => act(() => (element as HTMLElement).click());
const button = (label: string) =>
  [...host.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  )!;
const search = (value: string) =>
  act(() => {
    const input = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const open = async (
  props: { scene?: ShortcutScene; locale?: ShortcutLocale } = {},
) => {
  await act(async () => root.render(<Harness {...props} />));
  click(button('Open help'));
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }),
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

describe('shortcut help', () => {
  it('opens at the current scene, searches conditions and resets on reopening', async () => {
    await open();
    expect(button('脑图').getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('添加子主题');
    expect(host.textContent).toContain('通用画布操作');
    expect(host.textContent).not.toContain('无序列表');
    search('子主题');
    expect(host.textContent).toContain('添加同级主题');
    expect(host.textContent).not.toContain('导出画布文件');
    search('不存在的操作');
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      '没有找到匹配的快捷键',
    );
    click(host.querySelector('[aria-label="关闭快捷键帮助"]')!);
    expect(document.activeElement).toBe(button('Open help'));
    click(button('Open help'));
    expect(host.querySelector('input')!.value).toBe('');
    expect(button('脑图').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps duplicate chords in different scenes and formats platform keys', async () => {
    await open();
    click(button('全部'));
    search('Cmd+U');
    expect(host.textContent).toContain('导入图片');
    expect(host.textContent).toContain('下划线');
    expect(host.querySelectorAll('.shortcut-help__row')).toHaveLength(2);
  });

  it('shows English document bindings on Windows without canvas commands', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    await open({ scene: 'document', locale: 'en' });
    search('Ctrl+Alt+1');
    expect(host.textContent).toContain('Heading 1');
    expect(host.textContent).not.toContain('Option');
    expect(host.textContent).not.toContain('Common canvas actions');
    search('');
    click(button('Workflow'));
    expect(host.textContent).toContain('no dedicated shortcuts');
    expect(host.textContent).toContain('Common canvas actions');
  });

  it('contains keyboard events, wraps focus and closes through native cancel', async () => {
    await open();
    const dialog = host.querySelector('dialog')!;
    expect(document.activeElement).toBe(host.querySelector('input'));
    act(() =>
      host
        .querySelector('input')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
        ),
    );
    expect(leakedKey).not.toHaveBeenCalled();
    const first = dialog.querySelector('button')!;
    const last = [...dialog.querySelectorAll('button')].at(-1)!;
    first.focus();
    act(() =>
      first.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(last);
    act(() =>
      last.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(first);
    act(() => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(host.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(button('Open help'));
    click(button('Open help'));
    act(() =>
      host.querySelector('input')!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(host.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(button('Open help'));
  });
});
