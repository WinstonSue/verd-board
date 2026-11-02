import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import {
  shouldActivateRichTextLink,
  useRichTextLinks,
} from './rich-text-links';
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
describe('rich text link activation', () => {
  it('defaults to modifier activation and overrides it only for readonly or click preference', () => {
    const plain = { button: 0, ctrlKey: false, metaKey: false };
    expect(shouldActivateRichTextLink(plain, {})).toBeFalsy();
    for (const key of ['ctrlKey', 'metaKey'])
      expect(
        shouldActivateRichTextLink({ ...plain, [key]: true }, {}),
      ).toBeTruthy();
    expect(shouldActivateRichTextLink(plain, { readonly: true })).toBeTruthy();
    expect(
      shouldActivateRichTextLink(plain, { activation: 'click' }),
    ).toBeTruthy();
    for (const button of [1, 2])
      expect(
        shouldActivateRichTextLink({ ...plain, button }, { readonly: true }),
      ).toBeFalsy();
  });
  it('keeps nested links with their own navigation host', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const outer = vi.fn();
    const inner = vi.fn();
    function Inner() {
      return (
        <div {...useRichTextLinks({ activation: 'click', onOpenLink: inner })}>
          <a href="verd://file/nested">Nested</a>
        </div>
      );
    }
    function Outer() {
      return (
        <div {...useRichTextLinks({ activation: 'click', onOpenLink: outer })}>
          <Inner />
        </div>
      );
    }
    try {
      await act(async () => root.render(<Outer />));
      host
        .querySelector('a')!
        .dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        );
      expect(inner).toHaveBeenCalledExactlyOnceWith('verd://file/nested');
      expect(outer).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
  it('opens a static canvas link on pointer release once and ignores drags', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const open = vi.fn();
    function Links() {
      return (
        <div
          {...useRichTextLinks({
            activation: 'click',
            blockPointer: true,
            onOpenLink: open,
          })}
        >
          <a href="https://example.com">Example</a>
        </div>
      );
    }
    try {
      await act(async () => root.render(<Links />));
      const anchor = host.querySelector('a')!;
      const pointer = (type: string, x: number) =>
        anchor.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            button: 0,
          }),
        );
      pointer('pointerdown', 10);
      pointer('pointermove', 30);
      pointer('pointerup', 30);
      expect(open).not.toHaveBeenCalled();
      pointer('pointerdown', 10);
      pointer('pointerup', 10);
      anchor.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
      );
      expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
  it('suppresses browser navigation and ignores a dragged link while allowing a subsequent click', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const open = vi.fn();
    function Links() {
      return (
        <div {...useRichTextLinks({ activation: 'click', onOpenLink: open })}>
          <a href="verd://file/example">Example</a>
        </div>
      );
    }
    try {
      await act(async () => root.render(<Links />));
      const anchor = host.querySelector('a')!;
      const pointer = (type: string, x: number) =>
        anchor.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            clientX: x,
            clientY: 10,
            button: 0,
          }),
        );
      pointer('pointerdown', 10);
      pointer('pointermove', 30);
      const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      anchor.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      expect(open).not.toHaveBeenCalled();
      pointer('pointerdown', 10);
      anchor.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      expect(open).toHaveBeenCalledExactlyOnceWith('verd://file/example');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
