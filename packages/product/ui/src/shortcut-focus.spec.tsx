import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { createMindFrameSnapshot } from '@sue/board-mind';
import { I18nProvider } from './i18n';
import { VerdFrame } from './verd-frame';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
    onchange: null,
  }) as MediaQueryList;

describe('tool shortcuts and real focus', () => {
  it('does not rename a topic when H or V is sent to the focused element after the autofocus window', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const value = createMindFrameSnapshot('frame', 'topic');
    await act(async () =>
      root.render(
        <I18nProvider defaultLanguage="zh" persistLanguage={false}>
          <div style={{ width: 800, height: 600 }}>
            <VerdFrame value={value} frameId="frame" onChange={() => {}} />
          </div>
        </I18nProvider>,
      ),
    );
    const topic = container.querySelector('[data-cell-id="topic"]')!;
    await act(async () => {
      topic.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          button: 0,
          clientX: 30,
          clientY: 30,
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const active = document.activeElement as HTMLElement;
    expect(active?.closest?.('[contenteditable="true"], input, textarea')).toBe(
      null,
    );
    for (const key of ['h', 'v']) {
      await act(async () => {
        active.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }
    expect(container.textContent).not.toContain('h中心');
    expect(
      container.querySelector('[data-cell-id="topic"]')?.textContent,
    ).not.toMatch(/^[hv]/);
    await act(async () => root.unmount());
    container.remove();
  });

  it('edits in place with a real key, Tab, Enter, and leaves IME and inputs alone', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let current = createMindFrameSnapshot('frame', 'topic');
    function Harness() {
      const [value, setValue] = useState(current);
      return (
        <I18nProvider defaultLanguage="zh" persistLanguage={false}>
          <div style={{ width: 900, height: 640 }}>
            <VerdFrame
              value={value}
              frameId="frame"
              onOpenFrame={() => {}}
              onChange={(change) => {
                current = change.snapshot;
                setValue(change.snapshot);
              }}
            />
          </div>
        </I18nProvider>
      );
    }
    await act(async () => root.render(<Harness />));
    const topic = () => container.querySelector('[data-cell-id="topic"]')!;
    const keyOn = async (
      target: EventTarget,
      key: string,
      init: KeyboardEventInit = {},
    ) => {
      await act(async () => {
        target.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...init,
          }),
        );
      });
    };
    await act(async () => {
      topic().dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const canvas = document.activeElement as HTMLElement;
    expect(canvas.closest('[contenteditable="true"], input, textarea')).toBe(
      null,
    );
    await keyOn(canvas, 'x');
    expect(topic().textContent).toContain('x');
    expect(topic().textContent).not.toContain('Central topic');
    const editor = container.querySelector(
      '[data-frame-text-editor] [contenteditable="true"]',
    ) as HTMLElement;
    expect(editor).toBeTruthy();
    await keyOn(editor, 'Tab');
    expect(
      container.querySelectorAll('[data-cell-kind="mind-child"]'),
    ).toHaveLength(1);
    const childEditor = container.querySelector(
      '[data-frame-text-editor] [contenteditable="true"]',
    ) as HTMLElement;
    expect(childEditor).toBeTruthy();
    await keyOn(childEditor, 'Enter');
    expect(container.querySelector('[data-frame-text-editor]')).toBeNull();
    expect(
      container.querySelectorAll('[data-cell-kind="mind-child"]'),
    ).toHaveLength(1);
    expect(document.activeElement?.tagName.toLowerCase()).toBe('svg');
    const child = container.querySelector('[data-cell-kind="mind-child"]')!;
    await act(async () => {
      child.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      );
    });
    await keyOn(document.activeElement!, 'Enter');
    expect(
      container.querySelectorAll('[data-cell-kind="mind-child"]'),
    ).toHaveLength(2);

    await act(async () => {
      topic().dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      );
    });
    const beforeIme = topic().textContent;
    await keyOn(document.activeElement!, 'h', { isComposing: true });
    expect(topic().textContent).toBe(beforeIme);
    expect(
      container
        .querySelector('[aria-label="选择"]')
        ?.getAttribute('aria-pressed'),
    ).not.toBe('false');

    const field = container.querySelector(
      '[data-testid="inspector-name"]',
    ) as HTMLElement;
    field.focus();
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      field.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(false);
    await keyOn(field, 'h');
    expect(topic().textContent).toBe(beforeIme);
    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps undo disabled on a readonly canvas that already has history', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const initial = createMindFrameSnapshot('frame', 'topic');
    function Harness() {
      const [value, setValue] = useState(initial);
      const [locked, setLocked] = useState(false);
      return (
        <I18nProvider defaultLanguage="zh" persistLanguage={false}>
          <button type="button" onClick={() => setLocked(true)}>
            lock canvas
          </button>
          <div style={{ width: 900, height: 640 }}>
            <VerdFrame
              value={value}
              frameId="frame"
              readonly={locked}
              onOpenFrame={() => undefined}
              onChange={(change) => setValue(change.snapshot)}
            />
          </div>
        </I18nProvider>
      );
    }
    await act(async () => root.render(<Harness />));
    const undo = () =>
      container.querySelector('[aria-label="撤销"]') as HTMLButtonElement;
    expect(undo().disabled).toBe(true);
    const topic = container.querySelector('[data-cell-id="topic"]')!;
    await act(async () => {
      topic.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    await act(async () => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'x',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(undo().disabled).toBe(false);
    await act(async () => {
      (
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'lock canvas',
        ) as HTMLButtonElement
      ).click();
    });
    expect(undo().disabled).toBe(true);
    undo().click();
    expect(container.textContent).toContain('x');
    expect(container.textContent).not.toContain('Central topic');
    await act(async () => root.unmount());
    container.remove();
  });
});
