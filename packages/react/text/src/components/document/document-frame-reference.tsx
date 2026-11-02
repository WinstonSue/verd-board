import React, { createContext, useContext, useId } from 'react';
import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';

export interface DocumentFrameReferenceProps {
  targetFrameId: string;
  /** Runtime occurrence identity; never part of the persisted body. */
  instanceId: string;
}
export type DocumentFrameReferenceRenderer = (
  props: DocumentFrameReferenceProps,
) => React.ReactNode;
export const DocumentFrameReferenceContext = createContext<
  DocumentFrameReferenceRenderer | undefined
>(undefined);

function FrameReferenceView({ node, getPos }: NodeViewProps) {
  const render = useContext(DocumentFrameReferenceContext);
  const fallback = useId();
  const instanceId = String(getPos() ?? fallback);
  const targetFrameId =
    node.type.name === 'documentExcerpt'
      ? 'excerpt:' +
        encodeURIComponent(String(node.attrs['targetDocumentId'])) +
        ':' +
        encodeURIComponent(String(node.attrs['targetBlockId']))
      : String(node.attrs['targetFrameId'] ?? '');
  return (
    <NodeViewWrapper
      className="document-frame-reference"
      contentEditable={false}
      data-frame-reference={targetFrameId}
    >
      {render ? (
        render({ targetFrameId, instanceId })
      ) : (
        <a href={`verd://file/${encodeURIComponent(targetFrameId)}`}>
          打开画布 · {targetFrameId}
        </a>
      )}
    </NodeViewWrapper>
  );
}

/** Only standalone documents register this node; canvas labels remain unchanged. */
export const DocumentFrameReference = Node.create({
  name: 'frameReference',
  group: 'block',
  atom: true,
  draggable: true,
  isolating: true,
  addAttributes() {
    return {
      targetFrameId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-target-frame-id'),
        renderHTML: (attrs) => ({
          'data-target-frame-id': attrs['targetFrameId'],
        }),
      },
    };
  },
  parseHTML: () => [{ tag: 'figure[data-target-frame-id]' }],
  renderHTML({ node, HTMLAttributes }) {
    return [
      'figure',
      HTMLAttributes,
      [
        'a',
        {
          href: `verd://file/${encodeURIComponent(String(node.attrs['targetFrameId']))}`,
        },
        '打开画布',
      ],
    ];
  },
  renderText({ node }) {
    return `打开画布 verd://file/${encodeURIComponent(String(node.attrs['targetFrameId']))}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(FrameReferenceView);
  },
});

export const DocumentExcerpt = Node.create({
  name: 'documentExcerpt',
  group: 'block',
  atom: true,
  draggable: true,
  isolating: true,
  addAttributes: () => ({
    targetDocumentId: { default: '' },
    targetBlockId: { default: '' },
  }),
  parseHTML: () => [
    {
      tag: 'figure[data-document-excerpt]',
      getAttrs: (element) => ({
        targetDocumentId: element.getAttribute('data-document-excerpt'),
        targetBlockId: element.getAttribute('data-excerpt-block'),
      }),
    },
  ],
  renderHTML: ({ node }) => [
    'figure',
    {
      'data-document-excerpt': node.attrs['targetDocumentId'],
      'data-excerpt-block': node.attrs['targetBlockId'],
    },
    [
      'a',
      {
        href: `verd://file/${encodeURIComponent(String(node.attrs['targetDocumentId']))}#${encodeURIComponent('block:' + node.attrs['targetBlockId'])}`,
      },
      '引用段落',
    ],
  ],
  addNodeView() {
    return ReactNodeViewRenderer(FrameReferenceView);
  },
});
