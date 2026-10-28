import { act, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionRegistry, type ActionDefinition } from '@sue/board-common';
import { ActionScope, useActionState, type ActionScopeValue } from './scope';
import { matchesActionShortcut } from './shortcuts';
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function mount(children: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(() => root.render(children));
  cleanups.push(async () => {
    await act(() => root.unmount());
    host.remove();
  });
  return {
    host,
    unmount: async () => {
      await act(() => root.unmount());
      host.remove();
      cleanups.pop();
    },
  };
}
async function key(
  target: Element,
  name: string,
  init: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}
function action(
  id: string,
  run: () => void,
  extra: Partial<ActionDefinition<object>> = {},
): ActionDefinition<object> {
  return {
    id,
    label: id,
    category: 'test',
    effect: 'view',
    shortcuts: [{ key: 'd', mod: true }],
    execute: () => {
      run();
      return { status: 'completed' };
    },
    ...extra,
  };
}
function registry(...definitions: ActionDefinition<object>[]) {
  const value = createActionRegistry({ getContext: () => ({}) });
  definitions.forEach((definition) => value.register(definition));
  value.seal();
  return value;
}

describe('React action scopes', () => {
  for (const returnToToolbar of [false, true])
    it(`restores editor selection only when focus returns to the editor (toolbar=${returnToToolbar})`, async () => {
      const source = registry(action('workspace', vi.fn()));
      let scope: ActionScopeValue | null = null;
      const { host } = await mount(
        <ActionScope
          registry={source}
          onReady={(value) => {
            scope = value;
          }}
        >
          <div
            role="textbox"
            contentEditable
            suppressContentEditableWarning
            tabIndex={0}
          >
            Keep this selection
          </div>
          <button data-return-focus>Toolbar</button>
        </ActionScope>,
      );
      const editor = host.querySelector<HTMLElement>('[contenteditable]')!;
      editor.focus();
      const range = document.createRange();
      range.setStart(editor.firstChild!, 5);
      range.setEnd(editor.firstChild!, 9);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const toolbar = host.querySelector<HTMLButtonElement>(
        '[data-return-focus]',
      )!;
      if (returnToToolbar)
        await act(() => scope!.openPalette({ returnFocus: toolbar }));
      else await key(editor, 'p', { ctrlKey: true, shiftKey: true });
      selection.removeAllRanges();
      await key(host.querySelector('dialog input')!, 'Escape');
      expect(document.activeElement).toBe(returnToToolbar ? toolbar : editor);
      expect(selection.toString()).toBe(returnToToolbar ? '' : 'this');
    });

  for (const modifier of ['ctrlKey', 'metaKey'] as const) {
    it(`opens the nearest palette before an editor stops propagation (${modifier})`, async () => {
      const local = vi.fn(),
        outer = vi.fn();
      const parent = registry(
        action('shared', outer),
        action('workspace', vi.fn(), { shortcuts: undefined }),
      );
      const child = registry(action('shared', local));
      const { host } = await mount(
        <ActionScope registry={parent} paletteFallback>
          <ActionScope registry={child}>
            <input onKeyDown={(event) => event.stopPropagation()} />
          </ActionScope>
        </ActionScope>,
      );
      const input = host.querySelector('input')!;
      input.focus();
      const event = await key(input, 'P', { [modifier]: true, shiftKey: true });
      expect(event.defaultPrevented).toBe(true);
      expect(host.querySelectorAll('dialog')).toHaveLength(1);
      const shared = host.querySelector<HTMLButtonElement>(
        '[data-action-id="shared"]',
      )!;
      await act(() => shared.click());
      expect(local).toHaveBeenCalledTimes(1);
      expect(outer).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
      await key(input, 'p', { [modifier]: true, shiftKey: true });
      await key(host.querySelector('dialog input')!, 'Escape');
      expect(host.querySelector('dialog')).toBeNull();
      expect(document.activeElement).toBe(input);
    });

    it(`uses only the opted-in root palette on body/html focus (${modifier})`, async () => {
      const parent = registry(action('workspace', vi.fn()));
      const child = registry(action('editor', vi.fn()));
      const { host, unmount } = await mount(
        <StrictMode>
          <ActionScope registry={parent} paletteFallback>
            <ActionScope registry={child}>
              <input />
            </ActionScope>
          </ActionScope>
        </StrictMode>,
      );
      expect(document.activeElement).toBe(document.body);
      for (const target of [document.body, document.documentElement]) {
        expect(
          (await key(target, 'p', { [modifier]: true, shiftKey: true }))
            .defaultPrevented,
        ).toBe(true);
        expect(host.querySelectorAll('dialog')).toHaveLength(1);
        expect(host.querySelector('[data-action-id="workspace"]')).toBeTruthy();
        expect(host.querySelector('[data-action-id="editor"]')).toBeNull();
        await key(host.querySelector('dialog input')!, 'Escape');
        expect(document.activeElement).toBe(document.body);
      }
      await unmount();
      expect(
        (await key(document.body, 'p', { [modifier]: true, shiftKey: true }))
          .defaultPrevented,
      ).toBe(false);
    });
  }

  it('keeps fallback opt-in and does not fall through disabled or unrelated scopes', async () => {
    const source = registry(action('workspace', vi.fn()));
    const { host } = await mount(
      <>
        <ActionScope registry={source} paletteFallback enabled={false}>
          <button>Paused root</button>
        </ActionScope>
        <ActionScope registry={source}>
          <button>Independent root</button>
        </ActionScope>
      </>,
    );
    expect(
      (await key(document.body, 'p', { ctrlKey: true, shiftKey: true }))
        .defaultPrevented,
    ).toBe(false);
    await key(host.querySelector('button')!, 'p', {
      ctrlKey: true,
      shiftKey: true,
    });
    expect(host.querySelector('dialog')).toBeNull();
  });

  it('does not escape a disabled nested scope through the root fallback', async () => {
    const source = registry(action('workspace', vi.fn()));
    const { host } = await mount(
      <ActionScope registry={source} paletteFallback>
        <ActionScope registry={source} enabled={false}>
          <input />
        </ActionScope>
      </ActionScope>,
    );
    await key(host.querySelector('input')!, 'p', {
      ctrlKey: true,
      shiftKey: true,
    });
    expect(host.querySelector('dialog')).toBeNull();
  });

  it('protects IME, repeated keys, modifiers and already-consumed keys in both routes', async () => {
    const source = registry(action('workspace', vi.fn()));
    const { host } = await mount(
      <ActionScope registry={source} paletteFallback>
        <input />
      </ActionScope>,
    );
    for (const target of [document.body, host.querySelector('input')!]) {
      for (const init of [
        { isComposing: true },
        { keyCode: 229 },
        { repeat: true },
        { altKey: true },
        { modifierAltGraph: true },
      ]) {
        expect(
          (await key(target, 'p', { ctrlKey: true, shiftKey: true, ...init }))
            .defaultPrevented,
        ).toBe(false);
        expect(host.querySelector('dialog')).toBeNull();
      }
    }
    document.body.addEventListener(
      'keydown',
      (event) => event.preventDefault(),
      { once: true },
    );
    await key(document.body, 'p', { ctrlKey: true, shiftKey: true });
    expect(host.querySelector('dialog')).toBeNull();
  });

  it('leaves menus and dialogs in control and ignores hidden overlays for body fallback', async () => {
    const source = registry(action('workspace', vi.fn()));
    const { host } = await mount(
      <ActionScope registry={source} paletteFallback>
        <div role="dialog">
          <input />
        </div>
        <div role="menu">
          <button>Menu</button>
        </div>
      </ActionScope>,
    );
    for (const target of [
      document.body,
      host.querySelector('input')!,
      host.querySelector('button')!,
    ])
      await key(target, 'p', { ctrlKey: true, shiftKey: true });
    expect(host.querySelector('dialog')).toBeNull();
    host.querySelectorAll<HTMLElement>('[role]').forEach((element) => {
      element.hidden = true;
    });
    await key(document.body, 'p', { ctrlKey: true, shiftKey: true });
    expect(host.querySelectorAll('dialog')).toHaveLength(1);
    await key(host.querySelector('dialog input')!, 'p', {
      ctrlKey: true,
      shiftKey: true,
    });
    expect(host.querySelectorAll('dialog')).toHaveLength(1);
  });

  it('routes a key once through the nearest scope, with parent fallback for workspace bindings', async () => {
    const local = vi.fn(),
      outer = vi.fn(),
      workspace = vi.fn();
    const parent = registry(
      action('delete', outer),
      action('save', workspace, { shortcuts: [{ key: 's', mod: true }] }),
    );
    const child = registry(action('delete', local));
    const { host } = await mount(
      <ActionScope registry={parent}>
        <ActionScope registry={child}>
          <button>Canvas</button>
        </ActionScope>
      </ActionScope>,
    );
    const button = host.querySelector('button')!;
    expect((await key(button, 'd', { ctrlKey: true })).defaultPrevented).toBe(
      true,
    );
    await key(button, 's', { ctrlKey: true });
    expect(local).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    expect(workspace).toHaveBeenCalledTimes(1);
  });

  it('does not mutate a parent canvas when the nearest binding is disabled', async () => {
    const parentRun = vi.fn();
    const parent = registry(action('delete', parentRun));
    const child = registry(
      action('delete', vi.fn(), { getState: () => ({ enabled: false }) }),
    );
    const { host } = await mount(
      <ActionScope registry={parent}>
        <ActionScope registry={child}>
          <button>Readonly</button>
        </ActionScope>
      </ActionScope>,
    );
    await key(host.querySelector('button')!, 'd', { ctrlKey: true });
    expect(parentRun).not.toHaveBeenCalled();
  });

  it('keeps input, IME, repeat and clipboard transports outside logical key dispatch', async () => {
    const run = vi.fn();
    const source = registry(
      action('delete', run),
      action('copy', run, {
        shortcuts: [{ key: 'c', mod: true, transport: 'clipboard' }],
      }),
    );
    const { host } = await mount(
      <ActionScope registry={source}>
        <input />
        <button>Canvas</button>
      </ActionScope>,
    );
    const button = host.querySelector('button')!;
    for (const [target, init] of [
      [host.querySelector('input')!, {}],
      [button, { isComposing: true }],
      [button, { repeat: true }],
    ] as const)
      expect(
        (await key(target, 'd', { ctrlKey: true, ...init })).defaultPrevented,
      ).toBe(false);
    expect((await key(button, 'c', { ctrlKey: true })).defaultPrevented).toBe(
      false,
    );
    expect(run).not.toHaveBeenCalled();
    expect(
      matchesActionShortcut(
        {
          key: 'v',
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        },
        { key: 'v', mod: true },
      ),
    ).toBe(false);
  });

  it('rejects ambiguous conditional shortcuts without depending on plugin order', async () => {
    const run = vi.fn(),
      conflict = vi.fn();
    const source = registry(
      action('one', run, { shortcutWhen: () => true }),
      action('two', run, { shortcutWhen: () => true }),
    );
    const { host } = await mount(
      <ActionScope registry={source} onConflict={conflict}>
        <button>Canvas</button>
      </ActionScope>,
    );
    await key(host.querySelector('button')!, 'd', { ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    expect(conflict).toHaveBeenCalledWith(['one', 'two']);
  });

  it('captures palette targets before focus moves and subscribes to current availability', async () => {
    let focused = 'canvas',
      allowed = true;
    const run = vi.fn();
    const source = createActionRegistry({
      getContext: () => ({ id: focused }),
      refresh: (captured) => captured,
    });
    source.register({
      id: 'write',
      label: 'Write original',
      category: 'test',
      effect: 'view',
      getState: () => ({ enabled: allowed }),
      execute: (context) => {
        run(context.id);
        return { status: 'completed' };
      },
    });
    source.register({
      id: 'internal',
      label: 'Internal args',
      category: 'test',
      effect: 'content',
      palette: false,
      execute: () => ({ status: 'completed' }),
    });
    const { host } = await mount(
      <ActionScope registry={source} language="en">
        <button>Canvas</button>
      </ActionScope>,
    );
    const button = host.querySelector('button')!;
    button.focus();
    const focus = () => {
      focused = 'palette';
    };
    document.addEventListener('focusin', focus);
    try {
      await key(button, 'p', { ctrlKey: true, shiftKey: true });
      const dialog = host.querySelector('dialog')!;
      expect(dialog).toBeTruthy();
      expect(dialog.textContent).not.toContain('Internal args');
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        'Search commands',
      );
      await act(() => {
        allowed = false;
        source.invalidate();
      });
      expect(
        dialog
          .querySelector('[data-action-id="write"]')
          ?.getAttribute('aria-disabled'),
      ).toBe('true');
      await act(() => {
        allowed = true;
        source.invalidate();
      });
      await key(dialog.querySelector('input')!, 'Enter');
      expect(run).toHaveBeenCalledWith('canvas');
      expect(host.querySelector('dialog')).toBeNull();
      expect(document.activeElement).toBe(button);
    } finally {
      document.removeEventListener('focusin', focus);
    }
  });

  it('updates hook consumers and pairs onReady/null safely in StrictMode', async () => {
    let enabled = true;
    const source = registry(
      action('write', vi.fn(), { getState: () => ({ enabled }) }),
    );
    const ready = vi.fn<(scope: ActionScopeValue | null) => void>();
    function Probe() {
      const state = useActionState('write');
      return <button disabled={!state.enabled}>Write</button>;
    }
    const { host, unmount } = await mount(
      <StrictMode>
        <ActionScope registry={source} onReady={ready}>
          <Probe />
        </ActionScope>
      </StrictMode>,
    );
    expect(ready.mock.calls.map(([value]) => !!value)).toEqual([
      true,
      false,
      true,
    ]);
    await act(() => {
      enabled = false;
      source.invalidate();
    });
    expect(host.querySelector('button')?.disabled).toBe(true);
    await act(() => ready.mock.calls.at(-1)![0]!.openHelp());
    expect(host.querySelector('dialog')?.textContent).toContain('write');
    await unmount();
    expect(ready.mock.calls.at(-1)).toEqual([null]);
    // Effect cleanup belongs to React; it must not dispose a reusable registry.
    expect(source.getActionState('write').reason).not.toBe('scope-disposed');
  });
  it('does not bypass a suspended parent while routing a nested scope', async () => {
    const parentRun = vi.fn();
    const parent = registry(action('save', parentRun));
    const childRun = vi.fn();
    const child = registry(action('local', childRun));
    const { host } = await mount(
      <ActionScope registry={parent} enabled={false}>
        <ActionScope registry={child}>
          <button>Nested</button>
        </ActionScope>
      </ActionScope>,
    );
    await key(host.querySelector('button')!, 'd', { ctrlKey: true });
    expect(parentRun).not.toHaveBeenCalled();
    expect(childRun).not.toHaveBeenCalled();
  });
});
