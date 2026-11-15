import { useEffect, useMemo, useState } from 'react';
import {
  CanvasPreview,
  DocumentPreview,
  WorkspaceButton,
  WorkspaceEmptyState,
} from '@sue/verd-board-ui';
import {
  DocumentAssetContext,
  DocumentResourcesContext,
  type DocumentAttachment,
} from '@sue/board-react-text';
import { parseAssetLink, parseWorkspaceLink } from '@sue/board-common';
import type { VersionFile } from '@sue/verd-board-workspace';
import type {
  WorkspaceFileEntry,
  WorkspaceSession,
  WorkspaceSessionSnapshot,
} from '@sue/verd-board-workspace';
import {
  assembleWorkspaceStore,
  buildFrameReferenceGraph,
  type FrameFileV2,
} from '@sue/verd-board-workspace';
import {
  isWorkspaceFile,
  workspaceFileId,
  type DocumentFileV1,
} from '@sue/verd-board-workspace';
import { buildWorkspaceReferenceGraph } from '@sue/verd-board-workspace';
import { AttachmentCard, ResourceReader } from './resource-reader';
import {
  WorkspaceCanvasReference,
  workspaceDocumentPreviews,
  type PreviewOptions,
} from './workspace-previews';

/** Build the preview entirely from one commit, without borrowing live references. */
export function versionSnapshot(
  current: WorkspaceSessionSnapshot,
  versionFiles: readonly VersionFile[],
  versionId: string,
): WorkspaceSessionSnapshot {
  const files = new Map<string, WorkspaceFileEntry<FrameFileV2>>();
  const documents = new Map<string, WorkspaceFileEntry<DocumentFileV1>>();
  const fileIdByPath = new Map<string, string>();
  for (const item of versionFiles) {
    if (!/\.verd(?:-doc)?\.json$/.test(item.path)) continue;
    const value: unknown = JSON.parse(new TextDecoder().decode(item.content));
    if (!isWorkspaceFile(value))
      throw new Error('Invalid historical file: ' + item.path);
    const id = workspaceFileId(value);
    if (files.has(id) || documents.has(id))
      throw new Error('Duplicate historical file identity: ' + id);
    const entry = {
      file: value,
      path: item.path,
      version: versionId,
      dirty: false,
    };
    if (value.format === 'verd-frame') files.set(id, { ...entry, file: value });
    else documents.set(id, { ...entry, file: value });
    fileIdByPath.set(item.path, id);
  }
  const frames = [...files.values()].map((entry) => entry.file);
  const all = [
    ...frames,
    ...[...documents.values()].map((entry) => entry.file),
  ];
  const assembled = assembleWorkspaceStore(frames);
  return {
    ...current,
    files,
    documents,
    fileIdByPath,
    store: assembled.store,
    graph: buildFrameReferenceGraph(frames),
    references: buildWorkspaceReferenceGraph(all),
    diagnostics: assembled.diagnostics,
    failedFiles: new Map(),
    filePersistence: new Map(),
    entries: versionFiles.map((item) => ({
      path: item.path,
      kind: 'file' as const,
      canvas: /\.verd\.json$/.test(item.path),
    })),
    resources: [],
    canUndo: false,
    canRedo: false,
    dirty: false,
  };
}

