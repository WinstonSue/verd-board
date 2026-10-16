import type { Editor } from '@tiptap/react';
import type { BoardTextDocument } from '@sue/board-common';

/** Update external formatting too, while protecting unacknowledged typed text. */
export function syncEditorDocument(editor: Editor, text: BoardTextDocument) {
  if (editor.isDestroyed) return;
  const incoming = editor.schema.nodeFromJSON(text.content);
  if (incoming.eq(editor.state.doc)) return;
  if (editor.isFocused && incoming.textContent !== editor.state.doc.textContent)
    return;
  const { from, to } = editor.state.selection;
  editor.commands.setContent(incoming.toJSON(), { emitUpdate: false });
  editor.commands.setTextSelection({
    from: Math.min(from, editor.state.doc.content.size),
    to: Math.min(to, editor.state.doc.content.size),
  });
}
