import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { FrameAppearanceSettings } from './frame-appearance-settings';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it.each(['product', 'editor'] as const)(
  'records an explicit color equal to the resolved value in the %s inspector',
  async (profile) => {
    const container = document.createElement('div'),
      root = createRoot(container);
    document.body.append(container);
    const onSetColor = vi.fn(),
      onResetColor = vi.fn();
    try {
      await act(async () =>
        root.render(
          <FrameAppearanceSettings
            profile={profile}
            language="en"
            identity="shape"
            includeFill
            values={{
              fill: '#ffffff',
              strokeColor: '#64748b',
              strokeWidth: 1,
              opacity: 1,
              strokeStyle: 'solid',
              shadow: 'none',
            }}
            onCommit={() => undefined}
            onSetColor={onSetColor}
            onResetColor={onResetColor}
          />,
        ),
      );
      const input = container.querySelector<HTMLInputElement>(
        profile === 'product'
          ? '[aria-label="Fill color"]'
          : '[aria-label="fill"]',
      )!;
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      for (const value of ['#ff0000', '#ffffff']) {
        await act(async () => {
          set.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }
      if (profile === 'editor')
        await act(async () =>
          input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
        );
      expect(onSetColor).toHaveBeenLastCalledWith('fill', '#ffffff');
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Reset fill to theme"]',
          )!
          .click(),
      );
      expect(onResetColor).toHaveBeenCalledWith('fill');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
