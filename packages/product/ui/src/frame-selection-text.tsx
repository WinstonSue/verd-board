import {
  appearanceCells,
  isNodeCell,
  isFrameCell,
  isMindNodeKind,
  type CellStore,
  type CellOperation,
} from '@sue/board-core';
import {
  Alignment,
  createInlineText,
  formatBoardText,
  isBoardTextDocument,
  type BoardTextDocument,
  type BoardTextNode,
  textWithDefaultAlignment,
} from '@sue/board-common';
import { useState } from 'react';
import { Bold, Italic, Underline, Strikethrough } from 'lucide-react';
import { useI18n } from './i18n';

export interface SelectionTextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  fontSize?: string;
  align?: Alignment;
  href?: string | null;
}
const marks = ['bold', 'italic', 'underline', 'strike'] as const;

/** Preserve links, paragraph structure and unmodified marks when formatting whole labels. */
export function formatSelectionText(
  text: BoardTextDocument,
  patch: SelectionTextStyle,
): BoardTextDocument {
  return formatBoardText(text, {
    bold: patch.bold,
    italic: patch.italic,
    underline: patch.underline,
    strike: patch.strike,
    color: patch.color,
    fontSize: patch.fontSize,
    align: patch.align,
    href: patch.href,
  });
}
const textCells = (store: CellStore, ids: readonly string[]) =>
  appearanceCells(store, ids).filter((cell) =>
    isNodeCell(cell)
      ? !isFrameCell(cell) &&
        (cell.content?.text !== undefined || cell.content?.label !== undefined)
      : !!cell.labels?.length,
  );
export const hasSelectionText = (store: CellStore, ids: readonly string[]) =>
  textCells(store, ids).length > 0;
const documents = (store: CellStore, ids: readonly string[]) =>
  textCells(store, ids).flatMap((cell) =>
    isNodeCell(cell)
      ? [
          textWithDefaultAlignment(
            isBoardTextDocument(cell.content?.text)
              ? cell.content.text
              : createInlineText(cell.content?.label ?? ''),
            isMindNodeKind(cell.kind) ? Alignment.left : Alignment.center,
          ),
        ]
      : (cell.labels ?? []).map((label) =>
          isBoardTextDocument(label.richText)
            ? label.richText
            : createInlineText(label.text),
        ),
  );

const effectiveAlignments = (texts: BoardTextDocument[]): Alignment[] =>
  texts.flatMap((text) => {
    const result: Alignment[] = [];
    const visit = (node: BoardTextNode) => {
      if (['paragraph', 'heading'].includes(node.type)) {
        const value = node.attrs?.['textAlign'];
        result.push(
          Object.values(Alignment).includes(value as Alignment)
            ? (value as Alignment)
            : (text.align ?? Alignment.center),
        );
      }
      node.content?.forEach(visit);
    };
    visit(text.content);
    return result.length ? result : [text.align ?? Alignment.center];
  });

export function updateSelectionText(
  store: CellStore,
  ids: readonly string[],
  patch: SelectionTextStyle,
): CellOperation[] {
  return textCells(store, ids).map((cell) => ({
    type: 'replace_cell',
    cell: isNodeCell(cell)
      ? {
          ...cell,
          content: {
            ...cell.content,
            text: formatSelectionText(
              isBoardTextDocument(cell.content?.text)
                ? cell.content.text
                : createInlineText(cell.content?.label ?? ''),
              patch,
            ),
          },
        }
      : {
          ...cell,
          labels: cell.labels?.map((label) => ({
            ...label,
            richText: formatSelectionText(
              isBoardTextDocument(label.richText)
                ? label.richText
                : createInlineText(label.text),
              patch,
            ),
          })),
        },
  }));
}

