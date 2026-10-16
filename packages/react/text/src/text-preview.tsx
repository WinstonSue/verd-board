import { useMemo } from 'react';
import { getSchema, getHTMLFromFragment } from '@tiptap/react';
import type { BoardTextDocument } from '@sue/board-common';
import { contentExtensions } from './constants/editor-config';
import './styles/content.scss';

// Resolve the shared schema once, instead of rebuilding it for every canvas label.
const schema = getSchema(contentExtensions);

/** Schema serialization without an editor instance or editing decorations. */
export function TextPreview({
  text,
  preview = false,
}: {
  text: BoardTextDocument;
  preview?: boolean;
}) {
  const html = useMemo(
    () => serializeTextPreview(text, preview),
    [text.content, preview],
  );
  return (
    <div
      className="board-text-content"
      onClick={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if ((event.target as Element).closest('a')) event.preventDefault();
      }}
      onDragStart={(event) => event.preventDefault()}
      // HTML is produced by the same schema serializer as the editor.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Shared schema HTML for display and offscreen measurement. */
export function serializeTextPreview(
  text: BoardTextDocument,
  preview = false,
): string {
  const container = document.createElement('div');
  container.innerHTML = getHTMLFromFragment(
    schema.nodeFromJSON(text.content).content,
    schema,
  );
  // ProseMirror retains a line box for empty blocks and trailing hard breaks.
  container.querySelectorAll('p, h1, h2, h3, h4, h5, h6').forEach((block) => {
    if (!block.childNodes.length || block.lastChild?.nodeName === 'BR')
      block.append(document.createElement('br'));
  });
  container.querySelectorAll('a').forEach((link) => {
    link.draggable = false;
    if (preview) {
      const label = document.createElement('span');
      label.style.textDecoration = 'underline';
      label.append(...link.childNodes);
      link.replaceWith(label);
    } else link.style.pointerEvents = 'auto';
  });
  return container.innerHTML;
}
