import {
  DocumentSaveStatus,
  type DocumentSaveState,
} from '../shared/save-status';
export {
  DocumentSaveStatus,
  type DocumentSaveState,
} from '../shared/save-status';
import { DocumentFindBar } from './document-find-bar';
import { DocumentToolbarMenu } from './document-toolbar-menu';
import React, {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Download,
  FileText,
  Globe,
  Image,
  Keyboard,
  LayoutDashboard,
  Minus,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Presentation,
  Redo2,
  Search,
  Sigma,
  Table2,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  createActionRegistry,
  type BoundAction,
  type ActionResult,
} from '@sue/board-common';
import {
  ActionScope,
  formatActionShortcut,
  resolveActionShortcut,
  useActionScope,
  useActionState,
  useActionSource,
  type ActionScopeValue,
  type ActionSource,
} from '@sue/board-react-actions';
import {
  DocumentEditor,
  LinkEditorHost,
  requestDocumentLink,
  documentInsertActions,
  useRichTextLinks,
  type RichTextLinkActivation,
  type DocumentEditorController,
  type DocumentHistoryAdapter,
  type DocumentHeading,
  type DocumentSelection,
  type DocumentToolbarState,
} from '@sue/board-react-text';
import type { BoardTextDocument, WorkspaceFileTarget } from '@sue/board-common';
import './document-page.scss';
import {
  WorkspaceLinkEditor,
  type WorkspaceLinkChoice,
} from '../shared/workspace-link-editor';
import { useFrameTheme } from '@sue/board-react';
import { useAppearancePreference } from '../shared/preferences/appearance-preferences';

export type {
  DocumentEditorChange,
  DocumentEditorController,
  DocumentHistoryAdapter,
  DocumentSelection,
} from '@sue/board-react-text';

