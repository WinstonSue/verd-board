import { useLayoutEffect, useRef, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { createInlineText } from '@sue/board-common';
import { FrameTextEditor } from './frame-text-editor';
import { FrameRichText } from './frame-rich-text';
import { useFrameWheelPortal } from './frame-wheel';

export const frameTitleStyle = (selected: boolean) => ({
  fontSize: 14,
  textAlign: 'left' as const,
  color: selected ? '#6366f1' : '#94a3b8',
});

export const frameTitleCss = `
  [data-frame-title-text] .board-text-content,
  [data-frame-title-text] .board-text-content > * {
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    text-align: left !important;
  }
`;
const placeholder = createInlineText('Frame');

/** Match the title's local text box and full SVG transform, outside SVG clips. */
export function FrameTitleEditor({
  cellId,
  svg,
  ...editor
}: ComponentProps<typeof FrameTextEditor> & {
  cellId: string;
  svg: SVGSVGElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFrameWheelPortal(ref);
  useLayoutEffect(() => {
    let frame = 0;
    const position = () => {
      const title = Array.from(
        svg?.querySelectorAll('[data-frame-title-id]') ?? [],
      ).find((node) => node.getAttribute('data-frame-title-id') === cellId);
      const anchor = title?.querySelector('foreignObject');
      const matrix = anchor?.getScreenCTM();
      const node = ref.current;
      if (anchor && matrix && node) {
        const placed = matrix.translate(
          anchor.x.baseVal.value,
          anchor.y.baseVal.value,
        );
        const styles = {
          'font-family': getComputedStyle(anchor).fontFamily,
          width: `${anchor.width.baseVal.value}px`,
          height: `${anchor.height.baseVal.value}px`,
          transform: `matrix(${placed.a},${placed.b},${placed.c},${placed.d},${placed.e},${placed.f})`,
          visibility: 'visible',
        };
        for (const [key, value] of Object.entries(styles))
          if (node.style.getPropertyValue(key) !== value)
            node.style.setProperty(key, value);
      }
      frame = requestAnimationFrame(position);
    };
    position();
    return () => cancelAnimationFrame(frame);
  }, [cellId, svg]);
  return createPortal(
    <div
      ref={ref}
      data-frame-title-editor={cellId}
      data-frame-title-text
      data-frame-export-exclude
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        transformOrigin: '0 0',
        boxSizing: 'border-box',
        zIndex: 50,
        visibility: 'hidden',
      }}
    >
      <FrameTextEditor {...editor} mode="inline" />
      {!editor.text.plainText && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <FrameRichText text={placeholder} style={editor.style} />
        </div>
      )}
    </div>,
    document.body,
  );
}
