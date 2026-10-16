import type { NodeCell, MindNodeData } from '@sue/board-core';
import {
  createInlineText,
  isBoardTextDocument,
  type BoardTextDocument,
  type BoardTextNode,
} from '@sue/board-common';

const labelDocuments = new WeakMap<object, BoardTextDocument>();
const emojiDocuments = new WeakMap<object, BoardTextDocument>();
const cachedInline = (
  cache: WeakMap<object, BoardTextDocument>,
  key: object,
  plain: string,
) => {
  let text = cache.get(key);
  if (!text || text.plainText !== plain) {
    text = createInlineText(plain);
    cache.set(key, text);
  }
  return text;
};
const outlineKind = (cell: NodeCell) =>
  typeof cell.geometry.outline === 'object'
    ? cell.geometry.outline.kind
    : cell.geometry.outline;

/** The default note font size; explicit marks can only grow it. */
export const MIND_NOTE_FONT_SIZE = 13;
export const DEFAULT_MIND_MAX_WIDTH = 240;
export const MIN_MIND_MAX_WIDTH = 80;
export const MAX_MIND_MAX_WIDTH = 2000;
export const validMindMaxWidth = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= MIN_MIND_MAX_WIDTH &&
  value <= MAX_MIND_MAX_WIDTH;
export interface MindMetricsOptions {
  maxNodeWidth?: number;
  /** The already laid-out width used by renderers for media/text partitioning. */
  width?: number;
  measureText?: (
    text: BoardTextDocument,
    width: number,
    fontSize: number,
  ) => { width: number; height: number } | undefined;
}
export const mindCellMetrics = (
  cell: NodeCell,
  options: MindMetricsOptions = {},
) => {
  const data = cell.data as MindNodeData | undefined;
  const text = isBoardTextDocument(cell.content?.text)
    ? cell.content.text
    : cachedInline(
        labelDocuments,
        cell.content ?? cell,
        cell.content?.label ?? '',
      );
  const sizes = (node: BoardTextNode): number[] => [
    ...(node.marks ?? []).flatMap((mark) => {
      const size = parseFloat(String(mark.attrs?.['fontSize'] ?? ''));
      return Number.isFinite(size) ? [size] : [];
    }),
    ...(node.content ?? []).flatMap(sizes),
  ];
  const fontSize = Math.max(
    (cell.data as { fontSize?: number })?.fontSize ??
      (cell.kind === 'mind-root' ? 20 : 16),
    ...(isBoardTextDocument(text) ? sizes(text.content) : []),
  );
  const plain = isBoardTextDocument(text)
    ? text.plainText
    : (cell.content?.label ?? '');
  const textWidth = Math.max(
    40,
    ...plain
      .split('\n')
      .map((line) => Math.ceil(line.length * fontSize * 0.6) + 24),
  );
  const naturalText = isBoardTextDocument(text)
    ? options.measureText?.(
        text,
        Infinity,
        (cell.data as { fontSize?: number })?.fontSize ??
          (cell.kind === 'mind-root' ? 20 : 16),
      )
    : undefined;
  const naturalImage = data?.image?.width ?? 0;
  const emojiText = data?.emojis?.length
    ? cachedInline(
        emojiDocuments,
        data,
        data.emojis.map((emoji) => emoji.name).join(' '),
      )
    : undefined;
  const emojiWidth = emojiText
    ? (options.measureText?.(emojiText, Infinity, 18)?.width ??
        [...emojiText.plainText].length * 18) + 16
    : 0;
  const noteDocument = isBoardTextDocument(data?.note)
    ? (data?.note as BoardTextDocument)
    : undefined;
  const noteFontSize = noteDocument
    ? Math.max(MIND_NOTE_FONT_SIZE, ...sizes(noteDocument.content))
    : MIND_NOTE_FONT_SIZE;
  const naturalNote =
    noteDocument && !data?.noteCollapsed
      ? options.measureText?.(noteDocument, Infinity, noteFontSize)
      : undefined;
  const measured = Math.max(
    naturalText ? naturalText.width + 16 : textWidth,
    naturalImage ? naturalImage + 16 : 0,
    emojiWidth,
    naturalNote ? naturalNote.width + 16 : 0,
  );
  const maxWidth = validMindMaxWidth(options.maxNodeWidth)
    ? options.maxNodeWidth
    : DEFAULT_MIND_MAX_WIDTH;
  const width = options.width ?? Math.min(maxWidth, Math.max(40, measured));
  const measuredText = isBoardTextDocument(text)
    ? options.measureText?.(
        text,
        width - 16,
        (cell.data as { fontSize?: number })?.fontSize ??
          (cell.kind === 'mind-root' ? 20 : 16),
      )
    : undefined;
  const imageWidth = data?.image
    ? Math.min(Math.max(1, width - 16), data.image.width)
    : 0;
  const imageHeight =
    data?.image && data.image.width > 0
      ? (imageWidth * data.image.height) / data.image.width + 8
      : 0;
  const note = data?.note as { plainText?: string } | undefined;
  const measuredNote = noteDocument
    ? options.measureText?.(noteDocument, width - 16, noteFontSize)
    : undefined;
  const noteHeight =
    note && !data?.noteCollapsed
      ? Math.max(
          48,
          measuredNote
            ? measuredNote.height + 8
            : (note?.plainText ?? '')
                .split('\n')
                .reduce(
                  (total, line) =>
                    total +
                    Math.max(
                      1,
                      Math.ceil(
                        line.length /
                          Math.max(1, (width - 16) / (noteFontSize * 0.62)),
                      ),
                    ),
                  0,
                ) *
                Math.ceil(noteFontSize * 1.5) +
                16,
        )
      : 0;
  const measuredEmoji = emojiText
    ? options.measureText?.(emojiText, width - 16, 18)
    : undefined;
  const emojiHeight = emojiText
    ? Math.max(
        1,
        Math.round(
          (measuredEmoji?.height ??
            Math.max(
              1,
              Math.ceil((emojiWidth - 16) / Math.max(1, width - 16)),
            ) * 23.4) / 23.4,
        ),
      ) * 24
    : 0;
  const lines = plain
    .split('\n')
    .reduce(
      (count, line) =>
        count +
        Math.max(
          1,
          Math.ceil((line.length * fontSize * 0.6) / Math.max(1, width - 16)),
        ),
      0,
    );
  const topicHeight = Math.max(
    outlineKind(cell) === 'underline'
      ? 28
      : cell.kind === 'mind-root'
        ? 56
        : 40,
    measuredText
      ? measuredText.height + 8
      : Math.ceil(lines * fontSize * 1.3 + 8),
  );
  return {
    width,
    imageWidth,
    imageHeight,
    noteHeight,
    emojiHeight,
    topicHeight,
    height: imageHeight + topicHeight + noteHeight + emojiHeight,
  };
};
