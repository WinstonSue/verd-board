import { createContext, useContext, memo, type CSSProperties } from 'react';
import { type BoardTextDocument, type Alignment } from '@sue/board-common';
import { TextPreview } from '@sue/board-react-text';

export const FrameRichTextPreviewContext = createContext(false);

/** Static rich text shares its content schema and typography with the editor. */
export const FrameRichText = memo(
  function FrameRichText({
    text,
    style,
    defaultAlign,
  }: {
    text: BoardTextDocument;
    style?: CSSProperties;
    defaultAlign?: Alignment;
  }) {
    const preview = useContext(FrameRichTextPreviewContext);
    return (
      <div
        data-frame-rich-text
        className="board-text-layout"
        style={{
          pointerEvents: 'none',
          textAlign: text.align ?? defaultAlign ?? 'center',
          ...style,
        }}
      >
        <div className="board-text-body">
          <TextPreview text={text} preview={preview} />
        </div>
      </div>
    );
  },
  (previous, next) =>
    previous.text === next.text &&
    previous.defaultAlign === next.defaultAlign &&
    Object.keys({ ...previous.style, ...next.style }).every(
      (key) =>
        previous.style?.[key as keyof CSSProperties] ===
        next.style?.[key as keyof CSSProperties],
    ),
);
