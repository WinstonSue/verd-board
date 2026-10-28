import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { FrameSettingsText } from './frame-settings';
import { createFramePluginSet, type FrameUIPlugin } from './frame-plugins';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('settings integration', () => {
  it('follows external history while retaining local drafts until cancel', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const onCommit = vi.fn();
    const render = (value: string) =>
      root.render(
        <FrameSettingsText
          field={{ key: 'name', label: 'Name' }}
          value={value}
          onCommit={onCommit}
        />,
      );
    try {
      await act(() => render('alpha'));
      const input = host.querySelector('input')!;
      await act(() => render('beta'));
      expect(host.querySelector('input')).toBe(input);
      expect(input.value).toBe('beta');
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'draft');
      await act(() =>
        input.dispatchEvent(new Event('input', { bubbles: true })),
      );
      await act(() => render('gamma'));
      expect(input.value).toBe('draft');
      await act(() =>
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      );
      expect(input.value).toBe('gamma');
      expect(onCommit).not.toHaveBeenCalled();
    } finally {
      await act(() => root.unmount());
    }
  });

  it('rejects duplicate panel identities across plugins and contribution kinds', () => {
    const plugin = (id: string): FrameUIPlugin => ({
      id,
      engine: { id, install() {} },
      propertyPanels: [{ id: 'shared', render: () => null }],
    });
    const second = {
      ...plugin('second'),
      propertyPanels: undefined,
      settingsPanels: [{ id: 'shared', render: () => null }],
    };
    expect(() => createFramePluginSet([plugin('first'), second])).toThrow(
      'settings panel id',
    );
  });
});
