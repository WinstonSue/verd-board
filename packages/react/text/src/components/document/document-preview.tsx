import {
  DocumentResourcesContext,
  type DocumentResourceHost,
  ResourceContent,
} from './document-resources';
import katex from 'katex';
import { setFoldIcon } from '../../utils/fold-icon';
import {
  prepareListFolding,
  revealPreviewTarget,
  validateRichContent,
} from './document-rich-content';
import { DocumentAssetContext } from './asset-resolver';
import { useEffect, useLayoutEffect, useMemo, useRef, useContext } from 'react';
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
> & { locateBlock(id: string): boolean };

export interface DocumentPreviewProps {
  mode?: 'preview' | 'export';
  folding?: import('./folding-store').DocumentFoldingAdapter;
  foldingKey?: string;
  renderAttachment?: DocumentResourceHost['renderAttachment'];
  renderWebEmbed?: DocumentResourceHost['renderWebEmbed'];
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
    details: (node) => [
      'details',
      { 'data-block-id': node.attrs['blockId'] || '' },
      0,
    ],
    detailsSummary: () => ['summary', {}, 0],
    detailsContent: () => ['div', {}, 0],
    documentExcerpt: (node) => [
      'div',
      {
        class: 'document-frame-reference',
        'data-block-id': node.attrs['blockId'] || '',
        'data-document-excerpt': node.attrs['targetDocumentId'],
      },
    ],
    frameReference: (node) => [
      'div',
      {
        class: 'document-frame-reference',
        'data-block-id': node.attrs['blockId'] || '',
        'data-frame-reference': String(node.attrs['targetFrameId'] ?? ''),
      },
    ],
  },
  documentSerializer.marks,
);

