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
import {
  EditorContent,
  useEditor,
  getSchema,
  type Editor,
} from '@tiptap/react';
import { DocumentFrameReferenceContext } from './document-frame-reference';
import { closeHistory } from '@tiptap/pm/history';
import { Selection, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import {
  parseWorkspaceLink,
  type ActionResult,
  type BoardTextDocument,
} from '@sue/board-common';
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
  DocumentReferenceChoice,
  DocumentSelection,
} from '../../types/document';
import {
  DocumentInsertPopover,
  type DocumentInsertSession,
} from './document-insert-popover';
import { DocumentBlockPopover } from './document-block-popover';
import { LinkEditorHost, requestDocumentLink } from '../../link-editor-host';
import './document-editor.scss';
import '../../styles/content.scss';

const RESTORE_META = 'verd-document-restore';
const INSERT_TRIGGER_META = 'verd-document-insert-trigger';
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
  locale = 'zh',
  referenceChoices,
  onEditSelectionLink,
  selectionAction,
  selectionLinkOpen,
  captureInsertionScope,
  onInsertionError,
  readonly = false,
  history,
  onChange,
  onReady,
  restore,
  placeholder,
  autoFocus = true,
  className,
  onImageFile,
  onPickFrame,
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
  const linkHost = useContext(LinkEditorHost);
  const editLinkRef = useRef<(() => void) | undefined>(undefined);
  editLinkRef.current =
    onEditSelectionLink ??
    (linkHost
      ? () => {
          const controller = controllerRef.current;
          if (controller && !readonlyRef.current)
            requestDocumentLink(linkHost, controller);
        }
      : undefined);
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
  const insertHost = useRef({
    resources,
    onImageFile,
    onPickFrame,
    captureInsertionScope,
    onInsertionError,
  });
  insertHost.current = {
    resources,
    onImageFile,
    onPickFrame,
    captureInsertionScope,
    onInsertionError,
  };
  const pickedFile = useRef<((file: File) => void) | null>(null);
  const editorInstance = useRef<Editor | null>(null);
  const folding =
    suppliedFolding ?? resources.foldingFor?.(foldingKey ?? value.id);
  const schema = useMemo(getValidationSchema, []);
  const localHistory = !history;
  const hasReferences = !!referenceChoices?.length;
  const placeholderContext = useRef({
    locale,
    references: hasReferences,
    paragraph: placeholder,
  });
  placeholderContext.current = {
    locale,
    references: hasReferences,
    paragraph: placeholder,
  };
  const extensions = useMemo(
    () =>
      createDocumentExtensions({
        history: localHistory,
        placeholderContext: () => placeholderContext.current,
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
    [localHistory, folding],
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
  const [insertPopup, setInsertPopup] = useState<DocumentInsertSession | null>(
    null,
  );
  const insertPopupRef = useRef<DocumentInsertSession | null>(null);
  const insertKeys = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  const referenceChoicesRef = useRef(referenceChoices);
  referenceChoicesRef.current = referenceChoices;
  const updateInsertPopup = useCallback(
    (session: DocumentInsertSession | null) => {
      if (session === insertPopupRef.current) return;
      insertPopupRef.current = session;
      setInsertPopup(session);
    },
    [],
  );
  const dismissInsertPopup = useCallback(
    () => updateInsertPopup(null),
    [updateInsertPopup],
  );
  const [blockNotice, setBlockNotice] = useState('');
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

  const controllerRef = useRef<ReturnType<
    typeof createDocumentController
  > | null>(null);
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
  const historyGroupOverride = useRef<{
    key: string;
    selectionBefore: DocumentSelection;
  } | null>(null);
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
  const captureFileInsertion = (
    target: NonNullable<typeof editor>,
    kind: 'image' | 'attachment',
    from: number,
    to = from,
  ) => {
    const original = target.state.doc;
    const documentId = originalElementRef.current.id;
    const { resources: currentResources, onImageFile: resolveImage } =
      insertHost.current;
    const isCurrentScope = insertHost.current.captureInsertionScope?.();
    const stale = () =>
      target.isDestroyed ||
      isCurrentScope?.() === false ||
      !target.isEditable ||
      target.state.doc !== original ||
      originalElementRef.current.id !== documentId;
    return async (file: File) => {
      try {
        if (stale()) throw new Error('编辑位置已变化，请重新插入');
        const content =
          kind === 'attachment'
            ? { type: 'attachment', attrs: await currentResources.store!(file) }
            : { type: 'image', attrs: { src: await resolveImage!(file) } };
        if (stale()) throw new Error('编辑位置已变化，请重新插入');
        if (
          content.type === 'image' &&
          !('src' in content.attrs && content.attrs.src)
        )
          return;
        withSource('insert', () => {
          if (
            !target.chain().focus().insertContentAt({ from, to }, content).run()
          )
            throw new Error('无法在当前位置插入内容');
        });
        setBlockNotice('');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (insertHost.current.onInsertionError)
          insertHost.current.onInsertionError(message);
        else setBlockNotice(message);
      }
    };
  };
  const insertImageFile = (file: File, position: number) => {
    const target = editorInstance.current;
    if (!target) return false;
    const kind = file.type.startsWith('image/') ? 'image' : 'attachment';
    if (
      kind === 'image'
        ? !onImageFileRef.current
        : !insertHost.current.resources.store
    )
      return false;
    void captureFileInsertion(target, kind, position)(file);
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
      historyGroup:
        historyGroupOverride.current?.key ??
        `${historyScope.current}:${groupFor(source, transaction)}`,
      selectionBefore:
        historyGroupOverride.current?.selectionBefore ??
        lastSelectionRef.current,
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

  const trackInsertPopup = (editor_: Editor, transaction: Transaction) => {
    const previous = insertPopupRef.current;
    const trigger = transaction.getMeta(INSERT_TRIGGER_META) as
      Pick<DocumentInsertSession, 'kind' | 'from'> | undefined;
    const session = trigger ?? previous;
    if (!session) return;
    const { doc, selection } = editor_.state;
    const from = trigger?.from ?? transaction.mapping.map(session.from, 1);
    const to = selection.from;
    if (
      !editor_.isEditable ||
      transaction.getMeta(RESTORE_META) ||
      !(selection instanceof TextSelection) ||
      !selection.empty ||
      (!trigger && previous?.isCurrent?.() === false) ||
      from >= to ||
      doc.resolve(from).parent !== selection.$from.parent ||
      doc.textBetween(from, from + 1) !==
        (session.kind === 'slash' ? '/' : '@') ||
      (!trigger && !transaction.docChanged && previous?.to !== to)
    ) {
      dismissInsertPopup();
      return;
    }
    const query = doc.textBetween(from + 1, to, '\n', '\n');
    if (query.includes('\n')) {
      dismissInsertPopup();
      return;
    }
    if (
      trigger ||
      previous?.query !== query ||
      previous.from !== from ||
      previous.to !== to
    ) {
      updateInsertPopup({
        kind: session.kind,
        from,
        to,
        query,
        isCurrent: trigger
          ? insertHost.current.captureInsertionScope?.()
          : previous?.isCurrent,
      });
    }
  };

  const executeSlash = (id: string, args?: unknown) => {
    const popup = insertPopupRef.current;
    const controller = controllerRef.current;
    if (popup?.kind !== 'slash' || !controller) return;
    dismissInsertPopup();
    void controller
      .executeSlashAction(id, args, {
        from: popup.from,
        to: popup.to,
        text: '/' + popup.query,
        isCurrent: () => popup.isCurrent?.() !== false,
      })
      .then((result) => {
        if ('code' in result) setBlockNotice(result.message ?? result.code);
      });
  };

  const insertReference = (choice: DocumentReferenceChoice) => {
    const popup = insertPopupRef.current;
    const controller = controllerRef.current;
    const isCurrent = () => {
      const target = editorInstance.current;
      return (
        !!target &&
        !target.isDestroyed &&
        target.view.hasFocus() &&
        popup?.isCurrent?.() !== false &&
        !!referenceChoicesRef.current?.some((item) => item.href === choice.href)
      );
    };
    if (
      popup?.kind !== 'reference' ||
      !controller ||
      !isCurrent() ||
      parseWorkspaceLink(choice.href)?.kind !== 'file'
    )
      return;
    dismissInsertPopup();
    void controller
      .executeAction(
        'document.insert-link',
        {
          href: choice.href,
          label: choice.title,
          replace: {
            from: popup.from,
            to: popup.to,
            text: '@' + popup.query,
            isCurrent,
          },
        },
        { source: 'menu' },
      )
      .then((result) => {
        if ('code' in result) setBlockNotice(result.message ?? result.code);
      });
  };

  const editor = useEditor(
    {
      extensions,
      content: contentError
        ? { type: 'doc', content: [{ type: 'paragraph' }] }
        : originalElementRef.current.content,
      editable: !readonly && !contentError,
      editorProps: {
        attributes: { class: 'board-document-content' },
        handleTextInput(view, from, to, text) {
          if (view.composing || composingRef.current || !view.editable)
            return false;
          if (from !== to || (text !== '/' && text !== '@')) return false;
          const { doc, selection, storedMarks } = view.state;
          const start = doc.resolve(from);
          if (!(selection instanceof TextSelection) || !selection.empty)
            return false;
          if (text === '/') {
            if (
              start.parent.type.name !== 'paragraph' ||
              start.parent.content.size !== 0
            )
              return false;
          } else if (
            !referenceChoicesRef.current?.length ||
            !start.parent.isTextblock ||
            start.parent.type.spec.code ||
            (storedMarks ?? start.marks()).some(
              (mark) => mark.type.spec.code || mark.type.name === 'link',
            ) ||
            (start.parentOffset > 0 &&
              !/\s/u.test(doc.textBetween(from - 1, from)))
          )
            return false;
          setBlockNotice('');
          view.dispatch(
            view.state.tr
              .insertText(text, from, to)
              .setMeta(INSERT_TRIGGER_META, {
                from,
                kind: text === '/' ? 'slash' : 'reference',
              }),
          );
          return true;
        },
        handleKeyDown: (view, event) => {
          if (view.composing || event.isComposing || event.keyCode === 229)
            return false;
          if (insertKeys.current?.(event)) {
            event.preventDefault();
            return true;
          }
          if (
            view.editable &&
            editLinkRef.current &&
            (event.metaKey || event.ctrlKey) &&
            !event.shiftKey &&
            !event.altKey &&
            event.key.toLowerCase() === 'k'
          ) {
            event.preventDefault();
            event.stopPropagation();
            editLinkRef.current();
            return true;
          }
          const { selection, schema } = view.state;
          if (
            view.editable &&
            event.key === 'Backspace' &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.shiftKey &&
            selection instanceof TextSelection &&
            selection.empty &&
            selection.$from.parent.type.name === 'heading' &&
            selection.$from.parent.content.size === 0
          ) {
            const { $from } = selection;
            const paragraph = schema.nodes['paragraph'];
            const index = $from.index(-1);
            if ($from.node(-1).canReplaceWith(index, index + 1, paragraph)) {
              event.preventDefault();
              withSource('format', () => {
                view.dispatch(
                  closeHistory(
                    view.state.tr.setNodeMarkup(
                      $from.before(),
                      paragraph,
                      $from.parent.attrs,
                    ),
                  ),
                );
              });
              return true;
            }
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
      onTransaction: ({ editor: editor_, transaction }) =>
        trackInsertPopup(editor_, transaction),
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
        dismissInsertPopup();
        groupTrackerRef.current!.breakInputGroup();
      },
    },
    [originalElementRef.current.id],
  );

  editorInstance.current = editor;
  useEffect(() => {
    if (editor && !editor.isDestroyed)
      editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
  }, [editor, hasReferences, locale, placeholder]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const localHistory = () =>
      typeof editor.commands.undo === 'function' &&
      typeof editor.commands.redo === 'function';
    baselineEditorDocument.current = editor.state.doc;
    const controller = createDocumentController(editor, {
      canOpenInsert: (kind) => {
        const host = insertHost.current;
        return kind === 'image'
          ? !!host.onImageFile
          : kind === 'attachment'
            ? !!host.resources.store
            : kind === 'frame'
              ? !!host.onPickFrame
              : true;
      },
      openInsert: (kind) => {
        const { from, to } = editor.state.selection;
        if (kind === 'web') {
          setWebEdit({
            url: '',
            title: '',
            caption: '',
            from,
            to,
            revision: editor.state.doc,
            documentId: originalElementRef.current.id,
          });
        } else if (kind === 'frame') {
          const action = controller
            .actions()
            .find((item) => item.id === 'document.insert-frame-reference');
          if (action) insertHost.current.onPickFrame?.(action.capture());
        } else {
          pickedFile.current = captureFileInsertion(editor, kind, from, to);
          if (resourceInput.current) {
            resourceInput.current.accept =
              kind === 'image'
                ? 'image/png,image/jpeg,image/webp,image/gif'
                : '';
            resourceInput.current.click();
          }
        }
      },
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
      withHistoryGroup(run) {
        groupTrackerRef.current!.breakInputGroup();
        historyGroupOverride.current = {
          key: `${historyScope.current}:${nextChangeId()}`,
          selectionBefore: selectionOf(editor),
        };
        try {
          run();
        } finally {
          historyGroupOverride.current = null;
        }
      },
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
    if (readonly || contentError) updateInsertPopup(null);
  }, [readonly, editor, contentError, updateInsertPopup]);

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
              <input
                ref={resourceInput}
                type="file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  const request = pickedFile.current;
                  pickedFile.current = null;
                  event.target.value = '';
                  if (file) request?.(file);
                }}
              />
            )}
            <DocumentBlockPopover
              editor={editor}
              controller={actionSource}
              readonly={readonly}
              locale={locale}
              onNotice={setBlockNotice}
              onEditLink={editLinkRef.current}
              selectionAction={selectionAction}
              suspended={
                selectionLinkOpen || !!insertPopup || !!webEdit || !!mathEdit
              }
            />
            {insertPopup && !readonly && (
              <DocumentInsertPopover
                key={insertPopup.kind}
                editor={editor}
                session={insertPopup}
                locale={locale}
                choices={referenceChoices}
                actions={actionSource?.actions()}
                dismiss={dismissInsertPopup}
                executeSlash={executeSlash}
                insertReference={insertReference}
                insertKeys={insertKeys}
              />
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
