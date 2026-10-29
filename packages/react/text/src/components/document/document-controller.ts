import type { Editor } from '@tiptap/react';
import {
  Alignment,
  createActionRegistry,
  type ActionResult,
  type ActionShortcut,
  type BoardTextMarks,
  BoardTextDocument,
  deriveBoardTextPlainText,
} from '@sue/board-common';
import type {
  DocumentChangeSource,
  DocumentSelection,
  DocumentEditorController,
  DocumentHeading,
  DocumentSearchMatch,
  DocumentSearchOptions,
  DocumentToolbarState,
} from '../../types/document';
import {
  activeEditorTextColor,
  documentFromEditor,
} from '../../utils/controller';
import { findInDocument } from './document-search';
import { createDocumentHeadingSlugger } from '../../utils/heading-slug';

interface ControllerOptions {
  /** Tags the next emitted change (format/insert/replace) for history. */
  withSource(source: DocumentChangeSource, run: () => void): void;
  /** Latest document — commits must not spread stale doc-level fields. */
  getBaseDocument(): BoardTextDocument;
  undo(): void | Promise<unknown>;
  redo(): void | Promise<unknown>;
  canUndo(): boolean;
  canRedo(): boolean;
  flushEditing?(): Promise<ActionResult>;
}

type DocumentCommandName =
  | 'toggleBold'
  | 'toggleItalic'
  | 'toggleUnderline'
  | 'toggleStrike'
  | 'toggleCode'
  | 'toggleSuperscript'
  | 'toggleSubscript'
  | 'setParagraph'
  | 'setHeading'
  | 'toggleBlockquote'
  | 'toggleCodeBlock'
  | 'toggleBulletList'
  | 'toggleOrderedList'
  | 'setTextAlign'
  | 'insertHorizontalRule'
  | 'insertTable'
  | 'addTableRowBefore'
  | 'addTableRowAfter'
  | 'addTableColumnBefore'
  | 'addTableColumnAfter'
  | 'deleteTableRow'
  | 'deleteTableColumn'
  | 'deleteTable'
  | 'toggleTableHeaderRow'
  | 'toggleTableHeaderColumn'
  | 'toggleTableHeaderCell'
  | 'clearFormatting'
  | 'undo'
  | 'redo';

interface DocumentCommands {
  focus(position?: 'start' | 'end' | 'preserve'): void;
  /** Emits any pending change and returns the current document. */
  commit(): BoardTextDocument;
  getDocument(): BoardTextDocument;
  getSelection(): DocumentSelection | null;

  toggleMark(
    mark:
      | keyof Pick<
          BoardTextMarks,
          'bold' | 'italic' | 'underline' | 'strike' | 'code'
        >
      | 'superscript'
      | 'subscript',
  ): void;
  setTextColor(color: string | null): void;
  setFontSize(size: string | null): void;
  setHighlight(color: string | null): void;
  setLink(href: string | null): void;
  clearFormatting(): void;

  setParagraph(): void;
  setHeading(level: 1 | 2 | 3 | 4 | 5 | 6): void;
  toggleBlockquote(): void;
  toggleCodeBlock(): void;
  toggleBulletList(): void;
  toggleOrderedList(): void;
  setTextAlign(align: Alignment): void;
  insertHorizontalRule(): void;

  insertImage(image: { src: string; alt?: string; title?: string }): void;
  insertFrameReference(targetFrameId: string): void;
  insertTable(options?: {
    rows?: number;
    cols?: number;
    withHeaderRow?: boolean;
  }): void;
  addTableRow(position: 'before' | 'after'): void;
  addTableColumn(position: 'before' | 'after'): void;
  deleteTableRow(): void;
  deleteTableColumn(): void;
  deleteTable(): void;
  toggleTableHeader(kind: 'row' | 'column' | 'cell'): void;

  can(command: DocumentCommandName): boolean;
  getToolbarState(): DocumentToolbarState;
  /** Fires when toolbar-relevant state may have changed. */
  subscribe(listener: () => void): () => void;

  getHeadings(): DocumentHeading[];
  /** Scrolls a heading into view and places the caret inside it. */
  locateHeading(pos: number): void;
  locateFrameReference(targetFrameId: string, occurrence: number): boolean;