function preparePreview(
  content: BoardTextDocument['content'],
  folding?: import('./folding-store').DocumentFoldingAdapter,
  exporting = false,
) {
  try {
    validateRichContent(content);
    const node = schema.nodeFromJSON(content);
    node.check();
    const body = document.createElement('div');
    body.className = 'board-document-content board-document-preview-content';
    // A preview can itself be embedded inside an editable document.
    body.setAttribute('contenteditable', 'false');
    body.append(serializer.serializeFragment(node.content));
    if (!exporting) prepareListFolding(body, folding);
    for (const element of body.querySelectorAll<HTMLDetailsElement>(
      'details',
    )) {
      if (exporting) {
        element.open = true;
        continue;
      }
      const id = element.dataset['blockId'];
      const summary = element.querySelector('summary');
      const icon = document.createElement('span');
      icon.className = 'document-summary-fold';
      icon.setAttribute('aria-hidden', 'true');
      summary?.prepend(icon);
      element.classList.add('document-lucide-details');
      if (id) element.open = folding?.getSnapshot().get(id) === false;
      setFoldIcon(icon, !element.open);
      element.ontoggle = () => {
        setFoldIcon(icon, !element.open);
        if (id) folding?.setCollapsed(id, !element.open);
      };
    }
    for (const formula of body.querySelectorAll<HTMLElement>('[data-latex]')) {
      formula.innerHTML = katex.renderToString(formula.dataset['latex'] ?? '', {
        displayMode: formula.tagName === 'DIV',
        throwOnError: false,
        trust: false,
      });
    }
    // Match ProseMirror's line boxes for empty blocks and trailing hard breaks.
    body.querySelectorAll('p, h1, h2, h3, h4, h5, h6').forEach((block) => {
      if (!block.childNodes.length || block.lastChild?.nodeName === 'BR')
        block.append(document.createElement('br'));
    });
    body.querySelectorAll('a').forEach((link) => {
      link.draggable = false;
    });
    const resources: {
      attrs: Record<string, unknown>;
      web: boolean;
      container: HTMLElement;
    }[] = [];
    const resourceElements = Array.from(
      body.querySelectorAll<HTMLElement>('[data-attachment],[data-web-embed]'),
    );
    node.descendants((child) => {
      if (child.type.name === 'attachment' || child.type.name === 'webEmbed')
        resources.push({
          attrs: child.attrs,
          web: child.type.name === 'webEmbed',
          container: resourceElements[resources.length],
        });
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
      if (
        child.type.name === 'frameReference' ||
        child.type.name === 'documentExcerpt'
      ) {
        const targetFrameId =
          child.type.name === 'documentExcerpt'
            ? 'excerpt:' +
              encodeURIComponent(String(child.attrs['targetDocumentId'])) +
              ':' +
              encodeURIComponent(String(child.attrs['targetBlockId']))
            : String(child.attrs['targetFrameId'] ?? '');
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
      resources,
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
  mode = 'preview',
  folding: suppliedFolding,
  foldingKey,
  renderFrameReference,
  onReady,
  onError,
  className,
  renderAttachment,
  renderWebEmbed,
}: DocumentPreviewProps) {
  const inheritedResources = useContext(DocumentResourcesContext);
  const resources = useMemo(
    () => ({
      ...inheritedResources,
      ...(renderAttachment ? { renderAttachment } : {}),
      ...(renderWebEmbed ? { renderWebEmbed } : {}),
    }),
    [inheritedResources, renderAttachment, renderWebEmbed],
  );
  const resolveAsset = useContext(DocumentAssetContext);
  const folding =
    suppliedFolding ?? resources.foldingFor?.(foldingKey ?? value.id);
  const prepared = useMemo(
    () => preparePreview(value.content, folding, mode === 'export'),
    [value.content, folding, mode],
  );
  useEffect(() => {
    if (!folding || mode === 'export') return;
    return folding.subscribe(() => {
      const state = folding.getSnapshot();
      for (const item of prepared.body?.querySelectorAll<HTMLElement>(
        'li[data-block-id]',
      ) ?? []) {
        const collapsed = state.get(item.dataset['blockId']!);
        if (collapsed === undefined) continue;
        for (const child of item.children)
          if (child instanceof HTMLElement && child.matches('ul,ol'))
            child.hidden = collapsed;
        const button = item.querySelector<HTMLButtonElement>(
          ':scope > .document-list-fold',
        );
        if (button) {
          button.setAttribute('aria-expanded', String(!collapsed));
          setFoldIcon(button, collapsed);
        }
      }
      for (const item of prepared.body?.querySelectorAll<HTMLDetailsElement>(
        'details[data-block-id]',
      ) ?? []) {
        const collapsed = state.get(item.dataset['blockId']!);
        if (collapsed !== undefined) item.open = !collapsed;
      }
    });
  }, [folding, prepared, mode]);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    for (const image of prepared.body?.querySelectorAll('img') ?? []) {
      const src = image.getAttribute('src') ?? '';
      if (!src.startsWith('verd-asset:')) continue;
      image.dataset['referencePending'] = 'true';
      void resolveAsset(src).then(
        (url) => {
          if (alive) {
            image.src = url;
            delete image.dataset['referencePending'];
          }
        },
        () => {
          if (alive) {
            image.alt = '图片资源不可用';
            delete image.dataset['referencePending'];
          }
        },
      );
    }
    return () => {
      alive = false;
    };
  }, [prepared, resolveAsset]);

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
  const reveal = (element: HTMLElement | undefined) => {
    if (!element) return false;
    revealPreviewTarget(element);
    element.scrollIntoView?.({ block: 'start', inline: 'nearest' });
    return true;
  };
  const controller = useMemo<DocumentPreviewController>(
    () => ({
      getHeadings: () =>
        current.current?.headings?.map((item) => ({ ...item })) ?? [],
      locateHeading(pos) {
        reveal(current.current?.targets?.get(pos));
      },
      locateBlock(id) {
        const blocks =
          current.current?.body?.querySelectorAll<HTMLElement>(
            '[data-block-id]',
          );
        return reveal(
          Array.from(blocks ?? []).find(
            (block) => block.dataset['blockId'] === id,
          ),
        );
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
    <DocumentResourcesContext.Provider value={resources}>
      <div
        key="preview"
        ref={container}
        className={`board-document-editor readonly${className ? ` ${className}` : ''}`}
      >
        {prepared.resources?.map((resource, index) =>
          createPortal(
            <ResourceContent
              attrs={resource.attrs}
              web={resource.web}
              preview
            />,
            resource.container,
            `resource-${index}`,
          ),
        )}
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
    </DocumentResourcesContext.Provider>
  );
}
