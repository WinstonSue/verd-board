import { act, StrictMode, useContext, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlockText } from '@sue/board-common';
import { createActionRegistry } from '@sue/board-common';
import type {
  DocumentEditorController,
  DocumentEditorProps,
} from '@sue/board-react-text';
import { DocumentPage, type DocumentPageProps } from './document-page';
import { I18nProvider } from '../i18n';

// jsdom has no geometry; browser tests cover floating placement.
vi.mock('@floating-ui/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@floating-ui/react')>()),
  autoUpdate: () => () => {},
}));

const { controller } = vi.hoisted(() => ({
  controller: {
    focus: vi.fn(),
    actions: vi.fn(() => []),
    getActionState: vi.fn(() => ({ visible: true, enabled: true })),
    executeAction: vi.fn(async () => ({ status: 'completed' })),
    flushEditing: vi.fn(async () => ({ status: 'completed' })),
    revision: 0,
    locateHeading: vi.fn(),
    locateFrameReference: vi.fn(() => true),
    getToolbarState: vi.fn(() => ({
      marks: {},
      block: 'paragraph',
      align: 'left',
      inTable: false,
      editable: true,
      link: 'verd://file/guide#章节',
    })),
    getHeadings: vi.fn(() => [
      { level: 2, text: '章节', anchor: '章节', pos: 10 },
      { level: 2, text: '章节', anchor: '章节-1', pos: 20 },
    ]),
    getCharacterCount: vi.fn(() => 4),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock('@sue/board-react-text', async (original) => {
  const real = await original<typeof import('@sue/board-react-text')>();
  return {
    ...real,
    DocumentEditor: ({ onReady }: DocumentEditorProps) => {
      const editLink = useContext(real.LinkEditorHost);
      useEffect(() => {
        onReady?.(controller as unknown as DocumentEditorController);
        return () => onReady?.(null);
      }, [onReady]);
      return (
        <div className="board-document-editor">
          <a href="verd://file/guide#章节">
            <span>Open guide</span>
          </a>
          <a href="https://example.com/">Website</a>
          <button
            type="button"
            title="链接"
            onClick={() =>
              editLink?.({
                href: 'verd://file/guide#章节',
                isCurrent: () => true,
                commit: async () => ({ status: 'completed' }),
              })
            }
          >
            编辑链接
          </button>
        </div>
      );
    },
  };
});

HTMLDialogElement.prototype.showModal ??= function () {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function () {
  this.open = false;
};

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let sequence = 0;
const value = createBlockText('Body');

const render = async (props: Partial<DocumentPageProps> = {}) => {
  await act(async () =>
    root.render(
      <I18nProvider language={props.locale ?? 'zh'} persistLanguage={false}>
        <DocumentPage
          value={value}
          title="Guide"
          onChange={() => {}}
          {...props}
        />
      </I18nProvider>,
    ),
  );
};
const flushFrames = async () => {
  await act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((frame) => frame(0));
  });
};
const click = async (target: Element, options: MouseEventInit = {}) => {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...options,
  });
  await act(async () => target.dispatchEvent(event));
  return event;
};

beforeEach(() => {
  vi.clearAllMocks();
  frames = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('document navigation', () => {
  it('shows presentation and save feedback in the header and keeps history in the menu', async () => {
    const history = createActionRegistry({ getContext: () => ({}) });
    const undo = vi.fn(() => ({ status: 'completed' as const }));
    history.register({
      id: 'document.undo',
      label: '撤销',
      category: 'document',
      effect: 'history',
      shortcuts: [{ key: 'z', mod: true }],
      execute: undo,
    });
    history.register({
      id: 'document.redo',
      label: '重做',
      category: 'document',
      effect: 'history',
      getState: () => ({ enabled: false }),
      execute: undo,
    });
    controller.actions.mockReturnValue(history.actions() as never[]);
    let gesture = false;
    const onPresent = vi.fn(async () => {
      expect(gesture).toBe(true);
      return { status: 'completed' as const };
    });
    try {
      await render({ onPresent });
      expect(
        [...container.querySelectorAll('.doc-toolbar__actions button')].map(
          (button) => button.getAttribute('aria-label'),
        ),
      ).toEqual(['查找', '演示', '文档']);
      expect(
        container.querySelector(
          '.document-page__header [data-testid="save-status"]',
        )?.textContent,
      ).toBe('已保存');
      expect(
        container.querySelector(
          '.document-page__status [data-testid="save-status"]',
        ),
      ).toBeNull();
      expect(
        container.querySelector(
          '.doc-toolbar [data-action-id="document.undo"]',
        ),
      ).toBeNull();
      await act(async () => {
        gesture = true;
        container
          .querySelector<HTMLButtonElement>(
            '[data-action-id="document.presentation"]',
          )!
          .click();
        gesture = false;
      });
      expect(onPresent).toHaveBeenCalledOnce();
      await click(container.querySelector('[aria-label="文档"]')!);
      expect(
        document.querySelector('[data-action-id="document.undo"] svg'),
      ).toBeTruthy();
      expect(
        document.querySelector('[data-action-id="document.undo"] kbd')
          ?.textContent,
      ).toMatch(/Z/i);
      expect(
        document
          .querySelector('[data-action-id="document.command-palette"]')
          ?.hasAttribute('data-group-start'),
      ).toBe(true);
      expect(
        document.querySelector<HTMLButtonElement>(
          '[data-action-id="document.redo"]',
        )!.disabled,
      ).toBe(true);
      await click(document.querySelector('[data-action-id="document.undo"]')!);
      expect(undo).toHaveBeenCalledOnce();
      await render({ showSaveStatus: false });
      expect(container.querySelector('[data-testid="save-status"]')).toBeNull();
    } finally {
      controller.actions.mockReturnValue([]);
      history.dispose();
    }
  });

  it('locates an exact embedded occurrence and rejects a changed body before touching selection', async () => {
    const onNavigationResult = vi.fn();
    const reference = {
      targetFrameId: 'board',
      occurrence: 1,
      revision: JSON.stringify(value.content),
    };
    const target = { kind: 'file' as const, fileId: value.id };
    await render({
      navigation: { requestId: 80, target, frameReference: reference },
      onNavigationResult,
    });
    await flushFrames();
    expect(controller.locateFrameReference).toHaveBeenCalledExactlyOnceWith(
      'board',
      1,
    );
    expect(onNavigationResult).toHaveBeenLastCalledWith(80, {
      status: 'revealed',
    });
    await render({
      navigation: {
        requestId: 81,
        target,
        frameReference: { ...reference, revision: 'old-body' },
      },
      onNavigationResult,
    });
    await flushFrames();
    expect(controller.locateFrameReference).toHaveBeenCalledTimes(1);
    expect(onNavigationResult).toHaveBeenLastCalledWith(81, {
      status: 'unavailable',
      code: 'stale-reference',
    });
    expect(container.textContent).toContain('引用位置已变化');
  });

  it('keeps page actions usable through StrictMode effect replay and disposes on unmount', async () => {
    vi.unstubAllGlobals();
    const onExport = vi.fn();
    await act(async () =>
      root.render(
        <I18nProvider language="zh" persistLanguage={false}>
          <StrictMode>
            <DocumentPage
              value={value}
              title="Guide"
              onChange={() => {}}
              onExport={onExport}
            />
          </StrictMode>
        </I18nProvider>,
      ),
    );
    const button =
      container.querySelector<HTMLButtonElement>('[aria-label="文档"]')!;
    await click(button);
    await click(
      document.querySelector('[data-action-id="document.export-markdown"]')!,
    );
    expect(onExport).toHaveBeenCalledWith('markdown');
    await click(button);
    let finish!: (result: { status: string }) => void;
    controller.flushEditing.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await click(
      document.querySelector('[data-action-id="document.export-markdown"]')!,
    );
    await act(async () => root.render(null));
    await act(async () => finish({ status: 'completed' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  for (const readonly of [false, true])
    it(`opens the document palette from its menu (readonly=${readonly})`, async () => {
      vi.unstubAllGlobals();
      await render({ readonly });
      const button =
        container.querySelector<HTMLButtonElement>('[aria-label="文档"]')!;
      await click(button);
      expect(
        !!document.querySelector(
          '[role="dialog"][aria-label="文档"] button[aria-haspopup="dialog"]',
        ),
      ).toBe(!readonly);
      await click(
        document.querySelector('[data-action-id="document.command-palette"]')!,
      );
      const dialog = document.querySelector('dialog')!;
      expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
      expect(dialog.querySelector('input')).toBe(document.activeElement);
      await act(async () =>
        dialog.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      );
      expect(document.querySelector('dialog')).toBeNull();
      expect(document.activeElement).toBe(button);
    });

  it('changes ordinary link activation without editing content', async () => {
    const onOpenLink = vi.fn();
    const onChange = vi.fn();
    await render({ onOpenLink, onChange, linkActivation: 'modifier' });
    await click(container.querySelector('a')!);
    expect(onOpenLink).not.toHaveBeenCalled();
    await render({ onOpenLink, onChange, linkActivation: 'click' });
    await click(container.querySelector('a')!);
    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith(
      'verd://file/guide#章节',
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps ordinary editing clicks local and activates modifier clicks', async () => {
    const onOpenLink = vi.fn();
    await render({ onOpenLink });
    const label = container.querySelector('a span')!;
    expect((await click(label)).defaultPrevented).toBe(true);
    expect(onOpenLink).not.toHaveBeenCalled();
    await click(label, { ctrlKey: true });
    await click(label, { metaKey: true });
    expect(onOpenLink.mock.calls).toEqual([
      ['verd://file/guide#章节'],
      ['verd://file/guide#章节'],
    ]);
    const middle = new MouseEvent('auxclick', {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    label.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    expect(onOpenLink).toHaveBeenCalledTimes(2);
  });

  it('opens on a normal readonly click and suppresses native navigation without a handler', async () => {
    const onOpenLink = vi.fn();
    await render({ readonly: true, onOpenLink });
    await click(container.querySelector('a')!);
    expect(onOpenLink).toHaveBeenCalledWith('verd://file/guide#章节');
    await render({ readonly: true });
    expect((await click(container.querySelector('a')!)).defaultPrevented).toBe(
      true,
    );
  });

  it('previews the selected workspace target from the editor dialog', async () => {
    const onPreviewLink = vi.fn();
    const href = 'verd://file/guide#章节';
    await render({
      onPreviewLink,
      linkChoices: [
        {
          href: 'verd://file/guide#%E7%AB%A0%E8%8A%82',
          title: '章节',
          detail: '指南',
        },
      ],
    });
    await click(container.querySelector('button[title="链接"]')!);
    const dialog = container.querySelector('dialog')!;
    expect(
      dialog.querySelector<HTMLInputElement>('[role="combobox"]')?.value,
    ).toBe('章节');
    const preview = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === '预览',
    )!;
    await click(preview);
    expect(onPreviewLink).toHaveBeenCalledWith(encodeURI(href), undefined);
  });

  it('waits for the editor and applies each navigation request once', async () => {
    await render({
      navigation: {
        target: { kind: 'heading', fileId: value.id, slug: '章节-1' },
        requestId: 1,
      },
    });
    expect(controller.locateHeading).not.toHaveBeenCalled();
    await flushFrames();
    expect(controller.locateHeading).toHaveBeenCalledExactlyOnceWith(20);
    await render({
      navigation: {
        target: { kind: 'heading', fileId: value.id, slug: '章节-1' },
        requestId: 1,
      },
    });
    await flushFrames();
    expect(controller.locateHeading).toHaveBeenCalledTimes(1);
    await render({
      navigation: {
        target: { kind: 'heading', fileId: value.id, slug: '章节' },
        requestId: 2,
      },
    });
    await flushFrames();
    expect(controller.locateHeading).toHaveBeenLastCalledWith(10);
    await render({
      navigation: { target: { kind: 'file', fileId: value.id }, requestId: 3 },
    });
    await flushFrames();
    expect(controller.focus).toHaveBeenCalledWith('start');
  });

  it('reports a missing heading without moving the current selection', async () => {
    await render({
      navigation: {
        target: { kind: 'heading', fileId: value.id, slug: 'removed' },
        requestId: 1,
      },
    });
    await flushFrames();
    expect(controller.focus).not.toHaveBeenCalled();
    expect(
      container.querySelector('.document-page__notice')?.textContent,
    ).toContain('未找到目标章节');
  });
});
