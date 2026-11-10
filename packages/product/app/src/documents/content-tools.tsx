import { useEffect, useRef, useState } from 'react';
import {
  DocumentPreview,
  VmDialog,
  CanvasPreview,
  ContentPropertiesPanel,
  ContentImageProperties,
  WorkspaceAlert,
  WorkspaceButton,
  WorkspaceEmptyState,
  WorkspaceDialogTabs,
} from '@sue/verd-board-ui';
import type { BoardTextNode } from '@sue/board-common';
import { assembleWorkspaceStore } from '../frames/frame-files';
import {
  workspaceFileId,
  isWorkspaceFile,
  type WorkspaceFile,
} from './document-files';
import type { WorkspaceSession } from '../session/workspace-session';
import {
  readRevisions,
  readRevision,
  restoreRevision,
  storeAttachment,
  type Revision,
} from './workspace-resources';
import { portableArchiveWithAssets } from './portable-archive';
import { VersionHistoryPanel } from './version-history-panel';
const download = (name: string, bytes: Uint8Array) => {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export function ContentTools({
  session,
  fileId,
  readonly,
  request,
  onKeepBoth,
  onVersionSettings,
  locale = 'zh',
}: {
  locale?: 'zh' | 'en';
  session: WorkspaceSession;
  fileId: string;
  readonly: boolean;
  request?: { nonce: number; tab: string };
  onKeepBoth(): Promise<void>;
  onVersionSettings?(): void;
}) {
  const [shown, setShown] = useState(false),
    [tab, setTab] = useState('properties');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revisions, setRevisions] = useState<Revision[]>([]),
    [loadingRevisions, setLoadingRevisions] = useState(false);
  const [comparison, setComparison] = useState<WorkspaceFile | null>(null);
  const lastInteraction = useRef<'pointer' | 'keyboard'>('keyboard');
  const [pointerFocus, setPointerFocus] = useState(false);
  const closeTools = () => {
    setPointerFocus(lastInteraction.current === 'pointer');
    setShown(false);
  };
  const zh = locale === 'zh';
  const t = (a: string, b: string) => (zh ? a : b);
  useEffect(() => {
    if (request) {
      setTab(request.tab);
      setShown(true);
    }
  }, [request]);
  const state = session.getState();
  const entry = state.documents.get(fileId) ?? state.files.get(fileId);
  const file = entry?.file;
  useEffect(() => {
    if (!shown) return;
    let current = true;
    setLoadingRevisions(true);
    void readRevisions(session)
      .then(
        (value) => {
          if (current)
            setRevisions(
              value.manifest.revisions.filter((item) => item.fileId === fileId),
            );
        },
        (cause) => {
          if (current) setError(String(cause));
        },
      )
      .finally(() => {
        if (current) setLoadingRevisions(false);
      });
    return () => {
      current = false;
    };
  }, [shown, session, fileId]);
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const patch = async (next: WorkspaceFile) => {
    const result = await session.apply({
      type: 'file',
      file: next,
      label: 'content-properties',
    });
    if (!result.ok)
      throw new Error(
        result.diagnostics.map((issue) => issue.message).join('; '),
      );
  };
  if (!file || !entry) return null;
  const images: { node: BoardTextNode; index: number }[] = [];
  const walk = (node: BoardTextNode) => {
    if (node.type === 'image') images.push({ node, index: images.length });
    node.content?.forEach(walk);
  };
  if (file.format === 'verd-document') walk(file.text.content);
  const imagePatch = async (index: number, attrs: Record<string, unknown>) => {
    const live = session.getState().documents.get(fileId)?.file;
    if (!live) throw new Error('Document no longer exists');
    const next = structuredClone(live);
    let n = 0;
    const visit = (node: BoardTextNode) => {
      if (node.type === 'image' && n++ === index) {
        const original = images[index]?.node;
        if (
          !original ||
          (original.attrs?.['blockId'] &&
            original.attrs['blockId'] !== node.attrs?.['blockId']) ||
          original.attrs?.['src'] !== node.attrs?.['src']
        )
          throw new Error('Image changed; select it again.');
        node.attrs = { ...node.attrs, ...attrs };
      }
      node.content?.forEach(visit);
    };
    visit(next.text.content);
    if (n <= index) throw new Error('Image no longer exists');
    await patch(next);
  };
  const preview = (value: WorkspaceFile) =>
    value.format === 'verd-document' ? (
      <DocumentPreview value={value.text} />
    ) : (
      <div style={{ height: 360 }}>
        <CanvasPreview
          frameId={value.frame.id}
          value={{
            store: assembleWorkspaceStore(
              [...state.files.values()].map((item) =>
                item.file.frame.id === value.frame.id ? value : item.file,
              ),
            ).store,
          }}
        />
      </div>
    );
  const panel = (
    <>
      {tab === 'properties' && (
        <ContentPropertiesPanel
          locale={locale}
          identity={fileId}
          value={{ tags: [], ...file.properties }}
          disabled={readonly || busy}
          onChange={async (properties) => {
            const live =
              session.getState().documents.get(fileId)?.file ??
              session.getState().files.get(fileId)?.file;
            if (!live) throw new Error('Content removed');
            await patch({ ...live, properties });
          }}
        />
      )}
      {tab === 'history' && (
        <>
          <VersionHistoryPanel
            session={session}
            scope={{ kind: 'file', fileId }}
            onSettings={
              onVersionSettings
                ? () => {
                    closeTools();
                    onVersionSettings();
                  }
                : undefined
            }
            readonly={readonly}
            locale={locale}
            onBusyChange={setBusy}
          />
          <h3>{t('旧版检查点', 'Legacy checkpoints')}</h3>
          <p>
            {t(
              '已有检查点仍可预览和恢复；新版本通过手动创建保存。旧检查点仅保存单个文件。',
              'Existing checkpoints remain available to preview and restore. New versions are created manually. Legacy checkpoints contain one file only.',
            )}
          </p>
          <div className="workspace-revision-list" aria-busy={loadingRevisions}>
            {loadingRevisions && (
              <p role="status">{t('正在加载版本…', 'Loading versions…')}</p>
            )}
            {!loadingRevisions && !revisions.length && (
              <WorkspaceEmptyState
                description={t('暂无版本', 'No versions yet')}
              />
            )}
            {revisions.map((revision) => (
              <div key={revision.id} className="workspace-revision-row">
                <div className="workspace-revision-title">
                  <strong>{revision.name}</strong>
                  <time dateTime={new Date(revision.at).toISOString()}>
                    {new Date(revision.at).toLocaleString(
                      zh ? 'zh-CN' : 'en-US',
                    )}
                  </time>
                </div>
                <div className="workspace-revision-actions">
                  <WorkspaceButton
                    disabled={busy}
                    onClick={() =>
                      void perform(async () =>
                        setComparison(await readRevision(session, revision)),
                      )
                    }
                  >
                    {t('预览', 'Preview')}
                  </WorkspaceButton>
                  <WorkspaceButton
                    disabled={readonly || busy}
                    onClick={() =>
                      void perform(async () => {
                        await restoreRevision(session, revision);
                        setComparison(null);
                        setRevisions(
                          (
                            await readRevisions(session)
                          ).manifest.revisions.filter(
                            (item) => item.fileId === fileId,
                          ),
                        );
                      })
                    }
                  >
                    {t('恢复此版本', 'Restore version')}
                  </WorkspaceButton>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'attachments' && (
        <>
          <p>
            {t(
              `图片 ${images.length} 张。资源与历史版本一同保留。`,
              `${images.length} images. Resources are kept with version history.`,
            )}
          </p>
          {images.map(({ node, index }) => (
            <fieldset key={index} disabled={readonly || busy}>
              <legend>
                {String(
                  node.attrs?.['alt'] ?? t('图片 ', 'Image ') + (index + 1),
                )}
              </legend>
              <ContentImageProperties
                locale={locale}
                identity={fileId + ':image:' + index}
                index={index}
                width={Number(node.attrs?.['width']) || undefined}
                caption={String(node.attrs?.['caption'] ?? '')}
                disabled={readonly || busy}
                onChange={(patch) => imagePatch(index, patch)}
              />
              <WorkspaceButton
                disabled={
                  !String(node.attrs?.['src'] ?? '').startsWith('data:image/')
                }
                onClick={() =>
                  void perform(async () => {
                    const src = String(node.attrs?.['src'] ?? '');
                    if (!src.startsWith('data:image/'))
                      throw new Error(
                        t(
                          '仅支持提取已内嵌图片',
                          'Only embedded images can be extracted',
                        ),
                      );
                    const blob = await (await fetch(src)).blob();
                    const managed = await storeAttachment(
                      session,
                      new File([blob], `image-${index}`, {
                        type: blob.type,
                      }),
                    );
                    await imagePatch(index, { src: managed.src });
                  })
                }
              >
                {t('保存至资源目录', 'Save to resources')}
              </WorkspaceButton>
            </fieldset>
          ))}
          <WorkspaceButton
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const files = session.exportWorkspaceFiles(fileId);
                const paths = new Map(
                  [...state.files.values(), ...state.documents.values()].map(
                    (item) => [workspaceFileId(item.file), item.path],
                  ),
                );
                const result = await portableArchiveWithAssets(
                  files,
                  paths,
                  async (path) => (await session.readRawFile(path)).content,
                );
                download('workspace-export.zip', result.bytes);
                if (result.warnings.length)
                  setError(result.warnings.join('; '));
              })
            }
          >
            {t(
              '导出便携 ZIP（含原生文件、Markdown 与附件）',
              'Export portable ZIP (native files, Markdown and attachments)',
            )}
          </WorkspaceButton>
        </>
      )}
      {tab === 'conflict' && (
        <>
          <div className="workspace-knowledge-columns">
            <section>
              <h3>本地版本</h3>
              {preview(file)}
            </section>
            <section>
              <h3>磁盘版本</h3>
              {comparison ? (
                preview(comparison)
              ) : (
                <WorkspaceButton
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const raw = await session.readRawFile(entry.path);
                      const parsed: unknown = JSON.parse(
                        new TextDecoder().decode(raw.content),
                      );
                      if (!isWorkspaceFile(parsed))
                        throw new Error(
                          t(
                            '磁盘文件无法解析',
                            'Unable to parse the disk file',
                          ),
                        );
                      setComparison(parsed);
                    })
                  }
                >
                  {t('读取磁盘版本', 'Read disk version')}
                </WorkspaceButton>
              )}
            </section>
          </div>
          <WorkspaceButton
            disabled={readonly || busy}
            onClick={() =>
              void perform(async () => {
                await onKeepBoth();
                closeTools();
              })
            }
          >
            {t('保留两份', 'Keep both')}
          </WorkspaceButton>
        </>
      )}
      {comparison && tab === 'history' && preview(comparison)}
    </>
  );
  return (
    <>
      <WorkspaceButton
        className="workspace-content-tools-trigger"
        data-pointer-focus={pointerFocus ? 'true' : undefined}
        aria-haspopup="dialog"
        aria-expanded={shown}
        intent="ghost"
        type="button"
        onPointerDownCapture={() => {
          lastInteraction.current = 'pointer';
        }}
        onKeyDownCapture={() => {
          lastInteraction.current = 'keyboard';
          setPointerFocus(false);
        }}
        onBlur={() => setPointerFocus(false)}
        onClick={() => setShown(true)}
      >
        {t('内容管理', 'Content management')}
      </WorkspaceButton>
      {shown && (
        <VmDialog
          className="workspace-knowledge-dialog workspace-content-dialog"
          title={t('内容管理', 'Content management')}
          closeLabel={t('关闭', 'Close')}
          busy={busy}
          onPointerDownCapture={() => {
            lastInteraction.current = 'pointer';
          }}
          onKeyDownCapture={() => {
            lastInteraction.current = 'keyboard';
          }}
          onClose={closeTools}
        >
          <WorkspaceDialogTabs
            activeKey={tab}
            onChange={(next) => {
              setTab(next);
              setComparison(null);
            }}
            items={[
              ['properties', t('内容属性', 'Properties')],
              ['history', t('版本历史', 'Version history')],
              ['attachments', t('附件', 'Attachments')],
              ['conflict', t('冲突比较', 'Compare conflict')],
            ]
              .filter(([id]) => id !== 'conflict' || entry.conflicted)
              .map(([key, label]) => ({
                key,
                label,
                children: key === tab ? panel : undefined,
              }))}
          />
          {error && <WorkspaceAlert type="error" title={error} showIcon />}
        </VmDialog>
      )}
    </>
  );
}
