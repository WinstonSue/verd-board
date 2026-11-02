import { useRef, type MouseEvent, type PointerEvent } from 'react';

export type RichTextLinkActivation = 'modifier' | 'click';
export interface RichTextLinkOptions {
  activation?: RichTextLinkActivation;
  locale?: 'zh' | 'en';
  readonly?: boolean;
  onOpenLink?(href: string): void;
  blockPointer?: boolean;
}
export function shouldActivateRichTextLink(
  event: {
    button: number;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  },
  options: RichTextLinkOptions,
) {
  return (
    event.button === 0 &&
    !event.shiftKey &&
    !event.altKey &&
    (options.readonly ||
      options.activation === 'click' ||
      event.ctrlKey ||
      event.metaKey)
  );
}
const anchorOf = (
  target: EventTarget | null,
  currentTarget: EventTarget | null,
) => {
  const anchor =
    target instanceof Element
      ? target.closest<HTMLAnchorElement>('a[href]')
      : null;
  const owner = anchor?.closest('[data-rich-text-links]');
  return owner && owner !== currentTarget ? null : anchor;
};

/** Navigation belongs to the host; selection and dragging never open a link. */
export function useRichTextLinks(options: RichTextLinkOptions) {
  const openedPointer = useRef(false);
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  return {
    'data-rich-text-links': '',
    onPointerOverCapture(event: PointerEvent) {
      const anchor = anchorOf(event.target, event.currentTarget);
      if (!anchor) return;
      const direct = options.readonly || options.activation === 'click';
      const mac =
        typeof navigator !== 'undefined' &&
        /Mac|iPhone|iPad/.test(navigator.platform);
      const zh = options.locale
        ? options.locale === 'zh'
        : typeof document !== 'undefined' &&
          !document.documentElement.lang.startsWith('en');
      anchor.title = direct
        ? zh
          ? '单击打开链接'
          : 'Click to open link'
        : zh
          ? `${mac ? '⌘' : 'Ctrl'} + 单击打开链接`
          : `${mac ? '⌘' : 'Ctrl'} + click to open link`;
      anchor.style.cursor =
        direct || event.ctrlKey || event.metaKey ? 'pointer' : 'text';
    },
    onPointerDownCapture(event: PointerEvent) {
      if (!anchorOf(event.target, event.currentTarget)) return;
      openedPointer.current = false;
      pointer.current = { x: event.clientX, y: event.clientY, moved: false };
      if (
        options.blockPointer &&
        options.onOpenLink &&
        shouldActivateRichTextLink(event, options)
      ) {
        event.stopPropagation();
      }
    },
    onPointerMoveCapture(event: PointerEvent) {
      const anchor = anchorOf(event.target, event.currentTarget);
      if (anchor)
        anchor.style.cursor =
          options.readonly ||
          options.activation === 'click' ||
          event.ctrlKey ||
          event.metaKey
            ? 'pointer'
            : 'text';
      const start = pointer.current;
      if (
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4
      )
        start.moved = true;
    },
    // Static SVG text can lose its synthesized click after pointer capture.
    // Open on release, then suppress the following mouse click when it exists.
    onPointerUpCapture(event: PointerEvent) {
      const anchor = anchorOf(event.target, event.currentTarget);
      if (
        !options.blockPointer ||
        !anchor ||
        !pointer.current ||
        pointer.current.moved ||
        !options.onOpenLink ||
        !shouldActivateRichTextLink(event, options)
      )
        return;
      openedPointer.current = true;
      pointer.current = null;
      event.preventDefault();
      event.stopPropagation();
      options.onOpenLink(anchor.getAttribute('href')!);
    },
    onClickCapture(event: MouseEvent) {
      const anchor = anchorOf(event.target, event.currentTarget);
      if (!anchor) return;
      event.preventDefault();
      if (openedPointer.current && event.detail > 0) {
        openedPointer.current = false;
        return;
      }
      const moved = pointer.current?.moved;
      pointer.current = null;
      if (
        moved ||
        !shouldActivateRichTextLink(event, options) ||
        !options.onOpenLink
      )
        return;
      event.stopPropagation();
      options.onOpenLink(anchor.getAttribute('href')!);
    },
    onAuxClickCapture(event: MouseEvent) {
      if (anchorOf(event.target, event.currentTarget)) event.preventDefault();
    },
  };
}
