import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SettingsSelectEditor, SettingsSelectScope } from './settings-select';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('closes portaled options when the inspector hides or changes selection without committing', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const commit = vi.fn();
  const render = (active: boolean, identity: string) =>
    act(async () =>
      root.render(
        <SettingsSelectScope active={active} identity={identity}>
          <SettingsSelectEditor
            value="a"
            options={[
              { value: 'a', label: 'Alpha' },
              { value: 'b', label: 'Beta' },
            ]}
            props={{}}
            disabled={false}
            state={{}}
            identity="field"
            label="Choice"
            commit="change"
            onCommit={commit}
            onReset={() => {}}
          />
        </SettingsSelectScope>,
      ),
    );
  const combo = () =>
    host.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const open = () =>
    act(async () =>
      combo().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          keyCode: 40,
          bubbles: true,
        }),
      ),
    );
  try {
    await render(true, 'first');
    await open();
    expect(combo().getAttribute('aria-expanded')).toBe('true');
    const listbox = document.getElementById(
      combo().getAttribute('aria-controls')!,
    );
    expect(listbox?.ownerDocument).toBe(document);
    expect(host.contains(listbox)).toBe(false);
    await render(false, 'first');
    expect(combo().getAttribute('aria-expanded')).toBe('false');
    await render(true, 'first');
    expect(combo().getAttribute('aria-expanded')).toBe('false');
    await open();
    await render(true, 'second');
    expect(combo().getAttribute('aria-expanded')).toBe('false');
    expect(commit).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
