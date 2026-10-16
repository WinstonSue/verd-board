import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n';
import { FrameSaveStatus } from './frame-save-status';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
});
async function mount(language: 'zh' | 'en' = 'zh') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const render = (props: React.ComponentProps<typeof FrameSaveStatus>) =>
    act(async () =>
      root.render(
        <I18nProvider defaultLanguage={language} persistLanguage={false}>
          <FrameSaveStatus {...props} />
        </I18nProvider>,
      ),
    );
  return {
    container,
    render,
    status: () => container.querySelector('[role="status"]')!,
  };
}
describe('save status presentation', () => {
  it('retains the last successful time during saving and failure, and exposes retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 13, 22));
    const test = await mount();
    const lastSavedAt = new Date(2026, 9, 13, 21, 45, 9).getTime();
    const retry = vi.fn();
    for (const [status, label] of [
      ['saved', '已保存'],
      ['saving', '保存中'],
      ['error', '保存失败'],
    ] as const) {
      await test.render({ status, lastSavedAt, onRetrySave: retry });
      expect(test.status().textContent).toBe(`${label} · 21:45:09`);
      expect(test.status().getAttribute('data-save-state')).toBe(status);
      expect(test.status().getAttribute('title')).toContain('2026/10/13');
    }
    await act(async () => test.container.querySelector('button')!.click());
    expect(retry).toHaveBeenCalledOnce();
  });
  it('distinguishes unsaved content and unknown or invalid historical timestamps', async () => {
    const test = await mount();
    await test.render({ status: 'idle' });
    expect(test.status().textContent).toBe('尚未保存');
    for (const lastSavedAt of [undefined, NaN, Infinity, -1, 9e20]) {
      await test.render({ status: 'saved', lastSavedAt });
      expect(test.status().textContent).toBe('已保存 · 保存时间未知');
      expect(test.status().hasAttribute('title')).toBe(false);
    }
  });
  it('includes the date for earlier saves and translates English states', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 13, 22));
    const test = await mount('en');
    await test.render({
      status: 'saved',
      lastSavedAt: new Date(2026, 9, 12, 23, 59, 59).getTime(),
    });
    expect(test.status().textContent).toContain('Saved · 12/10/2026');
    expect(test.status().textContent).toContain('23:59:59');
    await test.render({ status: 'error', onRetrySave: () => {} });
    expect(test.status().textContent).toBe('Save failed');
    expect(test.container.querySelector('button')?.textContent).toBe('Retry');
  });
});
