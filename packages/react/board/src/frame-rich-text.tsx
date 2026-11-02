import { createContext, useContext, memo, type CSSProperties } from 'react';
import type { FrameLinkHost } from './frame-view-projection';
import { type BoardTextDocument, type Alignment } from '@sue/board-common';
import {
  useRichTextLinks,
  type RichTextLinkOptions,
  TextPreview,
} from '@sue/board-react-text';

export const FrameRichTextPreviewContext = createContext(false);
export const FrameRichTextLinkContext = createContext<
  FrameLinkHost | undefined
>(undefined);

export const FrameRichTextLinkPolicyContext =
  createContext<RichTextLinkOptions>({});

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
    const links = useContext(FrameRichTextLinkContext);
    const policy = useContext(FrameRichTextLinkPolicyContext);
    const events = useRichTextLinks({
      ...policy,
      blockPointer: true,
      onOpenLink:
        !preview && links
          ? (href) => {
              void links.openLink(href);
            }
          : undefined,
    });
    return (
      <div
        data-frame-rich-text
        className="board-text-layout"
        {...events}
        style={{
          pointerEvents: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
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
