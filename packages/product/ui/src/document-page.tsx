import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Code,
  Columns3,
  Download,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  ListOrdered,
  ListTree,
  Minus,
  Paintbrush,
  Redo2,
  RemoveFormatting,
  Replace,
  ReplaceAll,
  Rows3,
  Search,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Alignment } from '@sue/board-common';
import {
  DocumentEditor,
  type DocumentEditorChange,
  type DocumentEditorController,
  type DocumentHistoryAdapter,
  type DocumentSearchMatch,
  type DocumentSelection,
  type DocumentToolbarState,
} from '@sue/board-react-text';
import type { BoardTextDocument } from '@sue/board-common';
import './document-page.scss';

export type {
  DocumentEditorChange,
  DocumentEditorController,
  DocumentHistoryAdapter,
  DocumentSelection,
} from '@sue/board-react-text';

export type DocumentSaveState =
  'saved' | 'unsaved' | 'saving' | 'error' | 'conflicted';

export interface DocumentPageProps {
  value: BoardTextDocument;
  title: string;
  readonly?: boolean;
  locale?: 'zh' | 'en';
  saveState?: DocumentSaveState;
  history?: DocumentHistoryAdapter;
  restore?: { revision: number; selection?: DocumentSelection };
  /** Focuses the title once — used right after creating a document. */
  autoFocusTitle?: boolean;
  onChange(change: DocumentEditorChange): void;
  onTitleCommit(title: string): void;
  /** Exports the document file in a supported format. */
  onExport?(format: 'json' | 'markdown'): void;
  /** Resolves a picked image file to an insertable src; null cancels. */
  onInsertImage?(file: File): Promise<string | null>;
  onReady?(controller: DocumentEditorController | null): void;
}

