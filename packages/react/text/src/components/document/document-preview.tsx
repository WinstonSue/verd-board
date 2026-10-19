import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getSchema } from '@tiptap/react';
import { DOMSerializer } from '@tiptap/pm/model';
import type { BoardTextDocument } from '@sue/board-common';
import { createDocumentExtensions } from '../../constants/editor-config';
import { createDocumentHeadingSlugger } from '../../utils/heading-slug';
import type {
  DocumentEditorController,
  DocumentHeading,
} from '../../types/document';
import type { DocumentFrameReferenceRenderer } from './document-frame-reference';
import './document-editor.scss';

export type DocumentPreviewController = Pick<
  DocumentEditorController,
  'getHeadings' | 'locateHeading'
>;

export interface DocumentPreviewProps {
  value: BoardTextDocument;
  renderFrameReference?: DocumentFrameReferenceRenderer;
  onReady?(controller: DocumentPreviewController | null): void;
  onError?(message: string): void;
  className?: string;
}

// Share the schema and serializer across previews. No editor, view, transaction
// plugins or editing observers are needed to display persisted rich text.
const schema = getSchema(createDocumentExtensions({ history: false }));
const documentSerializer = DOMSerializer.fromSchema(schema);
const serializer = new DOMSerializer(
  {
    ...documentSerializer.nodes,
    frameReference: (node) => [
      'div',
      {
        class: 'document-frame-reference',
        'data-frame-reference': String(node.attrs['targetFrameId'] ?? ''),
      },
    ],
  },
  documentSerializer.marks,
);

function preparePreview(content: BoardTextDocument['content']) {
  try {
    const node = schema.nodeFromJSON(content);
    node.check();
    const body = document.createElement('div');
    body.className = 'board-document-content board-document-preview-content';
    // A preview can itself be embedded inside an editable document.
    body.setAttribute('contenteditable', 'false');
    body.append(serializer.serializeFragment(node.content));
    // Match ProseMirror's line boxes for empty blocks and trailing hard breaks.
    body.querySelectorAll('p, h1, h2, h3, h4, h5, h6').forEach((block) => {
      if (!block.childNodes.length || block.lastChild?.nodeName === 'BR')
        block.append(document.createElement('br'));
    });
    body.querySelectorAll('a').forEach((link) => {
      link.draggable = false;
    });
    const headings: DocumentHeading[] = [];
    const references: { targetFrameId: string; instanceId: string }[] = [];
    const referenceOccurrences = new Map<string, number>();
    const slug = createDocumentHeadingSlugger();
    node.descendants((child, pos) => {
      if (child.type.name === 'heading') {
        headings.push({
          level: child.attrs['level'],
          text: child.textContent,
          anchor: slug(child.textContent),
          pos,
        });
        return false;
      }
      if (child.type.name === 'frameReference') {
        const targetFrameId = String(child.attrs['targetFrameId'] ?? '');
        const occurrence = referenceOccurrences.get(targetFrameId) ?? 0;
        referenceOccurrences.set(targetFrameId, occurrence + 1);
        references.push({
          targetFrameId,
          instanceId: JSON.stringify([targetFrameId, occurrence]),
        });
      }
      return true;
    });
    const headingElements = body.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6',
    );
    const targets = new Map(
      headings.map((heading, index) => [heading.pos, headingElements[index]]),
    );
    const referenceElements = body.querySelectorAll<HTMLElement>(
      '.document-frame-reference',
    );
    return {
      body,
      headings,
      targets,
      references: references.map((reference, index) => ({
        ...reference,
        container: referenceElements[index],
      })),
      error: null,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Readonly document rendering, including live native canvas reference blocks. */
export function DocumentPreview({
  value,
  renderFrameReference,
  onReady,
  onError,
  className,
}: DocumentPreviewProps) {
  const prepared = useMemo(
    () => preparePreview(value.content),
    [value.content],
  );
  const container = useRef<HTMLDivElement>(null);
  const committedReferences = useRef(new Map<string, HTMLElement>());
  // Reuse committed portal hosts while preparing the next body offscreen.
  // Moving a live host during render would mutate the currently visible body.
  const references = useMemo(
    () =>
      prepared.references?.map((reference) => ({
        ...reference,
        placeholder: reference.container,
        container:
          committedReferences.current.get(reference.instanceId) ??
          reference.container,
      })) ?? [],
    [prepared],
  );
  const current = useRef<ReturnType<typeof preparePreview> | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const reportError = useRef(onError);
  reportError.current = onError;
  const hasBody = Boolean(prepared.body);
  const controller = useMemo<DocumentPreviewController>(
    () => ({
      getHeadings: () =>
        current.current?.headings?.map((item) => ({ ...item })) ?? [],
      locateHeading(pos) {
        current.current?.targets?.get(pos)?.scrollIntoView?.({
          block: 'start',
          inline: 'nearest',
        });
      },
    }),
    [],
  );
  useLayoutEffect(() => {
    current.current = prepared;
    for (const reference of references)
      if (reference.placeholder !== reference.container)
        reference.placeholder.replaceWith(reference.container);
    if (prepared.body) container.current?.replaceChildren(prepared.body);
    committedReferences.current = new Map(
      references.map(({ instanceId, container }) => [instanceId, container]),
    );
    return () => {
      current.current = null;
    };
  }, [prepared, references]);
  useEffect(() => {
    if (!hasBody) return undefined;
    ready.current?.(controller);
    return () => ready.current?.(null);
  }, [controller, hasBody]);
  useEffect(() => {
    if (prepared.error) reportError.current?.(prepared.error);
  }, [prepared.error]);

  if (prepared.error)
    return (
      <div key="error" className="board-document-error" role="alert">
        无法打开文档正文：{prepared.error}
      </div>
    );

  return (
    <div
      key="preview"
      ref={container}
      className={`board-document-editor readonly${className ? ` ${className}` : ''}`}
    >
      {references.map(({ targetFrameId, instanceId, container }) =>
        createPortal(
          renderFrameReference ? (
            renderFrameReference({ targetFrameId, instanceId })
          ) : (
            <a href={`verd://file/${encodeURIComponent(targetFrameId)}`}>
              打开画布 · {targetFrameId}
            </a>
          ),
          container,
          instanceId,
        ),
      )}
    </div>
  );
}