  find(query: string, options?: DocumentSearchOptions): DocumentSearchMatch[];
  selectMatch(match: DocumentSearchMatch): void;
  replace(match: DocumentSearchMatch, text: string): void;
  /** One transaction = one undo step. Returns the match count. */
  replaceAll(
    query: string,
    text: string,
    options?: DocumentSearchOptions,
  ): number;

  /** Non-whitespace character count for the status bar. */
  getCharacterCount(): number;

  undo(): void;
  redo(): void;
}

const TABLE_COMMANDS = {
  before: { row: 'addRowBefore', column: 'addColumnBefore' },
  after: { row: 'addRowAfter', column: 'addColumnAfter' },
} as const;

const HEADER_COMMANDS = {
  row: 'toggleHeaderRow',
  column: 'toggleHeaderColumn',
  cell: 'toggleHeaderCell',
} as const;

export function createDocumentController(
  editor: Editor,
  options: ControllerOptions,
): DocumentEditorController {
  const { withSource } = options;
  const editable = () => !editor.isDestroyed && editor.isEditable;
  const scrollTo = (element: Node | null) => {
    if (
      element instanceof HTMLElement &&
      typeof element.scrollIntoView === 'function'
    )
      element.scrollIntoView({ block: 'start', inline: 'nearest' });
  };
  const format = (run: () => void) => {
    if (editable()) withSource('format', run);
  };

  const commands: DocumentCommands = {
    focus(position = 'end') {
      if (!editor.isDestroyed) {
        editor.commands.focus(position === 'preserve' ? undefined : position);
        if (!editor.isEditable && position === 'start')
          scrollTo(editor.view.dom);
      }
    },
    commit() {
      const base = options.getBaseDocument();
      return editor.isDestroyed ? base : documentFromEditor(editor, base);
    },
    getDocument() {
      return commands.commit();
    },
    getSelection() {
      if (editor.isDestroyed) return null;
      const view = editor.view;
      const native = view.dom.ownerDocument.getSelection();
      // A native key/pointer selection can precede ProseMirror's selection
      // observer. Snapshot it without flushing or dispatching a transaction.
      if (
        view.hasFocus() &&
        native?.anchorNode &&
        native.focusNode &&
        view.dom.contains(native.anchorNode) &&
        view.dom.contains(native.focusNode)
      ) {
        try {
          const anchor = view.posAtDOM(native.anchorNode, native.anchorOffset);
          const head = view.posAtDOM(native.focusNode, native.focusOffset);
          const from = Math.min(anchor, head),
            to = Math.max(anchor, head);
          if (from >= 0 && to <= editor.state.doc.content.size)
            return { from, to, collapsed: from === to };
        } catch {
          // An atom or composing DOM range may have no current model mapping.
        }
      }
      const { from, to } = editor.state.selection;
      return { from, to, collapsed: from === to };
    },

    toggleMark(mark) {
      format(() => editor.chain().focus().toggleMark(mark).run());
    },
    setTextColor(color) {
      format(() => {
        const chain = editor.chain().focus();
        if (color) chain.setColor(color).run();
        else chain.unsetColor().run();
      });
    },
    setFontSize(size) {
      format(() => {
        editor.chain().focus().setMark('textStyle', { fontSize: size }).run();
      });
    },
    setHighlight(color) {
      format(() => {
        editor.chain().focus().setMark('highlight', { color }).run();
      });
    },
    setLink(href) {
      format(() => {
        const chain = editor.chain().focus().extendMarkRange('link');
        if (href) chain.setLink({ href }).run();
        else chain.unsetLink().run();
      });
    },
    clearFormatting() {
      format(() => {
        editor.chain().focus().unsetAllMarks().clearNodes().run();
      });
    },

    setParagraph() {
      format(() => editor.chain().focus().setParagraph().run());
    },
    setHeading(level) {
      format(() => editor.chain().focus().toggleHeading({ level }).run());
    },
    toggleBlockquote() {
      format(() => editor.chain().focus().toggleBlockquote().run());
    },
    toggleCodeBlock() {
      format(() => editor.chain().focus().toggleCodeBlock().run());
    },
    toggleBulletList() {
      format(() => editor.chain().focus().toggleBulletList().run());
    },
    toggleOrderedList() {
      format(() => editor.chain().focus().toggleOrderedList().run());
    },
    setTextAlign(align) {
      format(() => editor.chain().focus().setTextAlign(align).run());
    },
    insertHorizontalRule() {
      if (editable())
        withSource('insert', () =>
          editor.chain().focus().setHorizontalRule().run(),
        );
    },

    insertImage(image) {
      if (editable())
        withSource('insert', () =>
          editor
            .chain()
            .focus()
            .insertContent({ type: 'image', attrs: { ...image } })
            .run(),
        );
    },
    insertFrameReference(targetFrameId) {
      if (editable() && targetFrameId)
        withSource('insert', () =>
          editor
            .chain()
            .focus()
            .insertContent({ type: 'frameReference', attrs: { targetFrameId } })
            .run(),
        );
    },
    insertTable({ rows = 3, cols = 3, withHeaderRow = true } = {}) {
      if (editable())
        withSource('insert', () =>
          editor
            .chain()
            .focus()
            .insertTable({ rows, cols, withHeaderRow })
            .run(),
        );
    },
    addTableRow(position) {
      format(() =>
        editor.chain().focus()[TABLE_COMMANDS[position].row]().run(),
      );
    },
    addTableColumn(position) {
      format(() =>
        editor.chain().focus()[TABLE_COMMANDS[position].column]().run(),
      );
    },
    deleteTableRow() {
      format(() => editor.chain().focus().deleteRow().run());
    },
    deleteTableColumn() {
      format(() => editor.chain().focus().deleteColumn().run());
    },
    deleteTable() {
      format(() => editor.chain().focus().deleteTable().run());
    },
    toggleTableHeader(kind) {
      format(() => editor.chain().focus()[HEADER_COMMANDS[kind]]().run());
    },

    can(command) {
      if (editor.isDestroyed) return false;
      if (command === 'undo') return options.canUndo();
      if (command === 'redo') return options.canRedo();
      if (!editor.isEditable) return false;
      const probe = editor.can().chain();
      switch (command) {
        case 'toggleBold':
          return probe.toggleBold().run();
        case 'toggleItalic':
          return probe.toggleItalic().run();
        case 'toggleUnderline':
          return probe.toggleUnderline().run();
        case 'toggleStrike':
          return probe.toggleStrike().run();
        case 'toggleCode':
          return probe.toggleCode().run();
        case 'toggleSuperscript':
          return probe.toggleMark('superscript').run();
        case 'toggleSubscript':
          return probe.toggleMark('subscript').run();
        case 'setParagraph':
          return probe.setParagraph().run();
        case 'setHeading':
          return probe.toggleHeading({ level: 1 }).run();
        case 'toggleBlockquote':
          return probe.toggleBlockquote().run();
        case 'toggleCodeBlock':
          return probe.toggleCodeBlock().run();
        case 'toggleBulletList':
          return probe.toggleBulletList().run();
        case 'toggleOrderedList':
          return probe.toggleOrderedList().run();
        case 'setTextAlign':
          return probe.setTextAlign(Alignment.left).run();
        case 'insertHorizontalRule':
          return probe.setHorizontalRule().run();
        case 'insertTable':
          return probe.insertTable().run();
        case 'addTableRowBefore':
          return probe.addRowBefore().run();
        case 'addTableRowAfter':
          return probe.addRowAfter().run();
        case 'addTableColumnBefore':
          return probe.addColumnBefore().run();
        case 'addTableColumnAfter':
          return probe.addColumnAfter().run();
        case 'deleteTableRow':
          return probe.deleteRow().run();
        case 'deleteTableColumn':
          return probe.deleteColumn().run();
        case 'deleteTable':
          return probe.deleteTable().run();
        case 'toggleTableHeaderRow':
          return probe.toggleHeaderRow().run();
        case 'toggleTableHeaderColumn':
          return probe.toggleHeaderColumn().run();
        case 'toggleTableHeaderCell':
          return probe.toggleHeaderCell().run();
        case 'clearFormatting':
          return probe.unsetAllMarks().run();
        default:
          return false;
      }
    },

    getToolbarState(): DocumentToolbarState {
      const { selection } = editor.state;
      let block: DocumentToolbarState['block'] = 'paragraph';
      let headingLevel: number | undefined;
      if (editor.isActive('heading')) {
        block = 'heading';
        headingLevel = editor.getAttributes('heading')['level'];
      } else if (editor.isActive('codeBlock')) block = 'codeBlock';
      else if (editor.isActive('blockquote')) block = 'blockquote';
      else if (editor.isActive('bulletList')) block = 'bulletList';
      else if (editor.isActive('orderedList')) block = 'orderedList';
      const { $from } = selection;
      let align = Alignment.left;
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (!['paragraph', 'heading'].includes(node.type.name)) continue;
        const value = node.attrs['textAlign'];
        if (Object.values(Alignment).includes(value)) align = value;
        break;
      }
      return {
        marks: {
          bold: editor.isActive('bold') || undefined,
          italic: editor.isActive('italic') || undefined,
          underline: editor.isActive('underline') || undefined,
          strike: editor.isActive('strike') || undefined,
          code: editor.isActive('code') || undefined,
          superscript: editor.isActive('superscript') || undefined,
          subscript: editor.isActive('subscript') || undefined,
          color: activeEditorTextColor(editor),
          fontSize: editor.getAttributes('textStyle')['fontSize'],
          highlight: editor.getAttributes('highlight')['color'],
        },
        block,
        headingLevel,
        align,
        link: editor.getAttributes('link')['href'],
        inTable: editor.isActive('table'),
        editable: editor.isEditable,
      };
    },
    subscribe(listener) {
      const handler = () => listener();
      editor.on('transaction', handler);
      return () => editor.off('transaction', handler);
    },

    getHeadings(): DocumentHeading[] {
      const headings: DocumentHeading[] = [];
      const slug = createDocumentHeadingSlugger();
      if (!editor.isDestroyed) {
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== 'heading') return true;
          headings.push({
            level: node.attrs['level'],
            text: node.textContent,
            anchor: slug(node.textContent),
            pos,
          });
          return false;
        });
      }
      return headings;
    },
    locateHeading(pos) {
      if (editor.isDestroyed) return;
      editor
        .chain()
        .focus()
        .setTextSelection(Math.min(pos + 1, editor.state.doc.content.size))
        .scrollIntoView()
        .run();
      // Readonly views may have no DOM caret, so ProseMirror skips its own
      // selection scrolling. The heading remains a usable navigation target.
      scrollTo(editor.view.nodeDOM(pos));
    },

    locateFrameReference(targetFrameId, occurrence) {
      if (editor.isDestroyed || !Number.isInteger(occurrence) || occurrence < 0)
        return false;
      let remaining = occurrence;
      let position: number | undefined;
      editor.state.doc.descendants((node, pos) => {
        if (position !== undefined) return false;
        if (
          node.type.name === 'frameReference' &&
          node.attrs['targetFrameId'] === targetFrameId
        ) {
          if (remaining-- === 0) position = pos;
          return false;
        }
        return node.type.name !== 'codeBlock';
      });
      if (position === undefined) return false;
      editor.chain().setNodeSelection(position).run();
      // Explicit scrolling also works when the document is read-only.
      scrollTo(editor.view.nodeDOM(position));
      return true;
    },

    find(query, options: DocumentSearchOptions = {}) {
      if (!query || editor.isDestroyed) return [];
      return findInDocument(editor.state.doc, query, options.caseSensitive).map(
        (match, index) => ({ ...match, index }),
      );
    },
    selectMatch(match: DocumentSearchMatch) {
      if (editor.isDestroyed) return;
      editor
        .chain()
        .focus()
        .setTextSelection({ from: match.from, to: match.to })
        .scrollIntoView()
        .run();
    },
    replace(match, text) {
      if (!editable()) return;
      withSource('replace', () => {
        editor.view.dispatch(
          editor.state.tr.insertText(text, match.from, match.to),
        );
      });
    },
    replaceAll(query, text, options: DocumentSearchOptions = {}) {
      if (!query || !editable()) return 0;
      const matches = findInDocument(
        editor.state.doc,
        query,
        options.caseSensitive,
      );
      if (!matches.length) return 0;
      withSource('replace', () => {
        const tr = editor.state.tr;
        for (let index = matches.length - 1; index >= 0; index--) {
          const match = matches[index];
          tr.insertText(text, match.from, match.to);
        }
        editor.view.dispatch(tr);
      });
      return matches.length;
    },

    getCharacterCount() {
      if (editor.isDestroyed) return 0;
      const plain = deriveBoardTextPlainText(
        documentFromEditor(editor, options.getBaseDocument()).content,
      );
      return plain.replace(/\s/g, '').length;
    },

    undo() {
      options.undo();
    },
    redo() {
      options.redo();
    },
  };

  const restoreSelection = (selection: DocumentSelection) => {
    if (editor.isDestroyed) return;
    const max = editor.state.doc.content.size;
    const from = Math.max(0, Math.min(selection.from, max));
    const to = Math.max(from, Math.min(selection.to, max));
    editor.commands.setTextSelection({ from, to });
  };
  const flushEditing = () =>
    options.flushEditing?.() ??
    Promise.resolve<ActionResult>({ status: 'completed' });
  const registry = createActionRegistry({
    getContext: () => ({
      id: options.getBaseDocument().id,
      document: editor.state.doc,
      selection: commands.getSelection(),
    }),
    refresh: (captured) =>
      !editor.isDestroyed &&
      captured.id === options.getBaseDocument().id &&
      captured.document === editor.state.doc
        ? captured
        : null,
    beforeExecute: () => flushEditing(),
  });
  const commandShortcuts: Record<string, readonly ActionShortcut[]> = {
    'toggle-strike': [{ key: 'x', mod: true, shift: true }],
    'toggle-code': [{ key: 'e', mod: true }],
    'set-paragraph': [{ key: '0', mod: true, alt: true }],
    'toggle-blockquote': [{ key: 'b', mod: true, shift: true }],
    'toggle-code-block': [{ key: 'c', mod: true, alt: true }],
    'toggle-bullet-list': [{ key: '8', mod: true, shift: true }],
    'toggle-ordered-list': [{ key: '7', mod: true, shift: true }],
  };
  for (let level = 1; level <= 6; level++)
    commandShortcuts[`heading-${level}`] = [
      { key: String(level), mod: true, alt: true },
    ];
  const register = <A = void>(
    id: string,
    label: string,
    command: DocumentCommandName | undefined,
    run: (args: A) => void,
    extra: {
      shortcuts?: readonly ActionShortcut[];
      checked?: () => boolean;
      validate?: (args: unknown) => boolean;
      palette?: boolean;
    } = {},
  ) =>
    registry.register<A>({
      id: `document.${id}`,
      label: { zh: label, en: id.replace(/-/g, ' ') },
      category: 'document',
      effect: 'content',
      palette: extra.palette,
      shortcuts: extra.shortcuts ?? commandShortcuts[id],
      validateArgs: extra.validate
        ? (args): args is A => extra.validate!(args)
        : undefined,
      getState: () => ({
        visible: true,
        enabled: editable() && (!command || commands.can(command)),
        reason: !editable() ? 'readonly' : undefined,
        checked: extra.checked?.(),
      }),
      execute: async (context, args) => {
        if (context.selection) restoreSelection(context.selection);
        const before = editor.state.doc;
        run(args);
        const receipt = await flushEditing();
        return receipt.status !== 'completed' && receipt.status !== 'noop'
          ? receipt
          : { status: before === editor.state.doc ? 'noop' : 'completed' };
      },
    });
  const stringOrNull = (value: unknown) =>
    value === null || typeof value === 'string';
  const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object';
  for (const [mark, key, label] of [
    ['bold', 'b', '加粗'],
    ['italic', 'i', '斜体'],
    ['underline', 'u', '下划线'],
    ['strike', '', '删除线'],
    ['code', '', '行内代码'],
    ['superscript', '', '上标'],
    ['subscript', '', '下标'],
  ] as const)
    register(
      `toggle-${mark}`,
      label,
      `toggle${mark[0].toUpperCase()}${mark.slice(1)}` as DocumentCommandName,
      () => commands.toggleMark(mark),
      {
        shortcuts: key ? [{ key, mod: true }] : undefined,
        checked: () => editor.isActive(mark),
      },
    );
  register(
    'set-text-color',
    '文字颜色',
    undefined,
    (value: string | null) => commands.setTextColor(value),
    { validate: stringOrNull, palette: false },
  );
  register(
    'set-font-size',
    '文字大小',
    undefined,
    (value: string | null) => commands.setFontSize(value),
    { validate: stringOrNull, palette: false },
  );
  register(
    'set-highlight',
    '文字高亮',
    undefined,
    (value: string | null) => commands.setHighlight(value),
    { validate: stringOrNull, palette: false },
  );
  register(
    'set-link',
    '设置链接',
    undefined,
    (value: string | null) => commands.setLink(value),
    { validate: stringOrNull, palette: false },
  );
  register('clear-formatting', '清除格式', 'clearFormatting', () =>
    commands.clearFormatting(),
  );
  register(
    'set-paragraph',
    '正文',
    'setParagraph',
    () => commands.setParagraph(),
    { checked: () => editor.isActive('paragraph') },
  );
  register(
    'set-heading',
    '标题级别',
    'setHeading',
    (value: 1 | 2 | 3 | 4 | 5 | 6) => commands.setHeading(value),
    {
      validate: (value) =>
        Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 6,
      palette: false,
    },
  );
  for (const level of [1, 2, 3, 4, 5, 6] as const)
    register(
      `heading-${level}`,
      `${level} 级标题`,
      'setHeading',
      () => commands.setHeading(level),
      { checked: () => editor.isActive('heading', { level }) },
    );
  for (const [id, command, label, run, block] of [
    [
      'toggle-blockquote',
      'toggleBlockquote',
      '引用',
      () => commands.toggleBlockquote(),
      'blockquote',
    ],
    [
      'toggle-code-block',
      'toggleCodeBlock',
      '代码块',
      () => commands.toggleCodeBlock(),
      'codeBlock',
    ],
    [
      'toggle-bullet-list',
      'toggleBulletList',
      '无序列表',
      () => commands.toggleBulletList(),
      'bulletList',
    ],
    [
      'toggle-ordered-list',
      'toggleOrderedList',
      '有序列表',
      () => commands.toggleOrderedList(),
      'orderedList',
    ],
  ] as const)
    register(id, label, command, run, {
      checked: () => editor.isActive(block),
    });
  register(
    'set-text-align',
    '文字对齐',
    'setTextAlign',
    (value: Alignment) => commands.setTextAlign(value),
    {
      validate: (value) =>
        Object.values(Alignment).includes(value as Alignment),
      palette: false,
    },
  );
  for (const [id, label, align] of [
    ['align-left', '左对齐', Alignment.left],
    ['align-center', '居中', Alignment.center],
    ['align-right', '右对齐', Alignment.right],
  ] as const)
    register(id, label, 'setTextAlign', () => commands.setTextAlign(align), {
      checked: () => commands.getToolbarState().align === align,
    });
  register('insert-horizontal-rule', '插入分隔线', 'insertHorizontalRule', () =>
    commands.insertHorizontalRule(),
  );
  register(
    'insert-image',
    '插入图片',
    undefined,
    (
      value: Parameters<DocumentCommands['insertImage']>[0] & {
        position?: number;
      },
    ) => {
      if (value['position'] === undefined) commands.insertImage(value);
      else
        withSource('insert', () => {
          editor
            .chain()
            .insertContentAt(value['position']!, {
              type: 'image',
              attrs: {
                src: value['src'],
                alt: value['alt'],
                title: value['title'],
              },
            })
            .run();
        });
    },
    {
      validate: (value) =>
        isObject(value) &&
        typeof value['src'] === 'string' &&
        !!value['src'] &&
        (value['position'] === undefined ||
          (Number.isInteger(value['position']) &&
            Number(value['position']) >= 0 &&
            Number(value['position']) <= editor.state.doc.content.size)),
      palette: false,
    },
  );
  register(
    'insert-frame-reference',
    '插入图表',
    undefined,
    (value: string) => commands.insertFrameReference(value),
    {
      validate: (value) => typeof value === 'string' && !!value,
      palette: false,
    },
  );
  register(
    'insert-table',
    '插入表格',
    'insertTable',
    (value: Parameters<DocumentCommands['insertTable']>[0]) =>
      commands.insertTable(value),
    {
      validate: (value) =>
        value === undefined ||
        (isObject(value) &&
          ['rows', 'cols'].every(
            (key) =>
              value[key] === undefined ||
              (Number.isInteger(value[key]) &&
                Number(value[key]) >= 1 &&
                Number(value[key]) <= 100),
          ) &&
          (value['withHeaderRow'] === undefined ||
            typeof value['withHeaderRow'] === 'boolean')),
      palette: true,
    },
  );
  for (const [id, command, run, label] of [
    [
      'add-row-before',
      'addTableRowBefore',
      () => commands.addTableRow('before'),
      '上方插入行',
    ],
    [
      'add-row-after',
      'addTableRowAfter',
      () => commands.addTableRow('after'),
      '下方插入行',
    ],
    [
      'add-column-before',
      'addTableColumnBefore',
      () => commands.addTableColumn('before'),
      '左侧插入列',
    ],
    [
      'add-column-after',
      'addTableColumnAfter',
      () => commands.addTableColumn('after'),
      '右侧插入列',
    ],
    ['delete-row', 'deleteTableRow', () => commands.deleteTableRow(), '删除行'],
    [
      'delete-column',
      'deleteTableColumn',
      () => commands.deleteTableColumn(),
      '删除列',
    ],
    ['delete-table', 'deleteTable', () => commands.deleteTable(), '删除表格'],
    [
      'toggle-header-row',
      'toggleTableHeaderRow',
      () => commands.toggleTableHeader('row'),
      '表头行',
    ],
    [
      'toggle-header-column',
      'toggleTableHeaderColumn',
      () => commands.toggleTableHeader('column'),
      '表头列',
    ],
    [
      'toggle-header-cell',
      'toggleTableHeaderCell',
      () => commands.toggleTableHeader('cell'),
      '表头单元格',
    ],
  ] as const)
    register(id, label, command, run);
  register(
    'replace',
    '替换',
    undefined,
    (value: { match: DocumentSearchMatch; text: string }) =>
      commands.replace(value['match'], value['text']),
    {
      validate: (value) =>
        isObject(value) &&
        isObject(value['match']) &&
        Number.isInteger(value['match']['from']) &&
        Number.isInteger(value['match']['to']) &&
        Number(value['match']['from']) >= 0 &&
        Number(value['match']['to']) >= Number(value['match']['from']) &&
        Number(value['match']['to']) <= editor.state.doc.content.size &&
        typeof value['text'] === 'string',
      palette: false,
    },
  );
  register(
    'replace-all',
    '全部替换',
    undefined,
    (value: {
      query: string;
      text: string;
      options?: DocumentSearchOptions;
    }) => {
      commands.replaceAll(value['query'], value['text'], value['options']);
    },
    {
      validate: (value) =>
        isObject(value) &&
        typeof value['query'] === 'string' &&
        typeof value['text'] === 'string',
      palette: false,
    },
  );
  for (const direction of ['undo', 'redo'] as const)
    registry.register({
      id: `document.${direction}`,
      label:
        direction === 'undo'
          ? { zh: '撤销', en: 'Undo' }
          : { zh: '重做', en: 'Redo' },
      category: 'document',
      effect: 'history',
      shortcuts:
        direction === 'undo'
          ? [{ key: 'z', mod: true }]
          : [
              { key: 'z', mod: true, shift: true },
              { key: 'y', mod: true },
            ],
      getState: () => ({
        enabled:
          editable() &&
          (direction === 'undo' ? options.canUndo() : options.canRedo()),
        reason: !editable() ? 'readonly' : undefined,
      }),
      execute: async (_context, _args, invocation) => {
        const receipt = await flushEditing();
        if (receipt.status !== 'completed' && receipt.status !== 'noop')
          return receipt;
        const invalid = invocation.checkpoint();
        if (invalid) return invalid;
        await options[direction]();
        return { status: 'completed' };
      },
    });
  registry.seal();
  const changed = () => registry.invalidate();
  editor.on('transaction', changed);
  editor.on('destroy', () => {
    editor.off('transaction', changed);
    registry.dispose();
  });
  const controller: DocumentEditorController = {
    focus: commands.focus,
    commit: commands.commit,
    getDocument: commands.getDocument,
    getSelection: commands.getSelection,
    restoreSelection,
    flushEditing,
    getToolbarState: commands.getToolbarState,
    getHeadings: commands.getHeadings,
    locateHeading: commands.locateHeading,
    locateFrameReference: commands.locateFrameReference,
    find: commands.find,
    selectMatch: commands.selectMatch,
    getCharacterCount: commands.getCharacterCount,
    actions: registry.actions,
    getActionState: registry.getActionState,
    executeAction: registry.executeAction,
    subscribe: registry.subscribe,
    get revision() {
      return registry.revision;
    },
  };
  return controller;
}
