import type { Editor } from '@tiptap/react';
import {
  Alignment,
  BoardTextController,
  BoardTextDocument,
  BoardTextLink,
  BoardTextMarks,
  BoardTextSelection,
  boardTextColor,
} from '@sue/board-common';
import { measureContainerSize } from './measure';

/** Reads presentation only; the editor's stored literal and source remain untouched. */
export function activeEditorTextColor(editor: Editor): string | undefined {
  if (editor.isDestroyed) return undefined;
  const style = getComputedStyle(editor.view.dom);
  const adaptive =
    style
      .getPropertyValue('--board-unmarked-text-color')
      .trim()
      .toLowerCase() === 'currentcolor';
  const explicit = boardTextColor(editor.getAttributes('textStyle'), adaptive);
  if (explicit || !adaptive) return explicit;
  const channels = style.color.match(/^rgba?\((\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/);
  return channels
    ? '#' +
        channels
          .slice(1, 4)
          .map((part) => Number(part).toString(16).padStart(2, '0'))
          .join('')
    : undefined;
}

const MARK_COMMANDS: Record<
  keyof BoardTextMarks,
  (editor: Editor, value?: boolean | string | number) => void
> = {
  bold: (editor) => editor.chain().focus().toggleBold().run(),
  italic: (editor) => editor.chain().focus().toggleItalic().run(),
  underline: (editor) => editor.chain().focus().toggleUnderline().run(),
  strike: (editor) => editor.chain().focus().toggleStrike().run(),
  code: (editor) => editor.chain().focus().toggleCode().run(),
  color: (editor, value) => {
    if (value) {
      editor.chain().focus().setColor(String(value)).run();
    } else {
      editor.chain().focus().unsetColor().run();
    }
  },
  fontSize: (editor, value) => {
    const size = value ? `${value}px` : null;
    editor.chain().focus().setMark('textStyle', { fontSize: size }).run();
  },
};

export function createBoardTextController(
  editor: Editor,
  document: BoardTextDocument,
  container?: HTMLElement | null,
): BoardTextController {
  const controller: BoardTextController = {
    get document() {
      return editor.isDestroyed
        ? document
        : documentFromEditor(editor, document);
    },
    focus() {
      if (!editor.isDestroyed) {
        editor.commands.focus('end');
      }
    },
    blur() {
      if (!editor.isDestroyed) {
        editor.commands.blur();
      }
    },
    selectAll() {
      if (!editor.isDestroyed) {
        editor.commands.focus();
        editor.commands.selectAll();
      }
    },
    selectRange(from: number, to: number) {
      if (editor.isDestroyed) return;
      const docSize = editor.state.doc.content.size;
      const start = Math.max(0, Math.min(from, docSize));
      const end = Math.max(start, Math.min(to, docSize));
      editor.commands.setTextSelection({ from: start, to: end });
    },
    getSelection(): BoardTextSelection | null {
      if (editor.isDestroyed) {
        return null;
      }
      const { from, to } = editor.state.selection;
      return { from, to, collapsed: from === to };
    },
    getActiveMarks(): BoardTextMarks {
      return {
        bold: editor.isActive('bold') || undefined,
        italic: editor.isActive('italic') || undefined,
        underline: editor.isActive('underline') || undefined,
        strike: editor.isActive('strike') || undefined,
        code: editor.isActive('code') || undefined,
        color: activeEditorTextColor(editor),
        fontSize: editor.getAttributes('textStyle')['fontSize'],
      };
    },
    getActiveLink(): BoardTextLink | null {
      const href = editor.getAttributes('link')['href'];
      if (!href) {
        return null;
      }
      return { href };
    },
    getActiveAlign() {
      if (!editor.isDestroyed) {
        const { $from } = editor.state.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          if (!['paragraph', 'heading'].includes(node.type.name)) continue;
          const align = node.attrs['textAlign'];
          if (Object.values(Alignment).includes(align))
            return align as Alignment;
          break;
        }
      }
      if (!editor.isDestroyed) {
        // Select-all starts at the document boundary, outside any paragraph.
        const { from, to } = editor.state.selection;
        let first: Alignment | undefined;
        editor.state.doc.nodesBetween(from, to, (node) => {
          if (
            first !== undefined ||
            !['paragraph', 'heading'].includes(node.type.name)
          )
            return;
          const value = node.attrs['textAlign'];
          first = Object.values(Alignment).includes(value)
            ? (value as Alignment)
            : (document.align ?? Alignment.center);
        });
        if (first !== undefined) return first;
      }
      return document.align ?? Alignment.center;
    },
    applyMark(mark, value) {
      MARK_COMMANDS[mark]?.(editor, value);
    },
    toggleMark(mark) {
      if (editor.isDestroyed) return;
      const { from, to } = editor.state.selection;
      editor.chain().focus().setTextSelection({ from, to }).run();
      MARK_COMMANDS[mark]?.(editor);
    },
    setLink(link) {
      const chain = editor.chain().focus();
      if (editor.state.selection.empty) chain.extendMarkRange('link');
      if (link) chain.setLink({ href: link.href }).run();
      else chain.unsetLink().run();
    },
    insertLink(href, label) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text: label,
          marks: [{ type: 'link', attrs: { href } }],
        })
        .unsetMark('link')
        .run();
    },
    setAlign(align: Alignment) {
      editor.chain().focus().setTextAlign(align).run();
    },
    commit() {
      return editor.isDestroyed
        ? document
        : documentFromEditor(editor, document);
    },
    measure() {
      return measureContainerSize(container ?? null);
    },
  };
  return controller;
}

export function documentFromEditor(
  editor: Editor,
  previous: BoardTextDocument,
): BoardTextDocument {
  return {
    ...previous,
    schemaVersion: 1,
    content: editor.getJSON() as BoardTextDocument['content'],
    plainText: editor.getText(),
  };
}
