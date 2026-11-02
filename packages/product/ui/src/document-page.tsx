import { parseWorkspaceLink } from '@sue/board-common';
import { DocumentToolbarMenu } from './document-toolbar-menu';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
} from 'react';
import {
  Bold,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Columns3,
  Italic,
  Link as LinkIcon,
  ListTree,
  Redo2,
  Replace,
  ReplaceAll,
  Rows3,
  Search,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { createActionRegistry, type BoundAction } from '@sue/board-common';
import {
  ActionScope,
  resolveActionShortcut,
  useActionScope,
  useActionState,
  useActionSource,
  type ActionScopeValue,
  type ActionSource,
} from '@sue/board-react-actions';
import {
  DocumentEditor,
  useRichTextLinks,
  type RichTextLinkActivation,
  type DocumentEditorController,
  type DocumentHistoryAdapter,
  type DocumentHeading,
  type DocumentSearchMatch,
  type DocumentSelection,
  type DocumentToolbarState,
} from '@sue/board-react-text';
import type { BoardTextDocument, WorkspaceTarget } from '@sue/board-common';
import './document-page.scss';
import { FrameColorInput, useFrameTheme } from '@sue/board-react';
import { useAppearancePreference } from './appearance-preferences';

export type {
  DocumentEditorChange,
  DocumentEditorController,
  DocumentHistoryAdapter,
  DocumentSelection,
} from '@sue/board-react-text';

export type DocumentSaveState =
  'saved' | 'unsaved' | 'saving' | 'error' | 'conflicted';

export interface DocumentPageProps {
  folding?: import('@sue/board-react-text').DocumentFoldingAdapter;
  onAttachmentFile?: import('@sue/board-react-text').DocumentEditorProps['onAttachmentFile'];
  renderAttachment?: import('@sue/board-react-text').DocumentEditorProps['renderAttachment'];
  renderWebEmbed?: import('@sue/board-react-text').DocumentEditorProps['renderWebEmbed'];
  compact?: boolean;
  linkActivation?: RichTextLinkActivation;
  linkChoices?: readonly { href: string; title: string; detail: string }[];
  onPreviewLink?(href: string): void;
  frameChoices?: readonly { frameId: string; title: string; path: string }[];
  renderFrameReference?: import('@sue/board-react-text').DocumentFrameReferenceRenderer;
  value: BoardTextDocument;
  title: string;
  readonly?: boolean;
  locale?: 'zh' | 'en';
  saveState?: DocumentSaveState;
  history?: DocumentHistoryAdapter;
  restore?: { revision: number; selection?: DocumentSelection };
  /** Focuses the title once — used right after creating a document. */
  autoFocusTitle?: boolean;
  onChange: import('@sue/board-react-text').DocumentEditorProps['onChange'];
  onTitleCommit(title: string): void;
  /** Exports the document file in a supported format. */
  onExport?(format: 'json' | 'markdown'): void;
  /** Resolves a picked image file to an insertable src; null cancels. */
  onInsertImage?(file: File): Promise<string | null>;
  onReady?(controller: DocumentEditorController | null): void;
  /** Receives explicit link activation; the workspace resolves the target. */
  onOpenLink?(href: string): void;
  /** A fresh request also navigates an already mounted document. */
  navigation?: {
    searchMatch?: {
      revision: string;
      term: string;
      text: string;
      from?: number;
    };
    requestId: number;
    target: WorkspaceTarget;
    /** Session-only address; positions are resolved against the current editor. */
    frameReference?: {
      targetFrameId: string;
      occurrence: number;
      revision: string;
    };
    signal?: AbortSignal;
  };
  onNavigationResult?(
    requestId: number,
    result: { status: 'revealed' | 'unavailable' | 'cancelled'; code?: string },
  ): void;
}

// The page manages navigation/embedded focus explicitly; passive tabs must not steal it.
const managedEditorFocus = { autoFocus: false };

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
    openLink: '打开链接',
    headingNotFound: '未找到目标章节，已返回文档开头',
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
    openLink: 'Open link',
    headingNotFound: 'Section not found. Returned to the document start.',
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
  actionId,
}: {
  title: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?(): void;
  icon: LucideIcon;
  actionId?: string;
}) {
  const scope = useActionScope();
  const state = useActionState(actionId ?? '');
  if (actionId && !state.visible) return null;
  return (
    <button
      type="button"
      className={`doc-toolbar__btn${pressed ? ' pressed' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={actionId ? (state.checked ?? pressed) : pressed}
      disabled={disabled || (actionId ? !state.enabled : false)}
      data-action-id={actionId}
      // Keep the editor selection — commands act on it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={
        onClick ??
        (() => {
          if (actionId)
            void scope?.source
              .actions()
              .find((action) => action.id === actionId)
              ?.capture()
              .execute(undefined, { source: 'toolbar' });
        })
      }
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
  compact = false,
  linkActivation = 'modifier',
  onChange,
  onTitleCommit,
  onExport,
  onInsertImage,
  onReady,
  onOpenLink,
  navigation,
  onNavigationResult,
  frameChoices,
  linkChoices,
  onPreviewLink,
  renderFrameReference,
  folding,
  onAttachmentFile,
  renderAttachment,
  renderWebEmbed,
}: DocumentPageProps) {
  const t = labels[locale];
  const textColorId = useId();
  const headerRef = useRef<HTMLDivElement>(null);
  const [toolbarWidth, setToolbarWidth] = useState(800);
  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setToolbarWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const colorActions = useRef<{
    text: BoundAction | null;
    highlight: BoundAction | null;
  }>({ text: null, highlight: null });
  const shortcutsButton = useRef<HTMLButtonElement>(null);
  const commandButton = useRef<HTMLButtonElement>(null);
  const [controller, setController] = useState<DocumentEditorController | null>(
    null,
  );
  const [toolbar, setToolbar] = useState<DocumentToolbarState | null>(null);
  const [tocOpen, setTocOpen] = useState(!compact);
  const [headings, setHeadings] = useState<DocumentHeading[]>([]);
  const [findOpen, setFindOpen] = useState<false | 'find' | 'replace'>(false);
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [matches, setMatches] = useState<DocumentSearchMatch[]>([]);
  const [matchIndex, setMatchIndex] = useState(-1);
  const [replacement, setReplacement] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [linkQuery, setLinkQuery] = useState('');
  const [frameQuery, setFrameQuery] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkSearchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (linkOpen) (linkSearchRef.current ?? linkInputRef.current)?.focus();
  }, [linkOpen]);
  const [notice, setNotice] = useState<string | null>(null);
  const [framePickerOpen, setFramePickerOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [charCount, setCharCount] = useState(0);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<DocumentEditorController | null>(null);
  const lastNavigationRef = useRef<number | null>(null);
  const navigationAnchor =
    navigation?.target.kind === 'heading' ? navigation.target.slug : null;
  const navigationKind = navigation?.target.kind;
  const navigationSignal = navigation?.signal;
  const navigationFileId = navigation?.target.fileId;
  const navigationRequestId = navigation?.requestId;
  const navigationFrameReference = navigation?.frameReference;
  controllerRef.current = controller;

  const refreshToolbar = useCallback(() => {
    const ctl = controllerRef.current;
    if (!ctl) return;
    setToolbar(ctl.getToolbarState());
    setHeadings(ctl.getHeadings());
    setCharCount(ctl.getCharacterCount());
  }, []);

  const { appearance } = useAppearancePreference();
  const frameTheme = useFrameTheme();

  useEffect(() => {
    if (!controller) return;
    refreshToolbar();
    return controller.subscribe(refreshToolbar);
  }, [controller, refreshToolbar, appearance, frameTheme]);

  const ready = useCallback(
    (ctl: DocumentEditorController | null) => {
      setController(ctl);
      onReady?.(ctl);
    },
    [onReady],
  );

  useEffect(() => {
    if (
      !controller ||
      navigationRequestId === undefined ||
      lastNavigationRef.current === navigationRequestId
    )
      return;
    // WorkspaceApp activates the pane in the same render as this request.
    const frame = requestAnimationFrame(() => {
      lastNavigationRef.current = navigationRequestId;
      if (navigationSignal?.aborted) {
        onNavigationResult?.(navigationRequestId, {
          status: 'cancelled',
          code: 'aborted',
        });
        return;
      }
      if (navigationKind === 'cell' || navigationFileId !== value.id) {
        onNavigationResult?.(navigationRequestId, {
          status: 'unavailable',
          code: navigationKind === 'cell' ? 'wrong-file-type' : 'wrong-file',
        });
        return;
      }
      if (navigationFrameReference) {
        const fresh =
          JSON.stringify(value.content) === navigationFrameReference.revision;
        const revealed =
          fresh &&
          controller.locateFrameReference(
            navigationFrameReference.targetFrameId,
            navigationFrameReference.occurrence,
          );
        setNotice(
          revealed
            ? null
            : locale === 'zh'
              ? '引用位置已变化，请重新选择。'
              : 'The reference changed. Please select it again.',
        );
        onNavigationResult?.(
          navigationRequestId,
          revealed
            ? { status: 'revealed' }
            : {
                status: 'unavailable',
                code: fresh ? 'missing-reference' : 'stale-reference',
              },
        );
        return;
      }
      if (navigation?.searchMatch) {
        const match = navigation.searchMatch;
        const fresh =
          JSON.stringify(controller.getDocument().content) === match.revision;
        const found = fresh
          ? controller.find(match.term, { caseSensitive: false })
          : [];
        const hit = found.find(
          (hit) =>
            match.from === undefined ||
            hit.from ===
              match.from + match.text.toLocaleLowerCase().indexOf(match.term),
        );
        if (hit) controller.selectMatch(hit);
        setNotice(
          hit
            ? null
            : locale === 'zh'
              ? '内容已变化，请重新搜索。'
              : 'Content changed; search again.',
        );
        onNavigationResult?.(
          navigationRequestId,
          hit
            ? { status: 'revealed' }
            : { status: 'unavailable', code: 'stale-search' },
        );
        return;
      }
      if (navigationAnchor?.startsWith('block:')) {
        void controller
          .executeAction('document.locate-block', navigationAnchor.slice(6))
          .then((result) =>
            onNavigationResult?.(
              navigationRequestId,
              result.status === 'completed'
                ? { status: 'revealed' }
                : { status: 'unavailable', code: 'missing-block' },
            ),
          );
        return;
      }
      const heading = navigationAnchor
        ? controller
            .getHeadings()
            .find((item) => item.anchor === navigationAnchor)
        : undefined;
      setNotice(null);
      if (heading) {
        controller.locateHeading(heading.pos);
        onNavigationResult?.(navigationRequestId, { status: 'revealed' });
      } else if (navigationAnchor) {
        setNotice(t.headingNotFound);
        onNavigationResult?.(navigationRequestId, {
          status: 'unavailable',
          code: 'missing-heading',
        });
      } else {
        controller.focus('start');
        onNavigationResult?.(navigationRequestId, { status: 'revealed' });
      }
    });
    const aborted = () => {
      cancelAnimationFrame(frame);
      if (lastNavigationRef.current !== navigationRequestId) {
        lastNavigationRef.current = navigationRequestId;
        onNavigationResult?.(navigationRequestId, {
          status: 'cancelled',
          code: 'aborted',
        });
      }
    };
    navigationSignal?.addEventListener('abort', aborted, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      navigationSignal?.removeEventListener('abort', aborted);
    };
  }, [
    controller,
    navigationAnchor,
    navigationRequestId,
    navigationKind,
    navigationFrameReference,
    navigationSignal,
    navigationFileId,
    value.id,
    value.content,
    locale,
    onNavigationResult,
    t.headingNotFound,
  ]);

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

  const replaceCurrent = async () => {
    const ctl = controllerRef.current;
    if (!ctl || matchIndex < 0 || !matches[matchIndex]) return;
    await ctl.executeAction('document.replace', {
      match: matches[matchIndex],
      text: replacement,
    });
    runFind(query, matchCase);
  };

  const replaceEvery = async () => {
    const ctl = controllerRef.current;
    if (!ctl || !query) return;
    await ctl.executeAction('document.replace-all', {
      query,
      text: replacement,
      options: { caseSensitive: matchCase },
    });
    runFind(query, matchCase);
  };

  const closeFind = () => {
    setFindOpen(false);
    controllerRef.current?.clearReveal?.();
    controllerRef.current?.focus();
  };

  // ------- link / image -------
  const applyLink = () => {
    const href = linkDraft.trim();
    if (href) void linkAction.current?.execute(href, { source: 'toolbar' });
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
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const resolved = resolveActionShortcut(pageActions.actions(), event);
    if (
      resolved.status === 'matched' &&
      resolved.action.id !== 'document.command-palette'
    ) {
      event.preventDefault();
      event.stopPropagation();
      void resolved.action.capture().execute(undefined, { source: 'shortcut' });
      return;
    }
    if (event.key === 'Escape' && findOpen) {
      event.preventDefault();
      closeFind();
      return;
    }
    if (event.key === 'Escape' && (framePickerOpen || linkOpen)) {
      event.preventDefault();
      setFramePickerOpen(false);
      setLinkOpen(false);
    }
  };

  const linkEvents = useRichTextLinks({
    activation: linkActivation,
    locale,
    readonly,
    onOpenLink,
  });

  const scopeRef = useRef<ActionScopeValue | null>(null);
  const linkAction = useRef<BoundAction | null>(null);
  const insertLinkAction = useRef<BoundAction | null>(null);
  const insertExcerptAction = useRef<BoundAction | null>(null);
  const imageAction = useRef<BoundAction | null>(null);
  const frameAction = useRef<BoundAction | null>(null);
  const actionOptions = useRef({
    value,
    readonly,
    onExport,
    controller,
    toolbar,
  });
  actionOptions.current = { value, readonly, onExport, controller, toolbar };
  const actionHandlers = useRef<Record<string, () => void>>({});
  const pageActions = useMemo(() => {
    const actions = createActionRegistry({
      getContext: () => ({
        id: actionOptions.current.value.id,
        controller: actionOptions.current.controller,
      }),
      refresh: (captured) =>
        captured.id === actionOptions.current.value.id &&
        captured.controller === actionOptions.current.controller
          ? captured
          : null,
    });
    for (const [id, label, key, shift, editable] of [
      ['find', '查找', 'f', false, false],
      ['find-replace', '查找替换', 'h', true, true],
      ['link-dialog', '链接', '', false, true],
      ['image-dialog', '插入图片', '', false, true],
      ['frame-dialog', '插入图表', '', false, true],
      ['toggle-toc', '目录', '', false, false],
      ['help', '快捷键', '', false, false],
      ['command-palette', '命令面板', 'p', true, false],
      ['export-dialog', '导出', '', false, false],
    ] as const)
      actions.register({
        id: `document.${id}`,
        label: {
          zh: label,
          en:
            id === 'command-palette'
              ? 'Command palette'
              : id.replace(/-/g, ' '),
        },
        category: 'document',
        effect: id === 'toggle-toc' ? 'view' : 'dialog',
        palette: id !== 'command-palette',
        shortcuts: key ? [{ key, mod: true, shift }] : undefined,
        getState: () => ({
          enabled:
            !!actionOptions.current.controller &&
            (!editable || !actionOptions.current.readonly),
          reason:
            editable && actionOptions.current.readonly ? 'readonly' : undefined,
        }),
        execute: () => {
          actionHandlers.current[id]?.();
          return { status: 'completed' };
        },
      });
    for (const format of ['json', 'markdown'] as const)
      actions.register({
        id: `document.export-${format}`,
        label: format === 'json' ? '导出文档' : '导出 Markdown',
        category: 'document',
        effect: 'external',
        getState: () => ({
          visible: !!actionOptions.current.onExport,
          enabled:
            !!actionOptions.current.onExport &&
            !!actionOptions.current.controller,
        }),
        execute: async (context, _args, execution) => {
          const receipt = await context.controller!.flushEditing();
          if (receipt.status !== 'completed' && receipt.status !== 'noop')
            return receipt;
          const invalid = execution.checkpoint();
          if (invalid) return invalid;
          await actionOptions.current.onExport?.(format);
          return { status: 'completed' };
        },
      });
    actions.seal();
    return actions;
  }, []);
  useActionSource(pageActions);
  const actionsMounted = useRef(false);
  useEffect(() => {
    actionsMounted.current = true;
    return () => {
      actionsMounted.current = false;
      queueMicrotask(() => {
        if (!actionsMounted.current) pageActions.dispose();
      });
    };
  }, [pageActions]);
  useEffect(() => {
    pageActions.invalidate();
  }, [pageActions, controller, readonly, onExport]);
  const source = useMemo<ActionSource>(
    () => ({
      actions: () => [
        ...(controller?.actions() ?? []),
        ...pageActions.actions(),
      ],
      getActionState: (id, args) =>
        controller?.actions().some((action) => action.id === id)
          ? controller.getActionState(id, args)
          : pageActions.getActionState(id, args),
      subscribe(listener) {
        const a = controller?.subscribe(listener);
        const b = pageActions.subscribe(listener);
        return () => {
          a?.();
          b();
        };
      },
      get revision() {
        return (controller?.revision ?? 0) + pageActions.revision;
      },
    }),
    [controller, pageActions],
  );
  const invoke = (id: string, args?: unknown) => {
    const action = source
      .actions()
      .find((item) => item.id === `document.${id}`);
    if (action) void action.capture().execute(args, { source: 'toolbar' });
  };
  const capture = (id: string) =>
    controllerRef.current
      ?.actions()
      .find((action) => action.id === `document.${id}`)
      ?.capture() ?? null;
  actionHandlers.current = {
    find: () => openFind('find'),
    'find-replace': () => openFind('replace'),
    'link-dialog': () => {
      linkAction.current = capture('set-link');
      insertLinkAction.current = capture('insert-link');
      insertExcerptAction.current = capture('insert-excerpt');
      setLinkDraft(controllerRef.current?.getToolbarState().link ?? '');
      setLinkQuery('');
      setLinkOpen((open) => !open);
    },
    'image-dialog': () => {
      imageAction.current = capture('insert-image');
      imageInputRef.current?.click();
    },
    'frame-dialog': () => {
      frameAction.current = capture('insert-frame-reference');
      setFrameQuery('');
      setFramePickerOpen(true);
    },
    'toggle-toc': () => setTocOpen((open) => !open),
    'export-dialog': () => commandButton.current?.click(),
    help: () =>
      scopeRef.current?.openHelp({
        returnFocus: () => shortcutsButton.current,
      }),
    'command-palette': () =>
      scopeRef.current?.openPalette({
        returnFocus: () => commandButton.current,
      }),
  };

  const canUndo = controller?.getActionState('document.undo').enabled ?? false;
  const canRedo = controller?.getActionState('document.redo').enabled ?? false;
  const blockValue =
    toolbar?.block === 'heading'
      ? `h${toolbar.headingLevel ?? 1}`
      : (toolbar?.block ?? 'paragraph');
  const menuActions = useRef(new Map<string, BoundAction>());
  const captureMenu = () => {
    menuActions.current = new Map(
      source.actions().map((action) => [action.id, action.capture()]),
    );
  };
  const menuItem = (
    id: string,
    label: string,
    close: () => void,
    args?: unknown,
  ) => {
    const action = menuActions.current.get(`document.${id}`);
    const state = action?.getState(args);
    if (state && !state.visible) return null;
    return (
      <button
        type="button"
        key={id}
        disabled={!state?.enabled}
        data-action-id={`document.${id}`}
        aria-pressed={state?.checked}
        onClick={() => {
          close();
          void action?.execute(args, { source: 'menu' });
        }}
      >
        {label}
      </button>
    );
  };
  const narrow = toolbarWidth < 720;
  const small = toolbarWidth < 480;
  return (
    <ActionScope
      registry={source}
      language={locale}
      onReady={(scope) => {
        scopeRef.current = scope;
      }}
    >
      <div
        className={`document-page${compact ? ' document-page--compact' : ''}`}
        onKeyDownCapture={pageKeyDown}
        {...linkEvents}
      >
        <header className="document-page__header" ref={headerRef}>
          <div className="document-page__title-row">
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
            <div className="document-page__actions">
              <ToolbarButton
                title={t.find}
                pressed={!!findOpen}
                onClick={() => (findOpen ? closeFind() : invoke('find'))}
                icon={Search}
              />
              <ToolbarButton
                title={t.toc}
                pressed={tocOpen}
                onClick={() => invoke('toggle-toc')}
                icon={ListTree}
              />
              <DocumentToolbarMenu
                label={locale === 'zh' ? '文档' : 'Document'}
                onOpen={captureMenu}
                buttonRef={(node) => {
                  commandButton.current = node;
                  shortcutsButton.current = node;
                }}
              >
                {(close) => (
                  <>
                    {menuItem(
                      'command-palette',
                      locale === 'zh' ? '命令面板' : 'Command palette',
                      close,
                    )}
                    {menuItem(
                      'help',
                      locale === 'zh' ? '快捷键' : 'Keyboard shortcuts',
                      close,
                    )}
                    {onExport && (
                      <>
                        {menuItem('export-json', t.exportJson, close)}
                        {menuItem('export-markdown', t.exportMarkdown, close)}
                      </>
                    )}
                  </>
                )}
              </DocumentToolbarMenu>
            </div>
          </div>
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
                  if (v === 'paragraph') invoke('set-paragraph');
                  else if (v.startsWith('h'))
                    invoke('set-heading', Number(v.slice(1)));
                  else if (v === 'blockquote') invoke('toggle-blockquote');
                  else if (v === 'codeBlock') invoke('toggle-code-block');
                  else if (v === 'bulletList') invoke('toggle-bullet-list');
                  else if (v === 'orderedList') invoke('toggle-ordered-list');
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
              {!narrow && (
                <select
                  className="doc-toolbar__select doc-toolbar__select--size"
                  title={t.fontSize}
                  value={toolbar?.marks.fontSize ?? ''}
                  onChange={(event) =>
                    invoke('set-font-size', event.target.value || null)
                  }
                >
                  <option value="">{t.fontSize}</option>
                  {FONT_SIZES.map((size) => (
                    <option key={size} value={`${size}px`}>
                      {size}
                    </option>
                  ))}
                </select>
              )}
              <ToolbarButton
                title={t.bold}
                actionId="document.toggle-bold"
                icon={Bold}
              />
              {!small && (
                <ToolbarButton
                  title={t.italic}
                  actionId="document.toggle-italic"
                  icon={Italic}
                />
              )}
              {!narrow && (
                <ToolbarButton
                  title={t.underline}
                  actionId="document.toggle-underline"
                  icon={UnderlineIcon}
                />
              )}
              {!small && (
                <DocumentToolbarMenu
                  label={locale === 'zh' ? '颜色' : 'Color'}
                  onOpen={() => {
                    colorActions.current = {
                      text: capture('set-text-color'),
                      highlight: capture('set-highlight'),
                    };
                  }}
                >
                  {() => (
                    <>
                      <label className="doc-toolbar-menu__color">
                        {t.textColor}
                        <FrameColorInput
                          id={textColorId}
                          aria-label={t.textColor}
                          value={toolbar?.marks.color ?? '#111827'}
                          onValue={(value) => {
                            void colorActions.current.text?.execute(value, {
                              source: 'toolbar',
                            });
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        aria-label="Reset document text color to theme"
                        onClick={() => {
                          void colorActions.current.text?.execute(null, {
                            source: 'toolbar',
                          });
                        }}
                      >
                        {locale === 'zh' ? '跟随主题' : 'Theme color'}
                      </button>
                      <label className="doc-toolbar-menu__color">
                        {t.highlight}
                        <FrameColorInput
                          aria-label={t.highlight}
                          value={toolbar?.marks.highlight ?? '#fef08a'}
                          onValue={(value) => {
                            void colorActions.current.highlight?.execute(
                              value,
                              { source: 'toolbar' },
                            );
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          void colorActions.current.highlight?.execute(null, {
                            source: 'toolbar',
                          });
                        }}
                      >
                        {locale === 'zh' ? '清除高亮' : 'Clear highlight'}
                      </button>
                    </>
                  )}
                </DocumentToolbarMenu>
              )}
              {!narrow && (
                <DocumentToolbarMenu
                  label={locale === 'zh' ? '对齐' : 'Align'}
                  onOpen={captureMenu}
                >
                  {(close) => (
                    <>
                      {menuItem('align-left', t.alignLeft, close)}
                      {menuItem('align-center', t.alignCenter, close)}
                      {menuItem('align-right', t.alignRight, close)}
                    </>
                  )}
                </DocumentToolbarMenu>
              )}
              <ToolbarButton
                actionId="document.link-dialog"
                title={t.link}
                icon={LinkIcon}
              />
              <DocumentToolbarMenu
                label={locale === 'zh' ? '插入' : 'Insert'}
                onOpen={captureMenu}
              >
                {(close) => (
                  <>
                    {menuItem('image-dialog', t.image, close)}
                    {frameChoices &&
                      menuItem(
                        'frame-dialog',
                        locale === 'zh' ? '图表' : 'Canvas',
                        close,
                      )}
                    {menuItem('insert-table', t.table, close)}
                    {menuItem(
                      'insert-horizontal-rule',
                      t.horizontalRule,
                      close,
                    )}
                  </>
                )}
              </DocumentToolbarMenu>
              <span className="doc-toolbar__sep" />
              <ToolbarButton
                title={t.undo}
                actionId="document.undo"
                icon={Undo2}
                disabled={!canUndo}
              />
              {!small && (
                <ToolbarButton
                  title={t.redo}
                  actionId="document.redo"
                  icon={Redo2}
                  disabled={!canRedo}
                />
              )}
              <DocumentToolbarMenu
                label={locale === 'zh' ? '更多' : 'More'}
                onOpen={captureMenu}
              >
                {(close) => (
                  <>
                    {small && menuItem('toggle-italic', t.italic, close)}
                    {narrow && menuItem('toggle-underline', t.underline, close)}
                    {menuItem('toggle-strike', t.strike, close)}
                    {menuItem('toggle-code', t.inlineCode, close)}
                    {menuItem('clear-formatting', t.clearFormat, close)}
                    {narrow && (
                      <>
                        <label>
                          {t.fontSize}
                          <select
                            aria-label={t.fontSize}
                            value={toolbar?.marks.fontSize ?? ''}
                            onChange={(event) => {
                              void menuActions.current
                                .get('document.set-font-size')
                                ?.execute(event.target.value || null, {
                                  source: 'menu',
                                });
                            }}
                          >
                            <option value="">{t.fontSize}</option>
                            {FONT_SIZES.map((size) => (
                              <option key={size} value={`${size}px`}>
                                {size}
                              </option>
                            ))}
                          </select>
                        </label>
                        {menuItem('align-left', t.alignLeft, close)}
                        {menuItem('align-center', t.alignCenter, close)}
                        {menuItem('align-right', t.alignRight, close)}
                      </>
                    )}
                    {small && (
                      <>
                        <label>
                          {t.textColor}
                          <FrameColorInput
                            aria-label={t.textColor}
                            value={toolbar?.marks.color ?? '#111827'}
                            onValue={(value) => {
                              void menuActions.current
                                .get('document.set-text-color')
                                ?.execute(value, { source: 'menu' });
                            }}
                          />
                        </label>
                        {menuItem(
                          'set-text-color',
                          locale === 'zh' ? '跟随主题' : 'Theme color',
                          close,
                          null,
                        )}
                        <label>
                          {t.highlight}
                          <FrameColorInput
                            aria-label={t.highlight}
                            value={toolbar?.marks.highlight ?? '#fef08a'}
                            onValue={(value) => {
                              void menuActions.current
                                .get('document.set-highlight')
                                ?.execute(value, { source: 'menu' });
                            }}
                          />
                        </label>
                        {menuItem(
                          'set-highlight',
                          locale === 'zh' ? '清除高亮' : 'Clear highlight',
                          close,
                          null,
                        )}
                        {menuItem('redo', t.redo, close)}
                      </>
                    )}
                  </>
                )}
              </DocumentToolbarMenu>
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
                  if (src)
                    void imageAction.current?.execute(
                      { src },
                      { source: 'toolbar' },
                    );
                }}
              />
            </div>
          )}
          {framePickerOpen && !readonly && (
            <div
              className="doc-frame-picker"
              role="dialog"
              aria-label={locale === 'zh' ? '插入图表' : 'Insert canvas'}
            >
              <button type="button" onClick={() => setFramePickerOpen(false)}>
                {locale === 'zh' ? '取消' : 'Cancel'}
              </button>
              <input
                aria-label={locale === 'zh' ? '搜索图表' : 'Search canvases'}
                value={frameQuery}
                onChange={(event) => setFrameQuery(event.target.value)}
              />
              {frameChoices
                ?.filter((frame) =>
                  frameQuery
                    .toLocaleLowerCase()
                    .trim()
                    .split(/\s+/)
                    .every((term) =>
                      (frame.title + ' ' + frame.path)
                        .toLocaleLowerCase()
                        .includes(term),
                    ),
                )
                .map((frame) => (
                  <button
                    type="button"
                    key={frame.frameId}
                    onClick={() => {
                      void frameAction.current?.execute(frame.frameId, {
                        source: 'toolbar',
                      });
                      setFramePickerOpen(false);
                    }}
                  >
                    {frame.title} <small>{frame.path}</small>
                  </button>
                ))}
              {!frameChoices?.length && (
                <p>
                  {locale === 'zh'
                    ? '工作区中没有画布'
                    : 'No canvases in this workspace'}
                </p>
              )}
            </div>
          )}
          {linkOpen && (
            <div className="doc-linkbar">
              {linkChoices && !readonly && (
                <div className="doc-link-choices">
                  <input
                    ref={linkSearchRef}
                    aria-label={
                      locale === 'zh' ? '搜索内部链接' : 'Search internal links'
                    }
                    placeholder={
                      locale === 'zh'
                        ? '搜索文档、章节或图元'
                        : 'Find a document, heading or cell'
                    }
                    value={linkQuery}
                    onChange={(event) => setLinkQuery(event.target.value)}
                  />
                  <div style={{ maxHeight: 220, overflow: 'auto' }}>
                    {linkChoices
                      .filter((item) =>
                        linkQuery
                          .toLocaleLowerCase()
                          .trim()
                          .split(/\s+/)
                          .every((term) =>
                            `${item.title} ${item.detail}`
                              .toLocaleLowerCase()
                              .includes(term),
                          ),
                      )
                      .slice(0, 40)
                      .map((item) => (
                        <div key={item.href}>
                          <button
                            type="button"
                            onClick={() => {
                              void insertLinkAction.current?.execute(
                                { href: item.href, label: item.title },
                                { source: 'toolbar' },
                              );
                              setLinkOpen(false);
                            }}
                          >
                            {item.title} · {item.detail}
                          </button>
                          {item.href.includes('#block%3A') && (
                            <button
                              type="button"
                              onClick={() => {
                                const target = parseWorkspaceLink(item.href);
                                if (
                                  target?.kind === 'heading' &&
                                  target.slug.startsWith('block:')
                                ) {
                                  void insertExcerptAction.current?.execute(
                                    {
                                      targetDocumentId: target.fileId,
                                      blockId: target.slug.slice(6),
                                    },
                                    { source: 'toolbar' },
                                  );
                                  setLinkOpen(false);
                                }
                              }}
                            >
                              引用此段
                            </button>
                          )}
                          {onPreviewLink && (
                            <button
                              type="button"
                              aria-label={`${locale === 'zh' ? '预览' : 'Preview'} ${item.title}`}
                              onClick={() => onPreviewLink(item.href)}
                            >
                              {locale === 'zh' ? '预览' : 'Preview'}
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}
              <input
                ref={linkInputRef}
                value={linkDraft}
                placeholder={t.linkPlaceholder}
                onChange={(event) => setLinkDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing)
                    applyLink();
                  if (event.key === 'Escape') setLinkOpen(false);
                }}
              />
              <button type="button" onClick={applyLink}>
                {t.linkApply}
              </button>
              {onPreviewLink && (
                <button
                  type="button"
                  disabled={!linkDraft.trim()}
                  onClick={() => onPreviewLink(linkDraft.trim())}
                >
                  {locale === 'zh' ? '预览链接' : 'Preview link'}
                </button>
              )}
              {onOpenLink && (
                <button
                  type="button"
                  disabled={!linkDraft.trim()}
                  onClick={() => {
                    const href = linkDraft.trim();
                    if (href) onOpenLink(href);
                  }}
                >
                  {t.openLink}
                </button>
              )}
              {toolbar?.link && (
                <button
                  type="button"
                  onClick={() => {
                    void linkAction.current?.execute(null, {
                      source: 'toolbar',
                    });
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
                actionId="document.add-row-before"
                title={t.addRowBefore}
                disabled={
                  !controller?.getActionState('document.add-row-before').enabled
                }
                onClick={() => invoke('add-row-before')}
                icon={Rows3}
              />
              <ToolbarButton
                actionId="document.add-row-after"
                title={t.addRow}
                disabled={
                  !controller?.getActionState('document.add-row-after').enabled
                }
                onClick={() => invoke('add-row-after')}
                icon={Rows3}
              />
              <ToolbarButton
                actionId="document.add-column-before"
                title={t.addColBefore}
                disabled={
                  !controller?.getActionState('document.add-column-before')
                    .enabled
                }
                onClick={() => invoke('add-column-before')}
                icon={Columns3}
              />
              <ToolbarButton
                actionId="document.add-column-after"
                title={t.addCol}
                disabled={
                  !controller?.getActionState('document.add-column-after')
                    .enabled
                }
                onClick={() => invoke('add-column-after')}
                icon={Columns3}
              />
              <span className="doc-toolbar__sep" />
              <ToolbarButton
                actionId="document.delete-row"
                title={t.delRow}
                disabled={
                  !controller?.getActionState('document.delete-row').enabled
                }
                onClick={() => invoke('delete-row')}
                icon={Rows3}
              />
              <ToolbarButton
                actionId="document.delete-column"
                title={t.delCol}
                disabled={
                  !controller?.getActionState('document.delete-column').enabled
                }
                onClick={() => invoke('delete-column')}
                icon={Columns3}
              />
              <ToolbarButton
                actionId="document.toggle-header-row"
                title={t.headerRow}
                disabled={
                  !controller?.getActionState('document.toggle-header-row')
                    .enabled
                }
                onClick={() => invoke('toggle-header-row')}
                icon={TableIcon}
              />
              <ToolbarButton
                actionId="document.toggle-header-column"
                title={t.headerCol}
                disabled={
                  !controller?.getActionState('document.toggle-header-column')
                    .enabled
                }
                onClick={() => invoke('toggle-header-column')}
                icon={TableIcon}
              />
              <span className="doc-toolbar__sep" />
              <ToolbarButton
                actionId="document.delete-table"
                title={t.delTable}
                disabled={
                  !controller?.getActionState('document.delete-table').enabled
                }
                onClick={() => invoke('delete-table')}
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
              folding={folding}
              onAttachmentFile={onAttachmentFile}
              renderAttachment={renderAttachment}
              renderWebEmbed={renderWebEmbed}
              {...managedEditorFocus}
              renderFrameReference={renderFrameReference}
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
    </ActionScope>
  );
}
