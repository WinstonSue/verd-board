import {
  createDocumentFoldingRegistry,
  DocumentResourcesContext,
  type DocumentAttachment,
} from '@sue/board-react-text';
import { parseAssetLink } from '@sue/board-common';
import { storeAttachment } from './workspace-resources';
import { AttachmentCard, ResourceReader, WebResource } from './resource-reader';
import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { DocumentAssetContext } from '@sue/board-react-text';
import type { WorkspaceSession } from '../session/workspace-session';
export function WorkspaceAssetScope({
  session,
  children,
  onResolver,
}: {
  session: WorkspaceSession;
  children: ReactNode;
  onResolver?(
    resolve: import('@sue/board-react-text').DocumentAssetResolver,
  ): void;
}) {
  const [reading, setReading] = useState<{
    value: DocumentAttachment;
    page?: number;
  } | null>(null);
  // Each workspace owns its blob URLs, even when the component is reused.
  const cache = useMemo(
    () => ({ session, urls: new Map<string, Promise<string>>() }),
    [session],
  ).urls;
  useEffect(
    () => () => {
      for (const promise of cache.values())
        void promise.then(
          (url) => URL.revokeObjectURL(url),
          () => {},
        );
      cache.clear();
    },
    [cache],
  );
  const resolve = useMemo(
    () => async (source: string) => {
      if (!source.startsWith('verd-asset:')) return source;
      let pending = cache.get(source);
      if (!pending) {
        pending = (async () => {
          const path = source.slice(11);
          if (!/^\.verd-resources\/assets\/[a-z0-9]+\.[a-z0-9]+$/.test(path))
            throw new Error('Invalid attachment address');
          const raw = await session.readRawFile(path);
          const extension = path.split('.').pop();
          const mime =
            extension === 'jpg' || extension === 'jpeg'
              ? 'image/jpeg'
              : `image/${extension}`;
          return URL.createObjectURL(
            new Blob([raw.content as BlobPart], { type: mime }),
          );
        })();
        cache.set(source, pending);
      }
      return pending;
    },
    [cache, session],
  );
  const foldingFor = useMemo(createDocumentFoldingRegistry, [session]);
  const resourceHost = useMemo(
    () => ({
      foldingFor,
      acquire: async (value: DocumentAttachment) => {
        if (
          !/^verd-asset:\.verd-resources\/assets\/[a-f0-9]{64}\.[a-z0-9]+$/.test(
            value.src,
          )
        )
          throw new Error('Invalid attachment');
        const raw = await session.readRawFile(value.src.slice(11));
        const url = URL.createObjectURL(
          new Blob([raw.content as BlobPart], { type: value.mime }),
        );
        let released = false;
        return {
          url,
          mime: value.mime,
          size: raw.content.byteLength,
          release() {
            if (!released) {
              released = true;
              URL.revokeObjectURL(url);
            }
          },
        };
      },
      store: (file: File) => storeAttachment(session, file),
      renderAttachment: (value: DocumentAttachment) => (
        <AttachmentCard value={value} onOpen={() => setReading({ value })} />
      ),
      renderWebEmbed: (
        value: {
          url: string;
          title: string;
          caption?: string;
          width?: number;
          height?: number;
        },
        preview: boolean,
      ) => <WebResource {...value} preview={preview} />,
    }),
    [session, foldingFor],
  );
  useEffect(() => {
    setReading(null);
  }, [session]);
  const resourceResolve = useCallback(
    async (source: string) => {
      const raw = await session.readRawFile(source.slice(11));
      const ext = source.split('.').pop();
      const mime =
        reading?.value.mime ||
        (ext === 'pdf' ? 'application/pdf' : 'application/octet-stream');
      return URL.createObjectURL(
        new Blob([raw.content as BlobPart], { type: mime }),
      );
    },
    [session, reading?.value.mime],
  );
  const resolveReading = resourceResolve;
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.('a');
      const target = link && parseAssetLink(link.getAttribute('href') || '');
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setReading({
        value: {
          src: 'verd-asset:.verd-resources/assets/' + target.assetId,
          name: target.assetId,
          mime: target.assetId.endsWith('.pdf')
            ? 'application/pdf'
            : 'application/octet-stream',
          size: 0,
        },
        page: target.page,
      });
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, [session]);
  onResolver?.(resolve);
  return (
    <DocumentAssetContext.Provider value={resolve}>
      <DocumentResourcesContext.Provider value={resourceHost}>
        {children}
        {reading && (
          <ResourceReader
            key={reading.value.src + ':' + reading.page}
            value={reading.value}
            page={reading.page}
            resolve={resolveReading}
            onClose={() => {
              setReading(null);
            }}
          />
        )}
      </DocumentResourcesContext.Provider>
    </DocumentAssetContext.Provider>
  );
}
