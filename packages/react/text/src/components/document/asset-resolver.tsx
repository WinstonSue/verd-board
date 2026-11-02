import { createContext, useContext, useEffect, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
export type DocumentAssetResolver = (source: string) => Promise<string>;
export const DocumentAssetContext = createContext<DocumentAssetResolver>(
  (source) => Promise.resolve(source),
);
export function DocumentImageView({ node }: NodeViewProps) {
  const resolve = useContext(DocumentAssetContext);
  const source = String(node.attrs['src'] ?? '');
  const [url, setUrl] = useState(
    source.startsWith('verd-asset:') ? '' : source,
  );
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setError('');
    void resolve(source).then(
      (value) => {
        if (alive) setUrl(value);
      },
      () => {
        if (alive) setError('图片资源不可用');
      },
    );
    return () => {
      alive = false;
    };
  }, [source, resolve]);
  return (
    <NodeViewWrapper
      as="figure"
      contentEditable={false}
      className="document-image"
    >
      <img
        src={url || undefined}
        alt={String(node.attrs['alt'] ?? '')}
        title={String(node.attrs['title'] ?? '')}
        width={node.attrs['width'] || undefined}
        style={{ maxWidth: '100%' }}
      />
      {node.attrs['caption'] && (
        <figcaption>{String(node.attrs['caption'])}</figcaption>
      )}
      {error && <span role="status">{error}</span>}
    </NodeViewWrapper>
  );
}