export function ContentVersionPreview({
  session,
  files,
  versionId,
  fileId,
  path,
  locale,
  directoryPath,
}: {
  session: WorkspaceSession;
  files: VersionFile[];
  versionId: string;
  fileId?: string;
  path?: string;
  locale: 'zh' | 'en';
  directoryPath?: string;
}) {
  const snapshot = useMemo(
    () => versionSnapshot(session.getState(), files, versionId),
    [session, files, versionId],
  );
  const choices = [
    ...snapshot.documents.values(),
    ...snapshot.files.values(),
  ].filter(
    (entry) => !directoryPath || entry.path.startsWith(directoryPath + '/'),
  );
  const [selected, setSelected] = useState(
    fileId ??
      (path ? snapshot.fileIdByPath.get(path) : undefined) ??
      (choices[0] ? workspaceFileId(choices[0].file) : undefined),
  );
  const ordinary = files.filter(
    (item) =>
      !snapshot.fileIdByPath.has(item.path) &&
      !item.path.endsWith('/.verd-folder.json') &&
      (!directoryPath || item.path.startsWith(directoryPath + '/')),
  );
  const [rawPath, setRawPath] = useState(
    path && !snapshot.fileIdByPath.has(path)
      ? path
      : !choices.length
        ? ordinary[0]?.path
        : undefined,
  );
  const [reading, setReading] = useState<{
    value: DocumentAttachment;
    page?: number;
  } | null>(null);
  const urls = useMemo(() => new Map<string, string>(), [files]);
  const bytes = useMemo(
    () => new Map(files.map((entry) => [entry.path, entry.content])),
    [files],
  );
  const resolveAsset = useMemo(
    () => async (source: string) => {
      if (!source.startsWith('verd-asset:')) return source;
      const path = source
        .slice(11)
        .replace(/^\.verd-resources\//, '.verdscrolls/resources/');
      const content = bytes.get(path) ?? bytes.get(source.slice(11));
      if (!content)
        throw new Error(
          locale === 'zh'
            ? '此版本未包含该资源'
            : 'This resource is absent from this version',
        );
      let url = urls.get(path);
      if (!url) {
        const extension = path.split('.').pop();
        const mime =
          extension === 'svg'
            ? 'image/svg+xml'
            : extension === 'jpg' || extension === 'jpeg'
              ? 'image/jpeg'
              : extension === 'pdf'
                ? 'application/pdf'
                : `image/${extension}`;
        url = URL.createObjectURL(
          new Blob([content as BlobPart], { type: mime }),
        );
        urls.set(path, url);
      }
      return url;
    },
    [bytes, urls, locale],
  );
  useEffect(
    () => () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    },
    [urls],
  );
  // ResourceReader owns and revokes its URL; do not hand it a cached image URL.
  const resolveReading = useMemo(
    () => async (source: string) => {
      const logical = source.slice(11);
      const content =
        bytes.get(
          logical.replace(/^\.verd-resources\//, '.verdscrolls/resources/'),
        ) ?? bytes.get(logical);
      if (!content)
        throw new Error(
          locale === 'zh'
            ? '此版本未包含该资源'
            : 'This resource is absent from this version',
        );
      return URL.createObjectURL(
        new Blob([content as BlobPart], {
          type: reading?.value.mime ?? 'application/octet-stream',
        }),
      );
    },
    [bytes, reading?.value.mime, locale],
  );
  const options: PreviewOptions = {
    snapshot,
    instance: 'version:' + versionId,
    path: selected ? [selected] : [],
    active: true,
    scroll: new Map(),
    locale,
    resolveAsset,
    open: (id) => {
      setRawPath(undefined);
      setSelected(id);
    },
    openLink: () => {},
  };
  const file =
    !rawPath && selected
      ? (snapshot.documents.get(selected)?.file ??
        snapshot.files.get(selected)?.file)
      : undefined;
  const rawFile = rawPath
    ? files.find((item) => item.path === rawPath)
    : undefined;
  const rawText = useMemo(() => {
    if (!rawFile || rawFile.content.slice(0, 8192).includes(0)) return null;
    try {
      return new TextDecoder('utf-8', { fatal: true })
        .decode(rawFile.content)
        .slice(0, 200000);
    } catch {
      return null;
    }
  }, [rawFile]);
  return (
    <DocumentAssetContext.Provider value={resolveAsset}>
      <DocumentResourcesContext.Provider
        value={{
          renderAttachment: (value) => (
            <AttachmentCard
              value={value}
              onOpen={() => setReading({ value })}
            />
          ),
        }}
      >
        <section
          className="workspace-git-preview"
          data-testid="git-version-preview"
          data-version-preview
          onClickCapture={(event) => {
            const anchor = (event.target as Element)?.closest?.('a[href]');
            const href = anchor?.getAttribute('href');
            if (!href) return;
            const asset = parseAssetLink(href);
            const target = parseWorkspaceLink(href, selected);
            if (asset || target) {
              event.preventDefault();
              event.stopPropagation();
              if (asset)
                setReading({
                  value: {
                    src: 'verd-asset:.verd-resources/assets/' + asset.assetId,
                    name: asset.assetId,
                    mime: asset.assetId.endsWith('.pdf')
                      ? 'application/pdf'
                      : 'application/octet-stream',
                    size:
                      bytes.get(
                        '.verdscrolls/resources/assets/' + asset.assetId,
                      )?.byteLength ?? 0,
                  },
                  page: asset.page,
                });
              else if (target && 'fileId' in target) {
                setRawPath(undefined);
                setSelected(target.fileId);
              }
            }
          }}
        >
          <p>
            {locale === 'zh'
              ? '正文、引用与资源均读取自此提交。'
              : 'Content, references and assets come from this commit.'}
          </p>
          <label>
            {locale === 'zh' ? '预览文件' : 'Preview file'}
            <select
              value={rawPath ? 'path:' + rawPath : 'file:' + (selected ?? '')}
              onChange={(event) => {
                const value = event.target.value;
                if (value.startsWith('path:')) setRawPath(value.slice(5));
                else {
                  setRawPath(undefined);
                  setSelected(value.slice(5));
                }
              }}
            >
              {choices.map((entry) => (
                <option
                  key={workspaceFileId(entry.file)}
                  value={'file:' + workspaceFileId(entry.file)}
                >
                  {entry.path}
                </option>
              ))}
              {ordinary.map((entry) => (
                <option key={entry.path} value={'path:' + entry.path}>
                  {entry.path}
                </option>
              ))}
            </select>
          </label>
          {!file && !rawFile && (
            <WorkspaceEmptyState
              description={
                locale === 'zh'
                  ? '此版本中没有该文件'
                  : 'This file is absent from this version'
              }
            />
          )}
          {rawFile && (
            <section className="workspace-git-raw-preview">
              <p>
                <code>{rawFile.path}</code> ·{' '}
                {rawFile.content.byteLength.toLocaleString()} bytes
              </p>
              <WorkspaceButton
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([rawFile.content as BlobPart]),
                  );
                  const anchor = document.createElement('a');
                  anchor.href = url;
                  anchor.download =
                    rawFile.path.split('/').at(-1) ?? rawFile.path;
                  anchor.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                {locale === 'zh' ? '下载此版本文件' : 'Download this version'}
              </WorkspaceButton>
              {rawText === null ? (
                <p>
                  {locale === 'zh'
                    ? '二进制文件，可下载此版本查看。'
                    : 'Binary file. Download this version to inspect it.'}
                </p>
              ) : (
                <>
                  <pre>{rawText}</pre>
                  {rawFile.content.byteLength > 200000 && (
                    <p>
                      {locale === 'zh'
                        ? '仅展示前 200,000 个字符。'
                        : 'Only the first 200,000 characters are shown.'}
                    </p>
                  )}
                </>
              )}
            </section>
          )}
          {file?.format === 'verd-document' && (
            <DocumentPreview
              value={file.text}
              renderFrameReference={({ targetFrameId, instanceId }) => (
                <WorkspaceCanvasReference
                  targetFrameId={targetFrameId}
                  options={{
                    ...options,
                    instance: options.instance + ':' + instanceId,
                  }}
                />
              )}
            />
          )}
          {file?.format === 'verd-frame' && (
            <div className="workspace-git-canvas-preview">
              <CanvasPreview
                value={{ store: snapshot.store }}
                frameId={file.frame.id}
                documentReferences={workspaceDocumentPreviews(options)}
              />
            </div>
          )}
          {reading && (
            <ResourceReader
              value={reading.value}
              page={reading.page}
              resolve={resolveReading}
              onClose={() => setReading(null)}
            />
          )}
        </section>
      </DocumentResourcesContext.Provider>
    </DocumentAssetContext.Provider>
  );
}