export interface DocumentPageProps {
  folding?: import('@sue/board-react-text').DocumentFoldingAdapter;
  onAttachmentFile?: import('@sue/board-react-text').DocumentEditorProps['onAttachmentFile'];
  renderAttachment?: import('@sue/board-react-text').DocumentEditorProps['renderAttachment'];
  renderWebEmbed?: import('@sue/board-react-text').DocumentEditorProps['renderWebEmbed'];
  compact?: boolean;
  linkActivation?: RichTextLinkActivation;
  linkChoices?: readonly WorkspaceLinkChoice[];
  onCreateFolderLink?(path: string): Promise<string>;
  onPreviewLink?(href: string): void;
  frameChoices?: readonly { frameId: string; title: string; path: string }[];
  renderFrameReference?: import('@sue/board-react-text').DocumentFrameReferenceRenderer;
  value: BoardTextDocument;
  title: string;
  readonly?: boolean;
  locale?: 'zh' | 'en';
  saveState?: DocumentSaveState;
  showSaveStatus?: boolean;
  onPresent?(): void | Promise<ActionResult>;
  history?: DocumentHistoryAdapter;
  restore?: { revision: number; selection?: DocumentSelection };
  onChange: import('@sue/board-react-text').DocumentEditorProps['onChange'];
  /** Exports the document file in a supported format. */
  onExport?(format: 'json' | 'markdown'): void;
  /** Resolves a picked image file to an insertable src; null cancels. */
  onInsertImage?(file: File): Promise<string | null>;
  captureInsertionScope?: import('@sue/board-react-text').DocumentEditorProps['captureInsertionScope'];
  onInsertionError?(message: string): void;
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
    target: WorkspaceFileTarget;
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

const menuIcons: Record<string, LucideIcon> = {
  undo: Undo2,
  redo: Redo2,
  'command-palette': Keyboard,
  help: Keyboard,
  'export-json': Download,
  'export-markdown': FileText,
  'image-dialog': Image,
  'attachment-dialog': Paperclip,
  'web-dialog': Globe,
  'frame-dialog': LayoutDashboard,
  'insert-table': Table2,
  'insert-horizontal-rule': Minus,
  'insert-inline-math': Sigma,
  'insert-block-math': Sigma,
};

const labels = {
  zh: {
    untitled: '未命名文档',
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
    tocShow: '显示目录',
    tocHide: '隐藏目录',
    tocEmpty: '暂无标题',
    untitledHeading: '未命名标题',
    exportJson: 'VerdBoard 文档 (.json)',
    exportMarkdown: 'Markdown (.md)',
    chars: '字符',
    tableActions: '表格',
    addRow: '下方插入行',
    addRowBefore: '上方插入行',
    addCol: '右侧插入列',
    addColBefore: '左侧插入列',
    delRow: '删除行',
    delCol: '删除列',
    delTable: '删除表格',
    headerRow: '表头行',
    headerCol: '表头列',
    imageTooLarge: '图片超过 10 MiB 上限',
    imageReadFailed: '图片读取失败',
  },
  en: {
    untitled: 'Untitled document',
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
    tocShow: 'Show contents',
    tocHide: 'Hide contents',
    tocEmpty: 'No headings yet',
    untitledHeading: 'Untitled heading',
    exportJson: 'VerdBoard document (.json)',
    exportMarkdown: 'Markdown (.md)',
    chars: 'characters',
    tableActions: 'Table',
    addRow: 'Insert row below',
    addRowBefore: 'Insert row above',
    addCol: 'Insert column right',
    addColBefore: 'Insert column left',
    delRow: 'Delete row',
    delCol: 'Delete column',
    delTable: 'Delete table',
    headerRow: 'Header row',
    headerCol: 'Header column',
    imageTooLarge: 'Image exceeds the 10 MiB limit',
    imageReadFailed: 'Failed to read the image',
  },
};

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

export function DocumentPage(props: DocumentPageProps) {
  const host = useContext(LinkEditorHost);
  if (host) return <DocumentPageContent {...props} />;
  return (
    <WorkspaceLinkEditor
      scope={props.value.id}
      locale={props.locale ?? 'zh'}
      choices={props.linkChoices}
      createFolderLink={props.onCreateFolderLink}
      preview={props.onPreviewLink}
    >
      <DocumentPageContent {...props} />
    </WorkspaceLinkEditor>
  );
}

function DocumentPageContent({
  value,
  title,
  readonly = false,
  locale = 'zh',
  saveState = 'saved',
  showSaveStatus = true,
  onPresent,
  history,
  restore,
  compact = false,
  linkActivation = 'modifier',
  onChange,
  onExport,
  onInsertImage,
  captureInsertionScope,
  onInsertionError,
  onReady,
  onOpenLink,
  navigation,
  onNavigationResult,
  frameChoices,
  renderFrameReference,
  folding,
  onAttachmentFile,
  renderAttachment,
  renderWebEmbed,
  linkChoices,
}: DocumentPageProps) {
  const t = labels[locale];
  const referenceChoices = useMemo(
    () =>
      linkChoices?.flatMap((choice) =>
        'href' in choice &&
        (choice.kind === 'document' || choice.kind === 'canvas')
          ? [
              {
                href: choice.href,
                title: choice.title,
                path: choice.path,
                kind: choice.kind,
              },
            ]
          : [],
      ),
    [linkChoices],
  );
  const shortcutsButton = useRef<HTMLButtonElement>(null);
  const commandButton = useRef<HTMLButtonElement>(null);
  const [controller, setController] = useState<DocumentEditorController | null>(
    null,
  );
  const [toolbar, setToolbar] = useState<DocumentToolbarState | null>(null);
  const [tocOpen, setTocOpen] = useState(!compact);
  const tocId = useId();
  const [headings, setHeadings] = useState<DocumentHeading[]>([]);
  const [findOpen, setFindOpen] = useState<false | 'find' | 'replace'>(false);
  const [frameQuery, setFrameQuery] = useState('');
  const linkHost = useContext(LinkEditorHost);
  const [notice, setNotice] = useState<string | null>(null);
  const [framePickerOpen, setFramePickerOpen] = useState(false);
  const [charCount, setCharCount] = useState(0);
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
          .then((result) => {
            const found = result.status === 'completed';
            setNotice(
              found
                ? null
                : locale === 'zh'
                  ? '找不到该段落。'
                  : 'Block not found.',
            );
            onNavigationResult?.(
              navigationRequestId,
              found
                ? { status: 'revealed' }
                : { status: 'unavailable', code: 'missing-block' },
            );
          });
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

  // ------- find / replace -------
  const openFind = (mode: 'find' | 'replace') => {
    setFindOpen(mode);
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  };

  const closeFind = () => {
    setFindOpen(false);
    controllerRef.current?.clearReveal?.();
    controllerRef.current?.focus();
  };

  // ------- link / image -------
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
    if (event.key === 'Escape' && framePickerOpen) {
      event.preventDefault();
      setFramePickerOpen(false);
    }
  };

