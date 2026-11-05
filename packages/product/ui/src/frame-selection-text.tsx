import {
  FrameSettingsControl,
  FrameColorInput,
  useFrameTheme,
  type FrameCanvasController,
} from '@sue/board-react';
import {
  Alignment,
  createInlineText,
  formatBoardText,
  boardTextColor,
  isBoardTextDocument,
  textWithDefaultAlignment,
  type BoardTextDocument,
  type BoardTextNode,
} from '@sue/board-common';
import {
  appearanceCells,
  isFrameCell,
  isNodeCell,
  readableThemeText,
  type CellOperation,
  type CellStore,
} from '@sue/board-core';
import { isMindNodeKind } from '@sue/board-mind';
import { Bold, Italic, Strikethrough, Underline } from 'lucide-react';
import { useContext, useRef, useState } from 'react';
import { LinkEditorHost } from '@sue/board-react-text';
import { useI18n } from './i18n';

export interface SelectionTextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string | null;
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
  controller,
}: {
  store: CellStore;
  ids: readonly string[];
  dispatch(
    operations: CellOperation[],
  ): void | Promise<{ status: string; message?: string } | undefined>;
  getStore?(): CellStore | undefined;
  disabled?: boolean;
  controller?: FrameCanvasController | null;
}) {
  const { language } = useI18n();
  const theme = useFrameTheme();
  const linkEditor = useContext(LinkEditorHost);
  const [link, setLink] = useState('');
  const latest = useRef({ ids, getStore, store, disabled, controller });
  latest.current = { ids, getStore, store, disabled, controller };
  const texts = documents(store, ids);
  const owners = textCells(store, ids).flatMap<
    ReturnType<typeof textCells>[number]
  >((cell) =>
    isNodeCell(cell) ? [cell] : (cell.labels ?? []).map(() => cell),
  );
  if (!texts.length) return null;
  const alignments = effectiveAlignments(texts);
  const leaves = (node: BoardTextNode): BoardTextNode[] =>
    node.type === 'text' ? [node] : (node.content ?? []).flatMap(leaves);
  const nodes = texts.flatMap((text) => leaves(text.content));
  const all = (mark: string) =>
    nodes.length > 0 &&
    nodes.every((node) => node.marks?.some((entry) => entry.type === mark));
  const editLink = (trigger: HTMLButtonElement) => {
    if (!linkEditor || disabled) return;
    const captured = [...ids];
    const initial = getStore ? getStore() : store;
    if (!initial) return;
    const signature = (current: CellStore) =>
      JSON.stringify(
        textCells(current, captured).map((cell) => [
          cell.id,
          isNodeCell(cell) ? cell.content : cell.labels,
        ]),
      );
    const original = signature(initial);
    const hrefs = new Set(
      nodes.map((node) => {
        const href = node.marks?.find((mark) => mark.type === 'link')?.attrs?.[
          'href'
        ];
        return typeof href === 'string' ? href : undefined;
      }),
    );
    const currentStore = () => {
      const live = latest.current;
      if (
        !trigger.isConnected ||
        live.disabled ||
        live.controller?.runtime !== controller?.runtime ||
        live.ids.length !== captured.length ||
        !captured.every((id) => live.ids.includes(id))
      )
        return;
      const next = live.getStore ? live.getStore() : live.store;
      return next &&
        next.rootId === initial.rootId &&
        signature(next) === original
        ? next
        : undefined;
    };
    linkEditor({
      sourceFileId: controller?.runtime.mountedRootId ?? store.rootId,
      href: hrefs.size === 1 ? hrefs.values().next().value : undefined,
      mixed: hrefs.size > 1,
      canRemove: [...hrefs].some(Boolean),
      isCurrent: () => !!currentStore(),
      finish: (reason) => {
        if (reason !== 'invalidated' && trigger.isConnected) trigger.focus();
      },
      async commit(href, _label, signal) {
        const next = currentStore();
        if (signal?.aborted || !next)
          return { status: 'cancelled', code: 'stale-context' };
        const receipt = await dispatch(
          updateSelectionText(next, captured, { href }),
        );
        return receipt?.status === 'rejected'
          ? {
              status: 'rejected',
              code: 'edit-rejected',
              message: receipt.message,
            }
          : { status: 'completed' };
      },
    });
  };
  const common = (key: 'fontSize' | 'color') => {
    if (!nodes.length) return key === 'fontSize' ? '16px' : '#0f172a';
    const values = texts.flatMap((text, at) => {
      const owner = owners[at];
      const appearance = controller?.resolveAppearance?.(owner.id);
      const fill = appearance?.fill;
      const defaultColor = theme.adaptive
        ? readableThemeText(
            !isNodeCell(owner) ||
              !fill ||
              fill === 'none' ||
              fill === 'transparent'
              ? theme.background
              : fill,
            appearance?.textColor ?? theme.text,
          )
        : '#0f172a';
      return leaves(text.content).map((node) => {
        const attrs = node.marks?.find(
          (mark) => mark.type === 'textStyle',
        )?.attrs;
        return key === 'color'
          ? (boardTextColor(attrs, theme.adaptive) ?? defaultColor)
          : (attrs?.['fontSize'] ?? '16px');
      });
    });
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
        <FrameSettingsControl
          field={{
            key: 'Selection font size',
            editor: 'select',
            props: {
              'aria-label': 'Selection font size',
              children: (
                <>
                  <option value="" disabled>
                    {language === 'zh' ? '混合值' : 'Mixed values'}
                  </option>
                  {[12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map((size) => (
                    <option key={size} value={`${size}px`}>
                      {size}
                    </option>
                  ))}
                </>
              ),
            },
          }}
          value={common('fontSize')}
          onCommit={(value) => change({ fontSize: value })}
        />
      </label>
      <label>
        {language === 'zh' ? '文字颜色' : 'Text color'}
        <FrameColorInput
          aria-label="Selection text color"
          disabled={disabled}
          data-mixed={common('color') === '' || undefined}
          title={
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
          onValue={(value) => change({ color: value })}
        />
        <button
          type="button"
          aria-label="Reset selection text color to theme"
          disabled={disabled}
          onClick={() => change({ color: null })}
        >
          {language === 'zh' ? '主题颜色' : 'Theme color'}
        </button>
      </label>
      <label>
        {language === 'zh' ? '文字对齐' : 'Text alignment'}
        <FrameSettingsControl
          field={{
            key: 'Selection text alignment',
            editor: 'select',
            props: {
              'aria-label': 'Selection text alignment',
              children: (
                <>
                  <option value="" disabled>
                    {language === 'zh' ? '混合值' : 'Mixed values'}
                  </option>
                  <option value="left">
                    {language === 'zh' ? '左' : 'Left'}
                  </option>
                  <option value="center">
                    {language === 'zh' ? '中' : 'Center'}
                  </option>
                  <option value="right">
                    {language === 'zh' ? '右' : 'Right'}
                  </option>
                </>
              ),
            },
          }}
          value={
            alignments.every((alignment) => alignment === alignments[0])
              ? alignments[0]
              : ''
          }
          onCommit={(value) => change({ align: value as Alignment })}
        />
      </label>
      {linkEditor ? (
        <button
          type="button"
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={(event) => editLink(event.currentTarget)}
        >
          {language === 'zh' ? '编辑链接' : 'Edit link'}
        </button>
      ) : (
        <>
          <label>
            {language === 'zh' ? '链接' : 'Link'}
            <FrameSettingsControl
              field={{
                key: 'Selection link URL',
                editor: 'input',
                props: { 'aria-label': 'Selection link URL', type: 'url' },
              }}
              value={link}
              onCommit={(value) => setLink(value)}
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
      )}
    </>
  );
}
