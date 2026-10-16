import type { Editor } from '@tiptap/react';
import {
  Alignment,
  BoardTextDocument,
  deriveBoardTextPlainText,
} from '@sue/board-common';
import type {
  DocumentChangeSource,
  DocumentCommandName,
  DocumentEditorController,
  DocumentHeading,
  DocumentSearchMatch,
  DocumentSearchOptions,
  DocumentToolbarState,
} from '../../types/document';
import { documentFromEditor } from '../../utils/controller';
import { findInDocument } from './document-search';

interface ControllerOptions {
  /** Tags the next emitted change (format/insert/replace) for history. */
  withSource(source: DocumentChangeSource, run: () => void): void;
  /** Latest document — commits must not spread stale doc-level fields. */
  getBaseDocument(): BoardTextDocument;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
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
  const format = (run: () => void) => {
    if (editable()) withSource('format', run);
  };

  const controller: DocumentEditorController = {
    focus(position = 'end') {
      if (!editor.isDestroyed) editor.commands.focus(position);
    },
    commit() {
      const base = options.getBaseDocument();
      return editor.isDestroyed ? base : documentFromEditor(editor, base);
    },
    getDocument() {
      return controller.commit();
    },
    getSelection() {
      if (editor.isDestroyed) return null;
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
          color: editor.getAttributes('textStyle')['color'],
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
      if (!editor.isDestroyed) {
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== 'heading') return true;
          headings.push({
            level: node.attrs['level'],
            text: node.textContent,
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
  return controller;
}
