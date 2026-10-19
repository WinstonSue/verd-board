import React, { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FramePropertyGroup, FramePropertyPanel } from './frame-property-panel';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function mount(defaultCollapsed = true) {
  const container = document.createElement('div');
  const root = createRoot(container);
  const rendered = vi.fn();
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Fields() {
    rendered();
    const [draft, setDraft] = useState(0);
    useEffect(() => {
      mounted();
      return () => {
        unmounted();
      };
    }, []);
    return (
      <button
        type="button"
        data-field
        onClick={() => setDraft((value) => value + 1)}
      >
        Draft {draft}
      </button>
    );
  }
  const render = async (reveal = 0) =>
    act(async () =>
      root.render(
        <FramePropertyPanel
          title="Properties"
          open
          identity="selection"
          disabled={false}
        >
          <FramePropertyGroup
            id="arrangement"
            title="Arrange"
            defaultCollapsed={defaultCollapsed}
            reveal={reveal}
          >
            <Fields />
          </FramePropertyGroup>
        </FramePropertyPanel>,
      ),
    );
  cleanups.push(async () => {
    await act(async () => root.unmount());
  });
  await render();
  const toggle = () =>
    container.querySelector<HTMLButtonElement>(
      '.frame-property-group__toggle',
    )!;
  const content = () =>
    container.querySelector<HTMLDivElement>('.frame-property-group__content')!;
  const field = () =>
    container.querySelector<HTMLButtonElement>('[data-field]');
  return {
    container,
    render,
    toggle,
    content,
    field,
    rendered,
    mounted,
    unmounted,
  };
}

describe('FramePropertyGroup deferred fields', () => {
  it('keeps its accessible collapsed shell without rendering fields, then mounts them on expansion', async () => {
    const test = await mount();
    expect(
      test.container.querySelector('[data-property-group="arrangement"]'),
    ).not.toBeNull();
    expect(test.toggle().getAttribute('aria-expanded')).toBe('false');
    expect(test.toggle().getAttribute('aria-controls')).toBe(test.content().id);
    expect(test.content().hidden).toBe(true);
    expect(test.field()).toBeNull();
    expect(test.rendered).not.toHaveBeenCalled();
    await act(async () => test.toggle().click());
    expect(test.toggle().getAttribute('aria-expanded')).toBe('true');
    expect(test.content().hidden).toBe(false);
    expect(test.field()?.textContent).toBe('Draft 0');
    expect(test.mounted).toHaveBeenCalledTimes(1);
  });

  it('retains mounted fields and their local draft after collapsing and expanding again', async () => {
    const test = await mount();
    await act(async () => test.toggle().click());
    const field = test.field()!;
    await act(async () => field.click());
    expect(field.textContent).toBe('Draft 1');
    await act(async () => test.toggle().click());
    expect(test.content().hidden).toBe(true);
    expect(test.field()).toBe(field);
    expect(test.unmounted).not.toHaveBeenCalled();
    await act(async () => test.toggle().click());
    expect(test.content().hidden).toBe(false);
    expect(test.field()).toBe(field);
    expect(test.field()?.textContent).toBe('Draft 1');
    expect(test.mounted).toHaveBeenCalledTimes(1);
  });

  it('mounts fields when revealed and allows a later reveal to reopen the same fields', async () => {
    const test = await mount();
    expect(test.field()).toBeNull();
    await test.render(1);
    expect(test.toggle().getAttribute('aria-expanded')).toBe('true');
    const field = test.field();
    expect(field).not.toBeNull();
    await act(async () => test.toggle().click());
    await test.render(1);
    expect(test.content().hidden).toBe(true);
    await test.render(2);
    expect(test.content().hidden).toBe(false);
    expect(test.field()).toBe(field);
    expect(test.mounted).toHaveBeenCalledTimes(1);
  });

  it('renders fields immediately for a group that starts expanded', async () => {
    const test = await mount(false);
    expect(test.content().hidden).toBe(false);
    expect(test.field()?.textContent).toBe('Draft 0');
    expect(test.mounted).toHaveBeenCalledTimes(1);
  });
});