export function FrameSelectionText({
  store,
  ids,
  dispatch,
  getStore,
  disabled = false,
}: {
  store: CellStore;
  ids: readonly string[];
  dispatch(operations: CellOperation[]): void;
  getStore?(): CellStore | undefined;
  disabled?: boolean;
}) {
  const { language } = useI18n();
  const [link, setLink] = useState('');
  const texts = documents(store, ids);
  if (!texts.length) return null;
  const alignments = effectiveAlignments(texts);
  const leaves = (node: BoardTextNode): BoardTextNode[] =>
    node.type === 'text' ? [node] : (node.content ?? []).flatMap(leaves);
  const nodes = texts.flatMap((text) => leaves(text.content));
  const all = (mark: string) =>
    nodes.length > 0 &&
    nodes.every((node) => node.marks?.some((entry) => entry.type === mark));
  const common = (key: 'fontSize' | 'color') => {
    if (!nodes.length) return key === 'fontSize' ? '16px' : '#0f172a';
    const values = nodes.map(
      (node) =>
        node.marks?.find((mark) => mark.type === 'textStyle')?.attrs?.[key] ??
        (key === 'fontSize' ? '16px' : '#0f172a'),
    );
    return values.every((value) => value === values[0])
      ? String(values[0] ?? '')
      : '';
  };
  const change = (patch: SelectionTextStyle) => {
    const latest = getStore ? getStore() : store;
    if (!disabled && latest) dispatch(updateSelectionText(latest, ids, patch));
  };
  return (
    <>
      <div
        className="frame-property-icons"
        role="toolbar"
        aria-label="Selection text formatting"
      >
        {marks.map((mark, at) => (
          <button
            key={mark}
            aria-label={`Selection ${mark}`}
            title={
              language === 'zh'
                ? ['粗体', '斜体', '下划线', '删除线'][at]
                : ['Bold', 'Italic', 'Underline', 'Strikethrough'][at]
            }
            aria-pressed={all(mark)}
            onClick={() => change({ [mark]: !all(mark) })}
          >
            {(() => {
              const Icon = [Bold, Italic, Underline, Strikethrough][at];
              return <Icon size={16} aria-hidden="true" />;
            })()}
          </button>
        ))}
      </div>
      <label>
        {language === 'zh' ? '字号' : 'Font size'}
        <select
          aria-label="Selection font size"
          value={common('fontSize')}
          onChange={(event) => change({ fontSize: event.target.value })}
        >
          <option value="" disabled>
            {language === 'zh' ? '混合值' : 'Mixed values'}
          </option>
          {[12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map((size) => (
            <option key={size} value={`${size}px`}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <label>
        {language === 'zh' ? '文字颜色' : 'Text color'}
        <input
          aria-label="Selection text color"
          type="color"
          data-mixed={common('color') === '' || undefined}
          title={
            common('color') === ''
              ? language === 'zh'
                ? '混合值'
                : 'Mixed values'
              : undefined
          }
          aria-description={
            common('color') === ''
              ? language === 'zh'
                ? '混合值'
                : 'Mixed values'
              : undefined
          }
          value={
            /^#[0-9a-f]{6}$/i.test(common('color'))
              ? common('color')
              : '#0f172a'
          }
          onChange={(event) => change({ color: event.target.value })}
        />
      </label>
      <label>
        {language === 'zh' ? '文字对齐' : 'Text alignment'}
        <select
          aria-label="Selection text alignment"
          value={
            alignments.every((alignment) => alignment === alignments[0])
              ? alignments[0]
              : ''
          }
          onChange={(event) =>
            change({ align: event.target.value as Alignment })
          }
        >
          <option value="" disabled>
            {language === 'zh' ? '混合值' : 'Mixed values'}
          </option>
          <option value="left">{language === 'zh' ? '左' : 'Left'}</option>
          <option value="center">{language === 'zh' ? '中' : 'Center'}</option>
          <option value="right">{language === 'zh' ? '右' : 'Right'}</option>
        </select>
      </label>
      <label>
        {language === 'zh' ? '链接' : 'Link'}
        <input
          aria-label="Selection link URL"
          type="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
        />
      </label>
      <div>
        <button
          aria-label="Apply selection link"
          onClick={() => change({ href: link || null })}
        >
          {language === 'zh' ? '设置链接' : 'Apply link'}
        </button>
        <button
          aria-label="Remove selection link"
          onClick={() => change({ href: null })}
        >
          {language === 'zh' ? '移除链接' : 'Remove link'}
        </button>
      </div>
    </>
  );
}