const labels = {
  zh: {
    untitled: '未命名文档',
    titlePlaceholder: '文档标题',
    paragraph: '正文',
    heading: '标题',
    bold: '加粗',
    italic: '斜体',
    underline: '下划线',
    strike: '删除线',
    inlineCode: '行内代码',
    fontSize: '字号',
    textColor: '文字颜色',
    highlight: '高亮',
    alignLeft: '左对齐',
    alignCenter: '居中',
    alignRight: '右对齐',
    bulletList: '无序列表',
    orderedList: '有序列表',
    blockquote: '引用',
    codeBlock: '代码块',
    horizontalRule: '分隔线',
    link: '链接',
    linkPlaceholder: 'https://…',
    linkApply: '确定',
    linkRemove: '移除链接',
    image: '图片',
    table: '插入表格',
    clearFormat: '清除格式',
    undo: '撤销',
    redo: '重做',
    find: '查找',
    replace: '替换',
    findPlaceholder: '查找…',
    replacePlaceholder: '替换为…',
    matchCase: '区分大小写',
    prevMatch: '上一个',
    nextMatch: '下一个',
    replaceOne: '替换',
    replaceAll: '全部替换',
    close: '关闭',
    toc: '目录',
    tocEmpty: '暂无标题',
    untitledHeading: '未命名标题',
    export: '导出',
    exportJson: 'VerdBoard 文档 (.json)',
    exportMarkdown: 'Markdown (.md)',
    chars: '字符',
    addRow: '下方插入行',
    addRowBefore: '上方插入行',
    addCol: '右侧插入列',
    addColBefore: '左侧插入列',
    delRow: '删除行',
    delCol: '删除列',
    delTable: '删除表格',
    headerRow: '表头行',
    headerCol: '表头列',
    save: {
      saved: '已保存',
      unsaved: '未保存',
      saving: '保存中…',
      error: '保存失败',
      conflicted: '存在冲突',
    } as Record<DocumentSaveState, string>,
    imageTooLarge: '图片超过 10 MiB 上限',
    imageReadFailed: '图片读取失败',
  },
  en: {
    untitled: 'Untitled document',
    titlePlaceholder: 'Document title',
    paragraph: 'Text',
    heading: 'Heading',
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    strike: 'Strikethrough',
    inlineCode: 'Inline code',
    fontSize: 'Font size',
    textColor: 'Text color',
    highlight: 'Highlight',
    alignLeft: 'Align left',
    alignCenter: 'Align center',
    alignRight: 'Align right',
    bulletList: 'Bullet list',
    orderedList: 'Numbered list',
    blockquote: 'Quote',
    codeBlock: 'Code block',
    horizontalRule: 'Divider',
    link: 'Link',
    linkPlaceholder: 'https://…',
    linkApply: 'Apply',
    linkRemove: 'Remove link',
    image: 'Image',
    table: 'Insert table',
    clearFormat: 'Clear formatting',
    undo: 'Undo',
    redo: 'Redo',
    find: 'Find',
    replace: 'Replace',
    findPlaceholder: 'Find…',
    replacePlaceholder: 'Replace with…',
    matchCase: 'Match case',
    prevMatch: 'Previous',
    nextMatch: 'Next',
    replaceOne: 'Replace',
    replaceAll: 'Replace all',
    close: 'Close',
    toc: 'Contents',
    tocEmpty: 'No headings yet',
    untitledHeading: 'Untitled heading',
    export: 'Export',
    exportJson: 'VerdBoard document (.json)',
    exportMarkdown: 'Markdown (.md)',
    chars: 'characters',
    addRow: 'Insert row below',
    addRowBefore: 'Insert row above',
    addCol: 'Insert column right',
    addColBefore: 'Insert column left',
    delRow: 'Delete row',
    delCol: 'Delete column',
    delTable: 'Delete table',
    headerRow: 'Header row',
    headerCol: 'Header column',
    save: {
      saved: 'Saved',
      unsaved: 'Unsaved',
      saving: 'Saving…',
      error: 'Save failed',
      conflicted: 'Conflict',
    } as Record<DocumentSaveState, string>,
    imageTooLarge: 'Image exceeds the 10 MiB limit',
    imageReadFailed: 'Failed to read the image',
  },
};

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32];
const IMAGE_LIMIT = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function ToolbarButton({
  title,
  pressed,
  disabled,
  onClick,
  icon: Icon,
}: {
  title: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick(): void;
  icon: LucideIcon;
}) {
  return (
    <button
      type="button"
      className={`doc-toolbar__btn${pressed ? ' pressed' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled}
      // Keep the editor selection — commands act on it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon size={16} />
    </button>
  );
}

export function DocumentPage({
  value,
  title,
  readonly = false,
  locale = 'zh',
  saveState = 'saved',
  history,
  restore,
  autoFocusTitle = false,
  onChange,
  onTitleCommit,
  onExport,
  onInsertImage,
  onReady,
}: DocumentPageProps) {
  const t = labels[locale];
  const [controller, setController] = useState<DocumentEditorController | null>(
    null,
  );
  const [toolbar, setToolbar] = useState<DocumentToolbarState | null>(null);
  const [tocOpen, setTocOpen] = useState(true);
  const [headings, setHeadings] = useState<
    { level: number; text: string; pos: number }[]
  >([]);
  const [findOpen, setFindOpen] = useState<false | 'find' | 'replace'>(false);
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [matches, setMatches] = useState<DocumentSearchMatch[]>([]);
  const [matchIndex, setMatchIndex] = useState(-1);
  const [replacement, setReplacement] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [charCount, setCharCount] = useState(0);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<DocumentEditorController | null>(null);
  controllerRef.current = controller;

  const refreshToolbar = useCallback(() => {
    const ctl = controllerRef.current;
    if (!ctl) return;
    setToolbar(ctl.getToolbarState());
    setHeadings(ctl.getHeadings());
    setCharCount(ctl.getCharacterCount());
  }, []);

  useEffect(() => {
    if (!controller) return;
    refreshToolbar();
    return controller.subscribe(refreshToolbar);
  }, [controller, refreshToolbar]);

  const ready = useCallback(
    (ctl: DocumentEditorController | null) => {
      setController(ctl);
      onReady?.(ctl);
    },
    [onReady],
  );

  // ------- title -------
  useEffect(() => {
    if (autoFocusTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [autoFocusTitle]);

  const commitTitle = () => {
    if (titleDraft === null) return;
    const next = titleDraft.trim();
    setTitleDraft(null);
    if (next && next !== title) onTitleCommit(next);
  };

  // ------- find / replace -------
  const runFind = useCallback((value_: string, sensitive: boolean) => {
    const ctl = controllerRef.current;
    if (!ctl || !value_) {
      setMatches([]);
      setMatchIndex(-1);
      return;
    }
    const found = ctl.find(value_, { caseSensitive: sensitive });
    setMatches(found);
    const nextIndex = found.length ? 0 : -1;
    setMatchIndex(nextIndex);
    if (nextIndex >= 0) ctl.selectMatch(found[nextIndex]);
  }, []);

  const openFind = (mode: 'find' | 'replace') => {
    setFindOpen(mode);
    requestAnimationFrame(() => findInputRef.current?.select());
  };

  const stepMatch = (delta: number) => {
    const ctl = controllerRef.current;
    if (!ctl || !matches.length) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    ctl.selectMatch(matches[next]);
  };

  const replaceCurrent = () => {
    const ctl = controllerRef.current;
    if (!ctl || matchIndex < 0 || !matches[matchIndex]) return;
    ctl.replace(matches[matchIndex], replacement);
    runFind(query, matchCase);
  };

  const replaceEvery = () => {
    const ctl = controllerRef.current;
    if (!ctl || !query) return;
    ctl.replaceAll(query, replacement, { caseSensitive: matchCase });
    runFind(query, matchCase);
  };

  const closeFind = () => {
    setFindOpen(false);
    controllerRef.current?.focus();
  };

  // ------- link / image -------
  const applyLink = () => {
    const href = linkDraft.trim();
    if (href) controllerRef.current?.setLink(href);
    setLinkOpen(false);
  };

  const pickImage = async (file: File) => {
    if (!IMAGE_TYPES.has(file.type)) return null;
    if (file.size > IMAGE_LIMIT) {
      setNotice(t.imageTooLarge);
      return null;
    }
    const src = onInsertImage
      ? await onInsertImage(file)
      : await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
    if (!src) setNotice(t.imageReadFailed);
    return src;
  };

  const pageKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openFind('find');
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      if (!readonly) openFind('replace');
      return;
    }
    if (event.key === 'Escape' && findOpen) {
      closeFind();
      return;
    }
  };

  const canUndo = history ? history.canUndo() : (toolbar?.editable ?? false);
  const canRedo = history ? history.canRedo() : false;
  const blockValue =
    toolbar?.block === 'heading'
      ? `h${toolbar.headingLevel ?? 1}`
      : (toolbar?.block ?? 'paragraph');

  return (
    <div className="document-page" onKeyDown={pageKeyDown}>
      <header className="document-page__header">
        <input
          ref={titleInputRef}
          className="document-page__title"
          value={titleDraft ?? title}
          placeholder={t.titlePlaceholder}
          disabled={readonly}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitTitle();
              controllerRef.current?.focus('start');
            } else if (event.key === 'Escape') {
              setTitleDraft(null);
            }
          }}
        />
        {!readonly && (
          <div className="doc-toolbar" role="toolbar" aria-label="document">
            <select
              className="doc-toolbar__select"
              title={t.paragraph}
              value={blockValue}
              onMouseDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const ctl = controllerRef.current;
                if (!ctl) return;
                const v = event.target.value;
                if (v === 'paragraph') ctl.setParagraph();
                else if (v.startsWith('h'))
                  ctl.setHeading(Number(v.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6);
                else if (v === 'blockquote') ctl.toggleBlockquote();
                else if (v === 'codeBlock') ctl.toggleCodeBlock();
                else if (v === 'bulletList') ctl.toggleBulletList();
                else if (v === 'orderedList') ctl.toggleOrderedList();
              }}
            >
              <option value="paragraph">{t.paragraph}</option>
              {[1, 2, 3, 4, 5, 6].map((level) => (
                <option key={level} value={`h${level}`}>
                  {t.heading} {level}
                </option>
              ))}
              <option value="bulletList">{t.bulletList}</option>
              <option value="orderedList">{t.orderedList}</option>
              <option value="blockquote">{t.blockquote}</option>
              <option value="codeBlock">{t.codeBlock}</option>
            </select>
            <span className="doc-toolbar__sep" />
            <ToolbarButton
              title={t.bold}
              pressed={!!toolbar?.marks.bold}
              onClick={() => controllerRef.current?.toggleMark('bold')}
              icon={Bold}
            />
            <ToolbarButton
              title={t.italic}
              pressed={!!toolbar?.marks.italic}
              onClick={() => controllerRef.current?.toggleMark('italic')}
              icon={Italic}
            />
            <ToolbarButton
              title={t.underline}
              pressed={!!toolbar?.marks.underline}
              onClick={() => controllerRef.current?.toggleMark('underline')}
              icon={UnderlineIcon}
            />
            <ToolbarButton
              title={t.strike}
              pressed={!!toolbar?.marks.strike}
              onClick={() => controllerRef.current?.toggleMark('strike')}
              icon={Strikethrough}
            />
            <ToolbarButton
              title={t.inlineCode}
              pressed={!!toolbar?.marks.code}
              onClick={() => controllerRef.current?.toggleMark('code')}
              icon={Code}
            />
            <span className="doc-toolbar__sep" />
            <select
              className="doc-toolbar__select doc-toolbar__select--size"
              title={t.fontSize}
              value={toolbar?.marks.fontSize ?? ''}
              onMouseDown={(event) => event.stopPropagation()}
              onChange={(event) =>
                controllerRef.current?.setFontSize(event.target.value || null)
              }
            >
              <option value="">{t.fontSize}</option>
              {FONT_SIZES.map((size) => (
                <option key={size} value={`${size}px`}>
                  {size}
                </option>
              ))}
            </select>
            <label
              className="doc-toolbar__btn doc-toolbar__color"
              title={t.textColor}
              style={{ color: toolbar?.marks.color ?? undefined }}
            >
              <Paintbrush size={16} />
              <input
                type="color"
                value={toolbar?.marks.color ?? '#111827'}
                onChange={(event) =>
                  controllerRef.current?.setTextColor(event.target.value)
                }
              />
            </label>
            <label
              className="doc-toolbar__btn doc-toolbar__color"
              title={t.highlight}
              style={{ color: toolbar?.marks.highlight ?? undefined }}
            >
              <Highlighter size={16} />
              <input
                type="color"
                value={toolbar?.marks.highlight ?? '#fef08a'}
                onChange={(event) =>
                  controllerRef.current?.setHighlight(event.target.value)
                }
              />
            </label>
            <span className="doc-toolbar__sep" />
            <ToolbarButton
              title={t.alignLeft}
              pressed={toolbar?.align === Alignment.left}
              onClick={() =>
                controllerRef.current?.setTextAlign(Alignment.left)
              }
              icon={AlignLeft}
            />
            <ToolbarButton
              title={t.alignCenter}
              pressed={toolbar?.align === Alignment.center}
              onClick={() =>
                controllerRef.current?.setTextAlign(Alignment.center)
              }
              icon={AlignCenter}
            />
            <ToolbarButton
              title={t.alignRight}
              pressed={toolbar?.align === Alignment.right}
              onClick={() =>
                controllerRef.current?.setTextAlign(Alignment.right)
              }
              icon={AlignRight}
            />
            <span className="doc-toolbar__sep" />
            <ToolbarButton
              title={t.link}
              pressed={!!toolbar?.link}
              onClick={() => {
                setLinkDraft(toolbar?.link ?? '');
                setLinkOpen((v) => !v);
              }}
              icon={LinkIcon}
            />
            <ToolbarButton
              title={t.image}
              onClick={() => imageInputRef.current?.click()}
              icon={ImageIcon}
            />
            <ToolbarButton
              title={t.table}
              onClick={() => controllerRef.current?.insertTable()}
              icon={TableIcon}
            />
            <ToolbarButton
              title={t.horizontalRule}
              onClick={() => controllerRef.current?.insertHorizontalRule()}
              icon={Minus}
            />
            <span className="doc-toolbar__sep" />
            <ToolbarButton
              title={t.clearFormat}
              onClick={() => controllerRef.current?.clearFormatting()}
              icon={RemoveFormatting}
            />
            <ToolbarButton
              title={t.undo}
              disabled={!canUndo}
              onClick={() => controllerRef.current?.undo()}
              icon={Undo2}
            />
            <ToolbarButton
              title={t.redo}
              disabled={!canRedo}
              onClick={() => controllerRef.current?.redo()}
              icon={Redo2}
            />
            <span className="doc-toolbar__sep" />
            <ToolbarButton
              title={`${t.find} (⌘F)`}
              pressed={!!findOpen}
              onClick={() => (findOpen ? closeFind() : openFind('find'))}
              icon={Search}
            />
            <ToolbarButton
              title={t.toc}
              pressed={tocOpen}
              onClick={() => setTocOpen((v) => !v)}
              icon={ListTree}
            />
            {onExport && (
              <span className="doc-export">
                <ToolbarButton
                  title={t.export}
                  pressed={exportOpen}
                  onClick={() => setExportOpen((open) => !open)}
                  icon={Download}
                />
                {exportOpen && (
                  <div className="doc-export__menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setExportOpen(false);
                        onExport('json');
                      }}
                    >
                      {t.exportJson}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setExportOpen(false);
                        onExport('markdown');
                      }}
                    >
                      {t.exportMarkdown}
                    </button>
                  </div>
                )}
              </span>
            )}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                const src = await pickImage(file);
                if (src) controllerRef.current?.insertImage({ src });
              }}
            />
          </div>
        )}
        {linkOpen && (
          <div className="doc-linkbar">
            <input
              ref={(node) => node?.focus()}
              value={linkDraft}
              placeholder={t.linkPlaceholder}
              onChange={(event) => setLinkDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyLink();
                if (event.key === 'Escape') setLinkOpen(false);
              }}
            />
            <button type="button" onClick={applyLink}>
              {t.linkApply}
            </button>
            {toolbar?.link && (
              <button
                type="button"
                onClick={() => {
                  controllerRef.current?.setLink(null);
                  setLinkOpen(false);
                }}
              >
                {t.linkRemove}
              </button>
            )}
          </div>
        )}
        {findOpen && (
          <div className="doc-findbar">
            <input
              ref={findInputRef}
              value={query}
              placeholder={t.findPlaceholder}
              onChange={(event) => {
                setQuery(event.target.value);
                runFind(event.target.value, matchCase);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') stepMatch(event.shiftKey ? -1 : 1);
                if (event.key === 'Escape') closeFind();
              }}
            />
            <label className="doc-findbar__case" title={t.matchCase}>
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(event) => {
                  setMatchCase(event.target.checked);
                  runFind(query, event.target.checked);
                }}
              />
              <CaseSensitive size={14} />
            </label>
            <span className="doc-findbar__count">
              {matches.length ? `${matchIndex + 1}/${matches.length}` : '0/0'}
            </span>
            <ToolbarButton
              title={t.prevMatch}
              disabled={!matches.length}
              onClick={() => stepMatch(-1)}
              icon={ChevronUp}
            />
            <ToolbarButton
              title={t.nextMatch}
              disabled={!matches.length}
              onClick={() => stepMatch(1)}
              icon={ChevronDown}
            />
            {findOpen === 'replace' && (
              <>
                <input
                  value={replacement}
                  placeholder={t.replacePlaceholder}
                  onChange={(event) => setReplacement(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') closeFind();
                  }}
                />
                <ToolbarButton
                  title={t.replaceOne}
                  disabled={matchIndex < 0}
                  onClick={replaceCurrent}
                  icon={Replace}
                />
                <ToolbarButton
                  title={t.replaceAll}
                  disabled={!matches.length}
                  onClick={replaceEvery}
                  icon={ReplaceAll}
                />
              </>
            )}
            {!readonly && findOpen === 'find' && (
              <button
                type="button"
                className="doc-findbar__mode"
                onClick={() => setFindOpen('replace')}
              >
                {t.replace}
              </button>
            )}
            <ToolbarButton title={t.close} onClick={closeFind} icon={X} />
          </div>
        )}
        {toolbar?.inTable && !readonly && (
          <div className="doc-tablebar">
            <ToolbarButton
              title={t.addRowBefore}
              disabled={!controller?.can('addTableRowBefore')}
              onClick={() => controllerRef.current?.addTableRow('before')}
              icon={Rows3}
            />
            <ToolbarButton
              title={t.addRow}
              disabled={!controller?.can('addTableRowAfter')}
              onClick={() => controllerRef.current?.addTableRow('after')}
              icon={Rows3}
            />
            <ToolbarButton
              title={t.addColBefore}
              disabled={!controller?.can('addTableColumnBefore')}
              onClick={() => controllerRef.current?.addTableColumn('before')}
              icon={Columns3}
            />
            <ToolbarButton
              title={t.addCol}
              disabled={!controller?.can('addTableColumnAfter')}
              onClick={() => controllerRef.current?.addTableColumn('after')}
              icon={Columns3}
            />
            <span className="doc-toolbar__sep" />
            <ToolbarButton
              title={t.delRow}
              disabled={!controller?.can('deleteTableRow')}
              onClick={() => controllerRef.current?.deleteTableRow()}
              icon={Rows3}
            />
            <ToolbarButton
              title={t.delCol}
              disabled={!controller?.can('deleteTableColumn')}
              onClick={() => controllerRef.current?.deleteTableColumn()}
              icon={Columns3}
            />
            <ToolbarButton
              title={t.headerRow}
              disabled={!controller?.can('toggleTableHeaderRow')}
              onClick={() => controllerRef.current?.toggleTableHeader('row')}
              icon={TableIcon}
            />
            <ToolbarButton
              title={t.headerCol}
              disabled={!controller?.can('toggleTableHeaderColumn')}
              onClick={() => controllerRef.current?.toggleTableHeader('column')}
              icon={TableIcon}
            />
            <span className="doc-toolbar__sep" />
            <ToolbarButton
              title={t.delTable}
              disabled={!controller?.can('deleteTable')}
              onClick={() => controllerRef.current?.deleteTable()}
              icon={Trash2}
            />
          </div>
        )}
      </header>
      <div className="document-page__body">
        {tocOpen && (
          <aside className="document-page__toc">
            <div className="document-page__toc-title">{t.toc}</div>
            {headings.length === 0 && (
              <div className="document-page__toc-empty">{t.tocEmpty}</div>
            )}
            {headings.map((item, index) => (
              <button
                key={`${item.pos}-${index}`}
                type="button"
                className="document-page__toc-item"
                style={{ paddingLeft: `${8 + (item.level - 1) * 14}px` }}
                title={item.text || t.untitledHeading}
                onClick={() => controllerRef.current?.locateHeading(item.pos)}
              >
                {item.text || t.untitledHeading}
              </button>
            ))}
          </aside>
        )}
        <div className="document-page__content">
          <DocumentEditor
            value={value}
            readonly={readonly}
            history={history}
            restore={restore}
            onChange={onChange}
            onReady={ready}
            onImageFile={pickImage}
          />
        </div>
      </div>
      <footer className="document-page__status">
        <span>
          {charCount} {t.chars}
        </span>
        <span className={`document-page__save is-${saveState}`}>
          {t.save[saveState]}
        </span>
      </footer>
      {notice && (
        <div className="document-page__notice" role="status">
          {notice}
          <button type="button" onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
