import type { WorkspaceFile } from './document-files';
import { normalizeResourceKey } from '../host/workspace-host';
import { workspaceFileId, isWorkspaceFile } from './document-files';
import type { WorkspaceSession } from '../session/workspace-session';
export interface Revision {
  id: string;
  fileId: string;
  title: string;
  name: string;
  at: number;
  path: string;
}
interface Manifest {
  version: 1;
  revisions: Revision[];
}
const manifestPath = '.verd-resources/history/index.json';
export async function readRevisions(session: WorkspaceSession) {
  try {
    const raw = await session.readRawFile(manifestPath);
    const manifest = JSON.parse(
      new TextDecoder().decode(raw.content),
    ) as Manifest;
    if (manifest.version !== 1 || !Array.isArray(manifest.revisions))
      throw new Error('Invalid history manifest');
    return { manifest, expectedVersion: raw.version };
  } catch (error) {
    // Never treat a corrupt existing index as an empty one: CAS also rejects overwrites.
    const resources = session.getState().resources ?? [];
    if (
      resources.some(
        (entry) => entry.key === normalizeResourceKey(manifestPath),
      )
    )
      throw error;
    return {
      manifest: { version: 1, revisions: [] } as Manifest,
      expectedVersion: null,
    };
  }
}
export async function readRevision(
  session: WorkspaceSession,
  revision: Revision,
) {
  if (
    !/^\.verd-resources\/history\/[a-zA-Z0-9-]+\.snapshot\.json$/.test(
      revision.path,
    )
  )
    throw new Error('Invalid snapshot path');
  const raw = await session.readRawFile(revision.path);
  const file: unknown = JSON.parse(new TextDecoder().decode(raw.content));
  if (!isWorkspaceFile(file) || workspaceFileId(file) !== revision.fileId)
    throw new Error('Invalid snapshot identity');
  return file;
}
export async function restoreRevision(
  session: WorkspaceSession,
  revision: Revision,
) {
  const file = await readRevision(session, revision);
  const current =
    session.getState().documents.get(revision.fileId)?.file ??
    session.getState().files.get(revision.fileId)?.file;
  if (!current) throw new Error('Restore the deleted file from Trash first.');
  const status = (await session.versions({ type: 'status' })).status;
  const entry =
    session.getState().documents.get(revision.fileId) ??
    session.getState().files.get(revision.fileId);
  if (
    status.enabled &&
    status.changes.some((change) => change.path === entry?.path)
  )
    throw new Error('Commit this file before restoring its legacy version.');
  const latest =
    session.getState().documents.get(revision.fileId)?.file ??
    session.getState().files.get(revision.fileId)?.file;
  if (JSON.stringify(latest) !== JSON.stringify(current))
    throw new Error('Content changed while preparing restore; preview again.');
  const result = await session.apply({
    type: 'file',
    file,
    label: 'restore-version',
  });
  if (!result.ok)
    throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  if (!(await session.flush()))
    throw new Error('Version restored in memory; saving requires attention.');
}
export async function storeAttachment(session: WorkspaceSession, file: File) {
  const image = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
    file.type,
  );
  const media = /^(audio|video)\//.test(file.type);
  const limit = (image ? 10 : media ? 100 : 50) * 1024 * 1024;
  if (file.size > limit) throw new Error(`附件超过 ${limit / 1024 / 1024} MiB`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  const extension = image
    ? file.type.split('/')[1]
    : file.name
        .split('.')
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 12) || 'bin';
  const path = `.verd-resources/assets/${hash}.${extension}`;
  if (
    !(session.getState().resources ?? []).some(
      (entry) => entry.key === normalizeResourceKey(path),
    )
  ) {
    const result = await session.commitResources([
      { path, content: bytes, expectedVersion: null },
    ]);
    if (result.outcome !== 'applied') {
      const existing = await session.readRawFile(path);
      if (
        existing.content.length !== bytes.length ||
        existing.content.some((value, index) => value !== bytes[index])
      )
        throw new Error('Attachment save failed');
    }
  }
  return {
    path,
    hash,
    src: 'verd-asset:' + path,
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
  };
}

export async function inlineFileAssets(
  session: WorkspaceSession,
  file: WorkspaceFile,
): Promise<WorkspaceFile> {
  const copy = structuredClone(file);
  const visit = async (value: unknown): Promise<void> => {
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    if (obj['type'] === 'attachment') return;
    if (
      typeof obj['src'] === 'string' &&
      obj['src'].startsWith('verd-asset:')
    ) {
      const path = obj['src'].slice(11);
      if (!path.startsWith('.verd-resources/assets/'))
        throw new Error('Invalid attachment path');
      const raw = await session.readRawFile(path);
      const extension = path.split('.').pop();
      const mime =
        extension === 'jpeg' || extension === 'jpg'
          ? 'image/jpeg'
          : `image/${extension}`;
      let binary = '';
      for (const byte of raw.content) binary += String.fromCharCode(byte);
      obj['src'] = `data:${mime};base64,${btoa(binary)}`;
    }
    await Promise.all(Object.values(obj).map(visit));
  };
  await visit(copy);
  return copy;
}
