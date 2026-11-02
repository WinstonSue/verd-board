import { createPortal } from 'react-dom';
import { useContext } from 'react';
import { DocumentResourcesContext } from './document-resources';
import katex from 'katex';
import { validateRichContent } from './document-rich-content';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EditorContent, useEditor, getSchema } from '@tiptap/react';
import { DocumentFrameReferenceContext } from './document-frame-reference';
import { Selection, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { ActionResult, BoardTextDocument } from '@sue/board-common';
import {
  ActionScope,
  matchesActionShortcut,
  resolveActionShortcut,
  type ActionSource,
} from '@sue/board-react-actions';
import { createDocumentExtensions } from '../../constants/editor-config';
import { documentFromEditor } from '../../utils/controller';
import { safeFocus } from '../../utils/measure';
import { createDocumentController } from './document-controller';
import { DocumentGroupTracker } from './document-groups';
import type {
  DocumentChangeSource,
  DocumentChangeReceipt,
  DocumentEditorController,
  DocumentEditorProps,
  DocumentSelection,
} from '../../types/document';
import './document-editor.scss';
import '../../styles/content.scss';

const RESTORE_META = 'verd-document-restore';
// History and placeholder options do not change the standalone document schema.
// Validation can share it while each editor keeps its own runtime and plugins.
let validationSchema: ReturnType<typeof getSchema> | undefined;
const getValidationSchema = () =>
  (validationSchema ??= getSchema(createDocumentExtensions()));
const emptyActions: ActionSource = {
  actions: () => [],
  subscribe: () => () => {},
  revision: 0,
  getActionState: () => ({ visible: false, enabled: false }),
};
const receiptResult = (receipt: DocumentChangeReceipt): ActionResult => {
  if (!receipt) return { status: 'completed' };
  if ('status' in receipt) return receipt;
  return receipt.ok
    ? { status: 'completed' }
    : {
        status: 'rejected',
        code: 'host-rejected',
        message: receipt.diagnostics?.map((item) => item.message).join('; '),
      };
};

let changeSeq = 0;
const nextChangeId = () => `doc-change-${++changeSeq}`;

export const DocumentEditor: React.FC<DocumentEditorProps> = ({
  value,
  readonly = false,
  history,
  onChange,
  onReady,
  restore,
  placeholder,
  autoFocus = true,
  className,
  onImageFile,
  renderFrameReference,
  folding: suppliedFolding,
  foldingKey,
  onAttachmentFile,
  renderAttachment,
  renderWebEmbed,
}) => {
  const [mathEdit, setMathEdit] = useState<{
    latex: string;
    pos: number;
    block: boolean;
    original: string;
    documentId: string;
    insertion?: { to: number; revision: unknown };
  } | null>(null);
  const readonlyRef = useRef(readonly);
  readonlyRef.current = readonly;
  const [webEdit, setWebEdit] = useState<{
    url: string;
    title: string;
    caption: string;
    from: number;
    to: number;
    revision: unknown;
    documentId: string;
  } | null>(null);
  const inheritedResources = useContext(DocumentResourcesContext);
  const resources = useMemo(
    () => ({
      ...inheritedResources,
      ...(onAttachmentFile ? { store: onAttachmentFile } : {}),
      ...(renderAttachment ? { renderAttachment } : {}),
      ...(renderWebEmbed ? { renderWebEmbed } : {}),
    }),
    [inheritedResources, onAttachmentFile, renderAttachment, renderWebEmbed],
  );
  const resourceInput = useRef<HTMLInputElement>(null);
  const folding =
    suppliedFolding ?? resources.foldingFor?.(foldingKey ?? value.id);
  const schema = useMemo(getValidationSchema, []);
  const localHistory = !history;
  const extensions = useMemo(
    () =>
      createDocumentExtensions({
        history: localHistory,
        placeholder,
        folding,
        onMathEdit: (latex, pos, block) =>
          !readonlyRef.current &&
          setMathEdit({
            latex,
            pos,
            block,
            original: latex,
            documentId: originalElementRef.current.id,
          }),
      }),
    [localHistory, placeholder, folding],
  );
  const contentError = useMemo(() => {
    try {
      validateRichContent(value.content);
      schema.nodeFromJSON(value.content).check();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [schema, value.content]);
  const contentErrorRef = useRef(contentError);
  contentErrorRef.current = contentError;
  const containerRef = useRef<HTMLDivElement>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [blockNotice, setBlockNotice] = useState('');
  const slashBindings = useRef(
    new Map<string, import('@sue/board-common').BoundAction>(),
  );
  const [slashQuery, setSlashQuery] = useState('');
  const originalElementRef = useRef<BoardTextDocument>(value);
  /** JSON of the content the editor currently reflects (echo suppression). */
  const baselineJsonRef = useRef<string | undefined>(undefined);
  if (baselineJsonRef.current === undefined)
    baselineJsonRef.current = JSON.stringify(value.content);
  const baselineEditorDocument = useRef<unknown>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const historyRef = useRef(history);
  historyRef.current = history;
  const onImageFileRef = useRef(onImageFile);
  onImageFileRef.current = onImageFile;

  const controllerRef = useRef<DocumentEditorController | null>(null);
  const [actionSource, setActionSource] =
    useState<DocumentEditorController | null>(null);
  const pendingChanges = useRef(new Set<Promise<ActionResult>>());
  const acknowledged = useRef({
    sequence: 0,
    result: { status: 'completed' } as ActionResult,
  });
  const emissionSequence = useRef(0);
  const pendingSourceRef = useRef<DocumentChangeSource | null>(null);
  const lastSelectionRef = useRef<DocumentSelection>({
    from: 0,
    to: 0,
    collapsed: true,
  });
  const groupTrackerRef = useRef<DocumentGroupTracker | null>(null);
  if (!groupTrackerRef.current)
    groupTrackerRef.current = new DocumentGroupTracker();
  const composingRef = useRef(false);
  const historyScope = useRef(crypto.randomUUID());
  const compositionEndedAtRef = useRef(0);
  const lastRestoreRef = useRef(-1);

  /** Source-tagged commands keep their label across appended transactions. */
  const withSource = (source: DocumentChangeSource, run: () => void) => {
    pendingSourceRef.current = source;
    try {
      run();
    } finally {
      const tagged = source;
      queueMicrotask(() => {
        if (pendingSourceRef.current === tagged)
          pendingSourceRef.current = null;
      });
    }
  };

  /**
   * Async image insertion. The position is captured at event time so the
   * image lands where the user pasted/dropped — inside this editor, never
   * whatever tab happens to be active when the file finishes reading.
   */
  const insertImageFile = (file: File, position: number) => {
    if (!file.type.startsWith('image/') && resources.store) {
      const target = editor;
      const original = target?.state.doc;
      setBlockNotice('正在保存附件…');
      void resources
        .store(file)
        .then((attrs) => {
          if (
            !target ||
            target.isDestroyed ||
            !target.isEditable ||
            target.state.doc !== original
          ) {
            setBlockNotice('编辑位置已变化，请重新插入附件');
            return;
          }
          target
            .chain()
            .focus()
            .insertContentAt(position, { type: 'attachment', attrs })
            .run();
          setBlockNotice('');
        })
        .catch((error) =>
          setBlockNotice(
            error instanceof Error ? error.message : String(error),
          ),
        );
      return true;
    }
    const resolver = onImageFileRef.current;
    if (!resolver || !file.type.startsWith('image/')) return false;
    const action = controllerRef.current
      ?.actions()
      .find((item) => item.id === 'document.insert-image')
      ?.capture();
    void resolver(file)
      .then((src) => {
        const editor_ = editor;
        if (!src || !editor_ || editor_.isDestroyed || !editor_.isEditable)
          return;
        const at = Math.max(
          0,
          Math.min(position, editor_.state.doc.content.size),
        );
        void action?.execute({ src, position: at }, { source: 'native' });
      })
      .catch(() => undefined);
    return true;
  };

  const selectionOf = (
    editor_: NonNullable<ReturnType<typeof useEditor>>,
  ): DocumentSelection => {
    const { from, to } = editor_.state.selection;
    return { from, to, collapsed: from === to };
  };

  const groupFor = (
    source: DocumentChangeSource,
    transaction: Transaction,
  ): string => groupTrackerRef.current!.groupFor(source, transaction);

  const emitChange = (
    editor_: NonNullable<ReturnType<typeof useEditor>>,
    transaction: Transaction,
  ) => {
    const oc = onChangeRef.current;
    if (!oc || contentErrorRef.current) return;
    const newText: BoardTextDocument = {
      ...documentFromEditor(editor_, originalElementRef.current),
      kind: 'block',
      id: originalElementRef.current.id,
    };
    originalElementRef.current = newText;
    baselineJsonRef.current = JSON.stringify(newText.content);
    baselineEditorDocument.current = editor_.state.doc;
    const source =
      pendingSourceRef.current ??
      (composingRef.current || Date.now() - compositionEndedAtRef.current < 100
        ? 'composition'
        : 'input');
    const selectionAfter = selectionOf(editor_);
    const change = {
      value: newText,
      changeId: nextChangeId(),
      source,
      historyGroup: `${historyScope.current}:${groupFor(source, transaction)}`,
      selectionBefore: lastSelectionRef.current,
      selectionAfter,
    };
    const sequence = ++emissionSequence.current;
    let work: Promise<ActionResult>;
    try {
      work = Promise.resolve(oc(change)).then(receiptResult);
    } catch (error) {
      work = Promise.reject(error);
    }
    work = work.catch((error): ActionResult => ({
      status: 'failed',
      code: 'host-commit-failed',
      message: error instanceof Error ? error.message : String(error),
    }));
    pendingChanges.current.add(work);
    void work.then((result) => {
      pendingChanges.current.delete(work);
      if (sequence >= acknowledged.current.sequence)
        acknowledged.current = { sequence, result };
    });
    lastSelectionRef.current = selectionAfter;
  };

  const emitChangeRef = useRef(emitChange);
  emitChangeRef.current = emitChange;

  /**
   * Replays content without producing a change event or history — used by
   * undo/redo, adopt-disk and external sync.
   */
  const applyExternal = useCallback(
    (
      editor_: NonNullable<ReturnType<typeof useEditor>>,
      doc: BoardTextDocument,
      selection?: DocumentSelection,
    ) => {
      if (editor_.isDestroyed) return;
      try {
        const node = editor_.schema.nodeFromJSON(doc.content);
        const tr = editor_.state.tr;
        tr.replaceWith(0, tr.doc.content.size, node.content);
        tr.setMeta('preventUpdate', true);
        tr.setMeta('addToHistory', false);
        tr.setMeta(RESTORE_META, true);
        const max = tr.doc.content.size;
        const from = Math.max(
          0,
          Math.min(selection?.from ?? editor_.state.selection.from, max),
        );
        const to = Math.max(
          from,
          Math.min(selection?.to ?? editor_.state.selection.to, max),
        );
        try {
          tr.setSelection(TextSelection.create(tr.doc, from, to));
        } catch {
          tr.setSelection(Selection.near(tr.doc.resolve(from), -1));
        }
        editor_.view.dispatch(tr);
        originalElementRef.current = doc;
        baselineJsonRef.current = JSON.stringify(doc.content);
        baselineEditorDocument.current = editor_.state.doc;
        acknowledged.current = {
          sequence: ++emissionSequence.current,
          result: { status: 'completed' },
        };
        lastSelectionRef.current = selectionOf(editor_);
        groupTrackerRef.current!.externalRestore();
      } catch {
        // Invalid content stays untouched; the workspace layer reports it.
      }
    },
    [],
  );

  const editor = useEditor(
    {
      extensions,
      content: contentError
        ? { type: 'doc', content: [{ type: 'paragraph' }] }
        : originalElementRef.current.content,
      editable: !readonly && !contentError,
      editorProps: {
        attributes: { class: 'board-document-content' },
        handleKeyDown: (view, event) => {
          if (view.composing) return false;
          if (
            event.key === '/' &&
            view.editable &&
            view.state.selection.$from.parent.type.name === 'paragraph' &&
            !view.state.selection.$from.parent.textContent
          ) {
            setSlashQuery('');
            setBlockNotice('');
            slashBindings.current = new Map(
              (controllerRef.current?.actions() ?? []).map((action) => [
                action.id,
                action.capture(),
              ]),
            );
            setSlashOpen(true);
            return true;
          }
          const actions = controllerRef.current?.actions() ?? [];
          const resolution = resolveActionShortcut(actions, event);
          if (resolution.status === 'matched') {
            event.preventDefault();
            void resolution.action
              .capture()
              .execute(undefined, { source: 'shortcut' });
            return true;
          }
          if (
            resolution.status === 'conflict' ||
            actions.some((action) =>
              action.shortcuts?.some((shortcut) =>
                matchesActionShortcut(event, shortcut),
              ),
            )
          )
            return true;
          if (event.key === 'Enter') groupTrackerRef.current!.breakStructural();
          return false;
        },
        handlePaste: (view, event) => {
          const file = event.clipboardData?.files[0];
          if (file && insertImageFile(file, view.state.selection.from))
            return true;
          const pasted = event.clipboardData?.getData('text/plain').trim();
          if (
            pasted &&
            /^https:\/\/\S+$/.test(pasted) &&
            !readonlyRef.current
          ) {
            setWebEdit({
              url: pasted,
              title: '',
              caption: '',
              from: view.state.selection.from,
              to: view.state.selection.to,
              revision: view.state.doc,
              documentId: originalElementRef.current.id,
            });
            return true;
          }
          pendingSourceRef.current = 'paste';
          queueMicrotask(() => {
            if (pendingSourceRef.current === 'paste')
              pendingSourceRef.current = null;
          });
          return false;
        },
        handleDrop: (view, event) => {
          const file = event.dataTransfer?.files[0];
          if (!file) {
            pendingSourceRef.current = 'drop';
            queueMicrotask(() => {
              if (pendingSourceRef.current === 'drop')
                pendingSourceRef.current = null;
            });
            return false;
          }
          const at = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          return insertImageFile(file, at?.pos ?? view.state.selection.from);
        },
        handleDOMEvents: {
          compositionstart: () => {
            composingRef.current = true;
            groupTrackerRef.current!.compositionStart();
          },
          compositionend: () => {
            composingRef.current = false;
            compositionEndedAtRef.current = Date.now();
            groupTrackerRef.current!.compositionEnd();
          },
        },
      },
      onUpdate: ({ editor: editor_, transaction }) => {
        // Restores carry `preventUpdate` + RESTORE_META and never land here.
        emitChange(editor_, transaction);
      },
      onSelectionUpdate: ({ editor: editor_, transaction }) => {
        lastSelectionRef.current = selectionOf(editor_);
        if (!transaction.docChanged) {
          // An explicit caret move ends the current typing group.
          groupTrackerRef.current!.breakInputGroup();
        }
      },
      onBlur: () => {
        groupTrackerRef.current!.breakInputGroup();
      },
    },
    [originalElementRef.current.id],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const localHistory = () =>
      typeof editor.commands.undo === 'function' &&
      typeof editor.commands.redo === 'function';
    baselineEditorDocument.current = editor.state.doc;
    const controller = createDocumentController(editor, {
      onMathInsert: (block) => {
        const { from, to } = editor.state.selection;
        setMathEdit({
          latex: editor.state.doc.textBetween(from, to),
          pos: from,
          block,
          original: '',
          documentId: originalElementRef.current.id,
          insertion: { to, revision: editor.state.doc },
        });
      },
      withSource,
      getBaseDocument: () => originalElementRef.current,
      flushEditing: async () => {
        if (editor.isDestroyed)
          return { status: 'cancelled', code: 'scope-disposed' };
        if (composingRef.current || editor.view.composing)
          return { status: 'rejected', code: 'composition-active' };
        await Promise.resolve();
        if (editor.state.doc !== baselineEditorDocument.current)
          withSource('flush', () =>
            emitChangeRef.current(editor, editor.state.tr),
          );
        while (pendingChanges.current.size)
          await Promise.all([...pendingChanges.current]);
        return acknowledged.current.result;
      },
      undo: () => {
        if (historyRef.current) return historyRef.current.undo();
        else if (localHistory()) editor.commands.undo();
      },
      redo: () => {
        if (historyRef.current) return historyRef.current.redo();
        else if (localHistory()) editor.commands.redo();
      },
      canUndo: () =>
        historyRef.current
          ? historyRef.current.canUndo()
          : localHistory() && editor.can().undo(),
      canRedo: () =>
        historyRef.current
          ? historyRef.current.canRedo()
          : localHistory() && editor.can().redo(),
    });
    controllerRef.current = controller;
    setActionSource(controller);
    onReadyRef.current?.(controller);
    return () => {
      controllerRef.current = null;
      onReadyRef.current?.(null);
    };
  }, [editor]);

  // Explicit replays (undo/redo, adopt-disk) land through `restore.revision`.
  useEffect(() => {
    if (!editor || !restore) return;
    if (restore.revision <= lastRestoreRef.current) return;
    lastRestoreRef.current = restore.revision;
    applyExternal(editor, value, restore.selection);
  }, [restore, editor, value, applyExternal]);

  // Non-replay content changes (external sync, imports) are adopted silently.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const incoming = JSON.stringify(value.content);
    if (incoming === baselineJsonRef.current) {
      originalElementRef.current = value;
      return;
    }
    applyExternal(editor, value);
  }, [value, editor, applyExternal]);

  useEffect(() => {
    if (editor) editor.setEditable(!readonly && !contentError, false);
  }, [readonly, editor, contentError]);

  useEffect(() => {
    if (!readonly && autoFocus && editor) {
      const timer = setTimeout(() => {
        if (!editor.isDestroyed && !editor.isFocused) safeFocus(editor);
      }, 120);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [readonly, autoFocus, editor]);

  if (contentError)
    return (
      <div className="board-document-error" role="alert">
        无法打开文档正文：{contentError}
      </div>
    );
  if (!editor) {
    return (
      <div ref={containerRef} className="board-document-editor loading">
        {value.plainText}
      </div>
    );
  }

  return (
    <ActionScope registry={actionSource ?? emptyActions}>
      <DocumentResourcesContext.Provider value={resources}>
        <div
          ref={containerRef}
          className={`board-document-editor${readonly ? ' readonly' : ''}${
            className ? ` ${className}` : ''
          }`}
        >
          <DocumentFrameReferenceContext.Provider value={renderFrameReference}>
            {!readonly && (
              <div className="document-resource-tools">
                <input
                  ref={resourceInput}
                  type="file"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      insertImageFile(file, editor.state.selection.from);
                    e.target.value = '';
                  }}
                />
                {resources.store && (
                  <button
                    type="button"
                    onClick={() => resourceInput.current?.click()}
                  >
                    插入附件
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setWebEdit({
                      url: '',
                      title: '',
                      caption: '',
                      from: editor.state.selection.from,
                      to: editor.state.selection.to,
                      revision: editor.state.doc,
                      documentId: originalElementRef.current.id,
                    });
                  }}
                >
                  插入网页
                </button>
              </div>
            )}
            {!readonly && (
              <details className="document-block-menu">
                <summary>段落操作</summary>
                {[
                  ['block-up', '上移'],
                  ['block-down', '下移'],
                  ['block-duplicate', '复制'],
                  ['block-delete', '删除'],
                  ['anchor-block', '复制此段链接'],
                ].map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      void controllerRef.current?.executeAction(
                        'document.' + id,
                      );
                    }}
                  >
                    {label}
                  </button>
                ))}
              </details>
            )}
            {slashOpen && !readonly && (
              <div
                role="menu"
                tabIndex={-1}
                aria-label="插入内容"
                className="document-slash-menu"
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (
                    ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
                  ) {
                    event.preventDefault();
                    const buttons = [
                      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                        'button',
                      ),
                    ];
                    const current = buttons.indexOf(
                      document.activeElement as HTMLButtonElement,
                    );
                    const index =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? buttons.length - 1
                          : event.key === 'ArrowDown'
                            ? (current + 1) % buttons.length
                            : (current - 1 + buttons.length) % buttons.length;
                    buttons[index]?.focus();
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setSlashOpen(false);
                    editor?.commands.focus();
                  }
                }}
              >
                <input
                  ref={(node) => {
                    if (
                      node &&
                      document.activeElement?.closest(
                        '.document-slash-menu',
                      ) !== node.parentElement
                    )
                      node.focus();
                  }}
                  aria-label="搜索内容块"
                  value={slashQuery}
                  onChange={(event) => setSlashQuery(event.target.value)}
                />
                {(
                  [
                    ['set-paragraph', '正文', undefined],
                    ['set-heading', '一级标题', 1],
                    ['set-heading', '二级标题', 2],
                    ['toggle-bullet-list', '无序列表', undefined],
                    ['toggle-ordered-list', '有序列表', undefined],
                    ['toggle-blockquote', '引用', undefined],
                    ['toggle-code-block', '代码块', undefined],
                    ['wrap-details', '折叠块', undefined],
                    ['unwrap-details', '取消折叠块', undefined],
                    ['insert-inline-math', '行内公式', undefined],
                    ['insert-block-math', '公式块', undefined],
                    ['insert-table', '表格', undefined],
                    ['insert-horizontal-rule', '分隔线', undefined],
                  ] as const
                )
                  .filter(([, label]) => label.includes(slashQuery))
                  .map(([id, label, args]) => (
                    <button
                      key={label}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        void slashBindings.current
                          .get('document.' + id)
                          ?.execute(args)
                          .then((result) => {
                            if (
                              result.status === 'completed' ||
                              result.status === 'noop'
                            ) {
                              setSlashOpen(false);
                              editor?.commands.focus();
                            } else
                              setBlockNotice(
                                'code' in result ? result.code : '执行失败',
                              );
                          });
                      }}
                    >
                      {label}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => {
                    setSlashOpen(false);
                    editor?.commands.focus();
                  }}
                >
                  取消
                </button>
              </div>
            )}
            {blockNotice && <p role="status">{blockNotice}</p>}
            {webEdit &&
              createPortal(
                <div
                  role="dialog"
                  aria-label="插入网页"
                  className="document-math-dialog"
                >
                  <label>
                    HTTPS 地址
                    <input
                      value={webEdit.url}
                      onChange={(e) =>
                        setWebEdit({ ...webEdit, url: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    标题
                    <input
                      value={webEdit.title}
                      onChange={(e) =>
                        setWebEdit({ ...webEdit, title: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    说明
                    <textarea
                      value={webEdit.caption}
                      onChange={(e) =>
                        setWebEdit({ ...webEdit, caption: e.target.value })
                      }
                    />
                  </label>
                  {['普通链接', '书签卡片', '嵌入'].map((label, index) => (
                    <button
                      type="button"
                      key={label}
                      onClick={() => {
                        try {
                          const url = new URL(webEdit.url);
                          if (
                            url.protocol !== 'https:' ||
                            url.username ||
                            url.password ||
                            url.origin === location.origin
                          )
                            throw new Error('请输入外部 HTTPS 地址');
                          if (
                            webEdit.documentId !==
                              originalElementRef.current.id ||
                            webEdit.revision !== editor.state.doc ||
                            !editor.isEditable
                          )
                            throw new Error('编辑位置已变化，请重新插入');
                          const title = webEdit.title || url.hostname;
                          withSource('insert', () =>
                            editor
                              .chain()
                              .focus()
                              .insertContentAt(
                                { from: webEdit.from, to: webEdit.to },
                                index === 0
                                  ? {
                                      type: 'text',
                                      text: title,
                                      marks: [
                                        {
                                          type: 'link',
                                          attrs: { href: url.href },
                                        },
                                      ],
                                    }
                                  : {
                                      type: 'webEmbed',
                                      attrs: {
                                        url: url.href,
                                        title,
                                        caption: webEdit.caption,
                                        display: index === 1 ? 'card' : 'embed',
                                      },
                                    },
                              )
                              .run(),
                          );
                          setWebEdit(null);
                        } catch (error) {
                          setBlockNotice(String(error));
                        }
                      }}
                    >
                      {label}
                    </button>
                  ))}
                  <button type="button" onClick={() => setWebEdit(null)}>
                    取消
                  </button>
                </div>,
                document.body,
              )}
            {mathEdit &&
              createPortal(
                <div
                  role="dialog"
                  aria-label="编辑公式"
                  className="document-math-dialog"
                >
                  <label>
                    LaTeX
                    <textarea
                      value={mathEdit.latex}
                      onChange={(e) =>
                        setMathEdit({ ...mathEdit, latex: e.target.value })
                      }
                    />
                  </label>
                  <div
                    dangerouslySetInnerHTML={{
                      __html: katex.renderToString(mathEdit.latex, {
                        displayMode: mathEdit.block,
                        throwOnError: false,
                        trust: false,
                      }),
                    }}
                  />
                  <button type="button" onClick={() => setMathEdit(null)}>
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        mathEdit.documentId !== originalElementRef.current.id ||
                        !editor.isEditable
                      ) {
                        setMathEdit(null);
                        return;
                      }
                      if (mathEdit.insertion) {
                        if (mathEdit.insertion.revision !== editor.state.doc) {
                          setBlockNotice('正文已变化，请重新插入公式');
                          return;
                        }
                        if (!mathEdit.latex.trim()) return;
                        withSource('insert', () =>
                          editor
                            .chain()
                            .focus()
                            .insertContentAt(
                              {
                                from: mathEdit.pos,
                                to: mathEdit.insertion!.to,
                              },
                              {
                                type: mathEdit.block
                                  ? 'blockMath'
                                  : 'inlineMath',
                                attrs: { latex: mathEdit.latex },
                              },
                            )
                            .run(),
                        );
                        setMathEdit(null);
                        return;
                      }
                      const node = editor.state.doc.nodeAt(mathEdit.pos);
                      if (
                        node?.type.name ===
                          (mathEdit.block ? 'blockMath' : 'inlineMath') &&
                        node.attrs['latex'] === mathEdit.original &&
                        editor.isEditable
                      ) {
                        editor.view.dispatch(
                          editor.state.tr.setNodeMarkup(
                            mathEdit.pos,
                            undefined,
                            {
                              ...node.attrs,
                              latex: mathEdit.latex,
                            },
                          ),
                        );
                        setMathEdit(null);
                      } else setBlockNotice('公式已变化，请重新打开编辑');
                    }}
                  >
                    确认
                  </button>
                </div>,
                document.body,
              )}
            <EditorContent editor={editor} />
          </DocumentFrameReferenceContext.Provider>
        </div>
      </DocumentResourcesContext.Provider>
    </ActionScope>
  );
};
