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
}) => {
  const schema = useMemo(getValidationSchema, []);
  const localHistory = !history;
  const extensions = useMemo(
    () => createDocumentExtensions({ history: localHistory, placeholder }),
    [localHistory, placeholder],
  );
  const contentError = useMemo(() => {
    try {
      schema.nodeFromJSON(value.content).check();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [schema, value.content]);
  const contentErrorRef = useRef(contentError);
  contentErrorRef.current = contentError;
  const containerRef = useRef<HTMLDivElement>(null);
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
          const file = [...(event.clipboardData?.files ?? [])].find((item) =>
            item.type.startsWith('image/'),
          );
          if (file && insertImageFile(file, view.state.selection.from))
            return true;
          pendingSourceRef.current = 'paste';
          queueMicrotask(() => {
            if (pendingSourceRef.current === 'paste')
              pendingSourceRef.current = null;
          });
          return false;
        },
        handleDrop: (view, event) => {
          const file = [...(event.dataTransfer?.files ?? [])].find((item) =>
            item.type.startsWith('image/'),
          );
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
      <div
        ref={containerRef}
        className={`board-document-editor${readonly ? ' readonly' : ''}${
          className ? ` ${className}` : ''
        }`}
      >
        <DocumentFrameReferenceContext.Provider value={renderFrameReference}>
          <EditorContent editor={editor} />
        </DocumentFrameReferenceContext.Provider>
      </div>
    </ActionScope>
  );
};