  const linkEvents = useRichTextLinks({
    activation: linkActivation,
    locale,
    readonly,
    onOpenLink,
  });

  const scopeRef = useRef<ActionScopeValue | null>(null);
  const frameAction = useRef<BoundAction | null>(null);
  const actionOptions = useRef({
    value,
    readonly,
    onExport,
    onPresent,
    controller,
  });
  actionOptions.current = { value, readonly, onExport, onPresent, controller };
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
    actions.register({
      id: 'document.presentation',
      label: { zh: '演示', en: 'Present' },
      category: 'document',
      effect: 'view',
      getState: () => ({
        visible: !!actionOptions.current.onPresent,
        enabled:
          !!actionOptions.current.onPresent &&
          !!actionOptions.current.controller,
      }),
      execute: async () =>
        (await actionOptions.current.onPresent?.()) ?? { status: 'completed' },
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
  }, [pageActions, controller, readonly, onExport, onPresent]);
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
  actionHandlers.current = {
    find: () => openFind('find'),
    'find-replace': () => openFind('replace'),
    'link-dialog': () => {
      if (linkHost && controllerRef.current)
        requestDocumentLink(linkHost, controllerRef.current);
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
    const Icon = menuIcons[id] ?? Table2;
    const shortcut = action?.shortcuts
      ?.map((key) => formatActionShortcut(key))
      .join(' / ');
    return (
      <button
        type="button"
        key={id}
        disabled={!state?.enabled}
        data-action-id={`document.${id}`}
        aria-label={label}
        data-group-start={
          id === 'command-palette' ||
          id === 'export-json' ||
          (id === 'undo' && !readonly)
            ? ''
            : undefined
        }
        aria-pressed={state?.checked}
        onClick={() => {
          close();
          void action?.execute(args, { source: 'menu' });
        }}
      >
        <Icon size={16} strokeWidth={1.75} aria-hidden />
        <span>{label}</span>
        {shortcut && <kbd aria-hidden>{shortcut}</kbd>}
      </button>
    );
  };
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
        <div className="document-page__body">
          <aside
            className={`document-page__toc${tocOpen ? '' : ' is-collapsed'}`}
            aria-label={t.toc}
          >
            <div className="document-page__toc-header">
              {tocOpen && <span>{t.toc}</span>}
              <button
                type="button"
                className="doc-toolbar__btn document-page__toc-toggle"
                aria-controls={tocId}
                aria-expanded={tocOpen}
                aria-label={tocOpen ? t.tocHide : t.tocShow}
                title={tocOpen ? t.tocHide : t.tocShow}
                onClick={() => invoke('toggle-toc')}
              >
                {tocOpen ? (
                  <PanelLeftClose strokeWidth={1.75} size={16} />
                ) : (
                  <PanelLeftOpen strokeWidth={1.75} size={16} />
                )}
              </button>
            </div>
            <div
              id={tocId}
              className="document-page__toc-list"
              hidden={!tocOpen}
            >
              {tocOpen && headings.length === 0 && (
                <div className="document-page__toc-empty">{t.tocEmpty}</div>
              )}
              {tocOpen &&
                headings.map((item, index) => (
                  <button
                    key={`${item.pos}-${index}`}
                    type="button"
                    className="document-page__toc-item"
                    style={{ paddingLeft: `${8 + (item.level - 1) * 14}px` }}
                    title={item.text || t.untitledHeading}
                    onClick={() =>
                      controllerRef.current?.locateHeading(item.pos)
                    }
                  >
                    {item.text || t.untitledHeading}
                  </button>
                ))}
            </div>
          </aside>
          <div className="document-page__main">
            <header className="document-page__header">
              <div className="doc-toolbar" role="toolbar" aria-label="document">
                {!readonly && (
                  <div className="doc-toolbar__edit">
                    {toolbar?.inTable && (
                      <DocumentToolbarMenu
                        label={t.tableActions}
                        onOpen={captureMenu}
                      >
                        {(close) =>
                          [
                            ['add-row-before', t.addRowBefore],
                            ['add-row-after', t.addRow],
                            ['add-column-before', t.addColBefore],
                            ['add-column-after', t.addCol],
                            ['delete-row', t.delRow],
                            ['delete-column', t.delCol],
                            ['toggle-header-row', t.headerRow],
                            ['toggle-header-column', t.headerCol],
                            ['delete-table', t.delTable],
                          ].map(([id, label]) => menuItem(id, label, close))
                        }
                      </DocumentToolbarMenu>
                    )}
                  </div>
                )}
                <div className="doc-toolbar__actions">
                  {showSaveStatus && (
                    <DocumentSaveStatus state={saveState} locale={locale} />
                  )}

                  <DocumentFindBar
                    key={value.id}
                    controller={controller}
                    mode={findOpen}
                    locale={locale}
                    readonly={readonly}
                    inputRef={findInputRef}
                    onMode={setFindOpen}
                    onClose={closeFind}
                  />
                  {!findOpen && (
                    <ToolbarButton
                      title={t.find}
                      onClick={() => invoke('find')}
                      icon={Search}
                    />
                  )}
                  {onPresent && (
                    <ToolbarButton
                      title={locale === 'zh' ? '演示' : 'Present'}
                      actionId="document.presentation"
                      icon={Presentation}
                    />
                  )}

                  <DocumentToolbarMenu
                    label={locale === 'zh' ? '文档' : 'Document'}
                    iconOnly
                    secondary={
                      readonly
                        ? undefined
                        : {
                            label: locale === 'zh' ? '插入' : 'Insert',
                            render: (close) =>
                              documentInsertActions.map(([id, zh, en]) =>
                                menuItem(id, locale === 'zh' ? zh : en, close),
                              ),
                          }
                    }
                    onOpen={captureMenu}
                    buttonRef={(node) => {
                      commandButton.current = node;
                      shortcutsButton.current = node;
                    }}
                  >
                    {(close) => (
                      <>
                        {menuItem('undo', t.undo, close)}
                        {menuItem('redo', t.redo, close)}
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
                            {menuItem(
                              'export-markdown',
                              t.exportMarkdown,
                              close,
                            )}
                          </>
                        )}
                      </>
                    )}
                  </DocumentToolbarMenu>
                </div>
              </div>
              {framePickerOpen && !readonly && (
                <div
                  className="doc-frame-picker"
                  role="dialog"
                  aria-label={locale === 'zh' ? '插入图表' : 'Insert canvas'}
                >
                  <button
                    type="button"
                    onClick={() => setFramePickerOpen(false)}
                  >
                    {locale === 'zh' ? '取消' : 'Cancel'}
                  </button>
                  <input
                    aria-label={
                      locale === 'zh' ? '搜索图表' : 'Search canvases'
                    }
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
                          void frameAction.current
                            ?.execute(frame.frameId, {
                              source: 'toolbar',
                            })
                            .then((result) => {
                              if (
                                result.status !== 'completed' &&
                                result.status !== 'noop'
                              )
                                setNotice(
                                  locale === 'zh'
                                    ? '编辑位置已变化，请重新插入图表'
                                    : 'The insertion point changed. Insert the canvas again.',
                                );
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
            </header>
            <div
              className="document-page__content"
              role="region"
              aria-label={title || t.untitled}
            >
              <DocumentEditor
                locale={locale}
                referenceChoices={referenceChoices}
                selectionLinkOpen={!!findOpen || framePickerOpen}
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
                captureInsertionScope={captureInsertionScope}
                onInsertionError={onInsertionError ?? setNotice}
                onPickFrame={
                  frameChoices
                    ? (insert) => {
                        frameAction.current = insert;
                        setFrameQuery('');
                        setFramePickerOpen(true);
                      }
                    : undefined
                }
              />
            </div>
            <footer className="document-page__status">
              <span>
                {charCount} {t.chars}
              </span>
            </footer>
          </div>
        </div>

        {notice && (
          <div className="document-page__notice" role="status">
            {notice}
            <button type="button" onClick={() => setNotice(null)}>
              <X strokeWidth={1.75} size={14} />
            </button>
          </div>
        )}
      </div>
    </ActionScope>
  );
}
