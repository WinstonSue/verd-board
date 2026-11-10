import { useCallback, useEffect } from 'react';
import { ResourceReader } from './resource-reader';
import type {
  WorkspaceSession,
  WorkspaceSessionSnapshot,
} from '../session/workspace-session';

export function ordinaryResourceMime(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return (
    (
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        avif: 'image/avif',
        bmp: 'image/bmp',
        pdf: 'application/pdf',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        m4a: 'audio/mp4',
        mp4: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
      } as Record<string, string>
    )[extension] ?? 'application/octet-stream'
  );
}

/** Reads the ordinary original by path; opening it never creates an attachment. */
export function OrdinaryResourceReader({
  session,
  snapshot,
  path,
  onClose,
}: {
  session: WorkspaceSession;
  snapshot: WorkspaceSessionSnapshot;
  path: string;
  onClose(): void;
}) {
  const mime = ordinaryResourceMime(path);
  const resolve = useCallback(async () => {
    const raw = await session.readRawFile(path);
    return URL.createObjectURL(
      new Blob([raw.content as BlobPart], { type: mime }),
    );
  }, [session, path, mime]);
  const entry = snapshot.entries.find(
    (item) => item.path === path && item.kind === 'file',
  );
  useEffect(() => {
    if (!entry) onClose();
  }, [entry, onClose]);
  if (!entry) return null;
  return (
    <ResourceReader
      key={`${path}:${entry.version}`}
      value={{
        src: 'workspace-resource:' + path,
        name: path.split('/').pop()!,
        mime,
        size: entry.size ?? 0,
      }}
      resolve={resolve}
      onClose={onClose}
    />
  );
}
