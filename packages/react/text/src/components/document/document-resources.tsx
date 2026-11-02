import React, { createContext, useContext } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
export interface DocumentAttachment {
  src: string;
  name: string;
  mime: string;
  size: number;
  caption?: string;
  display?: 'card' | 'embed';
}
export interface DocumentResourceHandle {
  url: string;
  mime: string;
  size: number;
  release(): void;
}
export interface DocumentResourceHost {
  acquire?(value: DocumentAttachment): Promise<DocumentResourceHandle>;
  foldingFor?(key: string): import('./folding-store').DocumentFoldingAdapter;
  store?(file: File): Promise<DocumentAttachment>;
  renderAttachment?(
    value: DocumentAttachment,
    preview: boolean,
  ): React.ReactNode;
  renderWebEmbed?(
    value: {
      url: string;
      title: string;
      caption?: string;
      width?: number;
      height?: number;
    },
    preview: boolean,
  ): React.ReactNode;
}
export const DocumentResourcesContext = createContext<DocumentResourceHost>({});
export function ResourceContent({
  attrs,
  web = false,
  preview = false,
}: {
  attrs: Record<string, unknown>;
  web?: boolean;
  preview?: boolean;
}) {
  const host = useContext(DocumentResourcesContext);
  if (web)
    return (
      <>
        {host.renderWebEmbed?.(
          attrs as unknown as { url: string; title: string },
          preview,
        ) ?? (
          <a href={String(attrs['url'])} target="_blank" rel="noreferrer">
            {String(attrs['title'] || attrs['url'])}
          </a>
        )}
      </>
    );
  const value = attrs as unknown as DocumentAttachment;
  return (
    <>
      {host.renderAttachment?.(value, preview) ?? (
        <span>
          {value.name} · {value.mime} · {value.size} bytes
        </span>
      )}
    </>
  );
}
function ResourceView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper className="document-resource" contentEditable={false}>
      <ResourceContent attrs={node.attrs} web={node.type.name === 'webEmbed'} />
    </NodeViewWrapper>
  );
}
export const Attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({
    src: { default: '' },
    name: { default: '' },
    mime: { default: 'application/octet-stream' },
    size: { default: 0 },
    caption: { default: '' },
    display: { default: 'card' },
  }),
  parseHTML: () => [{ tag: 'div[data-attachment]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-attachment': '' }),
    HTMLAttributes['name'],
  ],
  addNodeView: () => ReactNodeViewRenderer(ResourceView),
});
export const WebEmbed = Node.create({
  name: 'webEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({
    display: { default: 'card' },
    url: { default: '' },
    title: { default: '' },
    caption: { default: '' },
    width: { default: 640 },
    height: { default: 400 },
  }),
  parseHTML: () => [{ tag: 'div[data-web-embed]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-web-embed': '' }),
    HTMLAttributes['title'] || HTMLAttributes['url'],
  ],
  addNodeView: () => ReactNodeViewRenderer(ResourceView),
});
