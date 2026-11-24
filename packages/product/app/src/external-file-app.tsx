import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DocumentAssetContext,
  DocumentResourcesContext,
} from '@sue/board-react-text';
import {
  createWorkspaceLink,
  parseWorkspaceLink,
  type WorkspaceFileTarget,
} from '@sue/board-common';
import {
  DocumentPage,
  VerdFrame,
  WorkspaceDesignProvider,
  I18nProvider,
  useI18n,
  PreviewMountProvider,
  type DocumentEditorController,
} from '@sue/verd-board-ui';
import {
  openWorkspaceSession,
  workspaceFileId,
  updateWorkspaceNavigation,
  type WorkspaceFile,
  type WorkspaceHost,
  type WorkspaceSession,
  type WorkspaceSessionSnapshot,
  type ExternalFileBinding,
} from '@sue/verd-board-workspace';
import {
  createCanvasSession,
  type CanvasSession,
} from './canvas/canvas-session';
import { createCanvasInstanceHost } from './canvas/canvas-instance-host';
import { WorkspaceAssetScope } from './documents/workspace-asset-scope';
import { createWorkspaceDocumentPreviewCache } from './documents/workspace-previews';
import { IndependentFileRenameDialog } from './independent-file-rename-dialog';
import './external-file-app.scss';

export type { ExternalFileBinding } from '@sue/verd-board-workspace';
export interface ExternalFileActions {
  rename?(stem: string): Promise<string>;
  onRenamed?(listener: (name: string) => void): () => void;
  warnings(): Promise<string[]>;
  readImage(href: string): Promise<Uint8Array>;
  openLink?(href: string): Promise<void>;
  resolve(
    action: 'load-disk' | 'keep-local' | 'save-copy',
    files: { file: WorkspaceFile; path: string }[],
  ): Promise<boolean>;
  setDefaults?(): Promise<void>;
}

/** A file editor without directory, Agent or Git workspace affordances. */
export function ExternalFileApp(props: ExternalFileAppProps) {
  return (
    <I18nProvider>
      <PreviewMountProvider>
        <ExternalFileEditor {...props} />
      </PreviewMountProvider>
    </I18nProvider>
  );
}

interface ExternalFileAppProps {
  host: WorkspaceHost;
  binding: ExternalFileBinding;
  actions: ExternalFileActions;
  openLink?(href: string): Promise<void>;
  registerFlush?(flush: () => Promise<void>): () => void;
}
function ExternalFileEditor({
  host,
  binding,
  actions,
  openLink: openExternalLink,
  registerFlush,
}: ExternalFileAppProps) {
  const { language } = useI18n();
  const locale = language === 'en' ? 'en' : 'zh';
  const [displayName, setDisplayName] = useState(binding.displayName);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => actions.onRenamed?.(setDisplayName), [actions]);
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [state, setState] = useState<WorkspaceSessionSnapshot | null>(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [activeId, setActiveId] = useState(binding.rootFileId);
  const [navigation, setNavigation] = useState<{
    requestId: number;
    target: WorkspaceFileTarget;
  }>();
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<{
    revision: number;
    selection?: import('@sue/verd-board-ui').DocumentSelection;
  }>();
  const canvasSession = useRef<CanvasSession | null>(null);
  const documentController = useRef<DocumentEditorController | null>(null);
  const canvasController = useRef<
    import('@sue/verd-board-ui').FrameCanvasController | null
  >(null);
  const flushEditors = useCallback(async () => {
    const text = await documentController.current?.flushEditing();
    if (text && text.status !== 'completed' && text.status !== 'noop')
      throw new Error('文档编辑尚未提交，请重试');
    const canvas = await canvasController.current?.flushEditing();
    if (canvas?.status === 'rejected')
      throw new Error(canvas.message || '画布编辑尚未提交，请重试');
  }, []);
  useEffect(() => {
    let cancelled = false;
    let opened: WorkspaceSession | undefined;
    let unsubscribe: (() => void) | undefined;
    let shutdown: (() => void) | undefined;
    setSession(null);
    setState(null);
    void openWorkspaceSession(host, binding.handle).then(
      (value) => {
        opened = value;
        if (cancelled) {
          value.dispose();
          return;
        }
        canvasSession.current = createCanvasSession({ session: value });
        const update = () => {
          const next = value.getState();
          setActiveId((id) =>
            next.files.has(id) || next.documents.has(id)
              ? id
              : (next.files.keys().next().value ??
                next.documents.keys().next().value ??
                binding.rootFileId),
          );
          setState(next);
          void actions
            .warnings()
            .then(setWarnings, (cause) => setError(String(cause)));
        };
        unsubscribe = value.subscribe(update);
        shutdown = host.onShutdown?.(
          async () => {
            try {
              await flushEditors();
              value.freeze();
              if (!(await value.flush()))
                throw new Error('文件仍有未保存的修改或冲突');
            } catch (cause) {
              value.unfreeze();
              throw cause;
            }
          },
          () => value.unfreeze(),
        );
        const initial = value.getState();
        const savedId = initial.session.activeTabId;
        setActiveId(
          savedId &&
            (initial.files.has(savedId) || initial.documents.has(savedId))
            ? savedId
            : binding.rootFileId,
        );
        setSession(value);
        update();
      },
      (cause) => {
        if (!cancelled) setError(String(cause));
      },
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
      shutdown?.();
      canvasSession.current?.dispose();
      canvasSession.current = null;
      opened?.dispose();
    };
  }, [host, binding, actions, revision, flushEditors]);
  useEffect(() => {
    if (!session || host.onShutdown) return;
    const flush = async () => {
      await flushEditors();
      if (!(await session.flush()))
        throw new Error('文件仍有未保存的修改或冲突');
    };
    const release = registerFlush?.(flush);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const snapshot = session.getState();
      if (
        snapshot.dirty ||
        snapshot.saveStatus === 'saving' ||
        snapshot.saveStatus === 'error'
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const pageHide = () => void flush().catch(() => {});
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', pageHide);
    return () => {
      release?.();
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', pageHide);
    };
  }, [session, host, registerFlush, flushEditors]);
  useEffect(() => {
    if (
      !session ||
      !state ||
      state.mutationsPaused ||
      state.session.activeTabId === activeId ||
      (!state.files.has(activeId) && !state.documents.has(activeId))
    )
      return;
    session.setSessionState(
      updateWorkspaceNavigation(state.session, {
        tabs: [{ fileId: activeId }],
        activeTabId: activeId,
        activeView: 'file',
      }),
    );
  }, [session, state, activeId]);
  const chooseFile = (fileId: string) => {
    if (!session) return;
    session.setSessionState(
      updateWorkspaceNavigation(session.getState().session, {
        tabs: [{ fileId }],
        activeTabId: fileId,
        activeView: 'file',
      }),
    );
    setActiveId(fileId);
  };
  const instanceHost = useMemo(
    () =>
      session
        ? createCanvasInstanceHost(session, () => canvasSession.current)
        : undefined,
    [session],
  );
  const history = useMemo(
    () => ({
      canUndo: () => session?.getState().canUndo ?? false,
      canRedo: () => session?.getState().canRedo ?? false,
      busy: () => busy,
      undo: async () => {
        const result = await session?.undo();
        if (result?.restored?.fileId) setActiveId(result.restored.fileId);
        if (result?.restored?.selection)
          setRestore({
            revision: Date.now(),
            selection: result.restored
              .selection as import('@sue/verd-board-ui').DocumentSelection,
          });
      },
      redo: async () => {
        const result = await session?.redo();
        if (result?.restored?.fileId) setActiveId(result.restored.fileId);
        if (result?.restored?.selection)
          setRestore({
            revision: Date.now(),
            selection: result.restored
              .selection as import('@sue/verd-board-ui').DocumentSelection,
          });
      },
    }),
    [session, busy],
  );
  const imageUrls = useMemo(
    () => new Map<string, Promise<string>>(),
    [binding],
  );
  useEffect(
    () => () => {
      for (const value of imageUrls.values())
        void value.then(URL.revokeObjectURL, () => {});
    },
    [imageUrls],
  );
  const resolveImage = useCallback(
    async (src: string) => {
      if (/^(data:|blob:)/i.test(src)) return src;
      if (/^https?:/i.test(src)) return src;
      let result = imageUrls.get(src);
      if (!result) {
        result = actions.readImage(src).then((content) => {
          const ext = src.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
          const mime =
            ext === 'svg'
              ? 'image/svg+xml'
              : ext === 'jpg'
                ? 'image/jpeg'
                : `image/${ext}`;
          return URL.createObjectURL(
            new Blob([content as BlobPart], { type: mime }),
          );
        });
        imageUrls.set(src, result);
      }
      return result;
    },
    [imageUrls, actions],
  );
  const previews = useMemo(createWorkspaceDocumentPreviewCache, [session]);
  const previewScroll = useMemo(
    () => new Map<string, { top: number; left: number }>(),
    [session],
  );

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const openLink = (href: string) =>
    run(async () => {
      const target = parseWorkspaceLink(href, activeId);
      if (target) {
        if (target.kind === 'folder')
          throw new Error('独立文件不包含工作区文件夹');
        if (
          !state?.files.has(target.fileId) &&
          !state?.documents.has(target.fileId)
        )
          throw new Error('目标不在当前文件内');
        await flushEditors();
        chooseFile(target.fileId);
        setNavigation({ requestId: Date.now(), target });
      } else await (openExternalLink ?? actions.openLink)?.(href);
    });
  const resolve = (action: 'load-disk' | 'keep-local' | 'save-copy') =>
    run(async () => {
      if (!session) return;
      await flushEditors();
      session.freeze();
      const current = session.getState();
      const local = [
        ...current.files.values(),
        ...current.documents.values(),
      ].map(({ file, path }) => ({ file, path }));
      try {
        if (await actions.resolve(action, local)) {
          if (action !== 'save-copy') setRevision((r) => r + 1);
        }
      } finally {
        session.unfreeze();
      }
    });
  const save = () =>
    run(async () => {
      if (!session) return;
      await flushEditors();
      if (!(await session.flush()))
        throw new Error('保存失败，请处理文件冲突后重试');
    });
  const saveShortcut = useRef<(copy: boolean) => void>(() => {});
  saveShortcut.current = (copy) => {
    if (!busy) void (copy ? resolve('save-copy') : save());
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.key.toLowerCase() !== 's'
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.isComposing) saveShortcut.current(event.shiftKey);
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, []);
  const entry = state?.documents.get(activeId) ?? state?.files.get(activeId);
  const conflicted =
    state &&
    [...state.files.values(), ...state.documents.values()].some(
      (entry) => entry.conflicted,
    );
  return (
    <WorkspaceDesignProvider>
      <main className="external-file-app" data-testid="external-file-editor">
        {renaming && session && actions.rename && (
          <IndependentFileRenameDialog
            name={displayName}
            locale={locale}
            onClose={() => setRenaming(false)}
            onRename={async (stem) => {
              await flushEditors();
              session.freeze();
              try {
                if (!(await session.flush()))
                  throw new Error('文件仍有未保存的修改或冲突');
                setDisplayName(await actions.rename!(stem));
              } finally {
                session.unfreeze();
              }
            }}
          />
        )}
        <header className="external-file-app__header">
          <strong>{displayName}</strong>
          {actions.rename && (
            <button
              type="button"
              disabled={!session || busy}
              onClick={() => setRenaming(true)}
            >
              {locale === 'zh' ? '重命名' : 'Rename'}
            </button>
          )}
          <span role="status">
            {state?.saveStatus === 'error'
              ? '保存失败'
              : state?.saveStatus === 'saving'
                ? '正在保存…'
                : state?.dirty
                  ? '尚未保存'
                  : '已保存'}
          </span>
          <button
            type="button"
            disabled={!session || busy}
            onClick={() => {
              void save();
            }}
          >
            保存
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void resolve('save-copy')}
          >
            另存副本
          </button>
          {actions.setDefaults && (
            <button
              type="button"
              onClick={() => void run(() => actions.setDefaults!())}
            >
              设置默认打开方式
            </button>
          )}
        </header>
        {warnings.length > 0 && (
          <div className="external-file-app__notice" role="status">
            部分格式在保存为 Markdown 时会转换：{warnings.join('；')}
          </div>
        )}
        {error && (
          <div className="external-file-app__notice" role="alert">
            {error}
          </div>
        )}
        {conflicted && (
          <div className="external-file-app__notice" role="alert">
            原文件已在其他程序中修改。
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolve('load-disk')}
            >
              重新载入整个文件
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolve('keep-local')}
            >
              保留当前内容
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolve('save-copy')}
            >
              另存副本
            </button>
          </div>
        )}
        {state && state.files.size + state.documents.size > 1 && (
          <nav aria-label="文件内页面">
            {[...state.files.values(), ...state.documents.values()].map(
              ({ file }) => (
                <button
                  type="button"
                  key={workspaceFileId(file)}
                  disabled={busy || state.mutationsPaused}
                  aria-current={
                    workspaceFileId(file) === activeId ? 'page' : undefined
                  }
                  onClick={() => chooseFile(workspaceFileId(file))}
                >
                  {file.format === 'verd-document'
                    ? file.title
                    : file.frame.name}
                </button>
              ),
            )}
          </nav>
        )}
        {state && session && entry && (
          <WorkspaceAssetScope session={session}>
            <div className="external-file-app__content">
              {entry.file.format === 'verd-document' ? (
                <ExternalDocumentAssets
                  markdown={binding.kind === 'markdown'}
                  resolve={resolveImage}
                >
                  <DocumentPage
                    showSaveStatus={false}
                    value={entry.file.text}
                    title={entry.file.title}
                    locale="zh"
                    readonly={busy || state.mutationsPaused}
                    history={history}
                    restore={restore}
                    onReady={(value) => {
                      documentController.current = value;
                    }}
                    navigation={
                      navigation?.target.fileId === activeId
                        ? navigation
                        : undefined
                    }
                    onOpenLink={(href) => {
                      void openLink(href);
                    }}
                    onChange={(change) => {
                      const live = session
                        .getState()
                        .documents.get(activeId)?.file;
                      if (!live) return;
                      return session.apply({
                        type: 'file',
                        file: { ...live, text: change.value },
                        history: {
                          group: change.historyGroup,
                          selectionBefore: change.selectionBefore,
                          selectionAfter: change.selectionAfter,
                          name: change.source,
                        },
                      });
                    }}
                  />
                </ExternalDocumentAssets>
              ) : (
                <VerdFrame
                  showSaveStatus={false}
                  instanceHost={instanceHost}
                  onExportNative={() => {
                    void resolve('save-copy');
                  }}
                  value={{ store: state.store }}
                  frameId={activeId}
                  readonly={busy || state.mutationsPaused}
                  history={history}
                  onReady={(value) => {
                    canvasController.current = value;
                  }}
                  onChange={(change) => {
                    void session
                      .apply({ type: 'store', store: change.snapshot.store })
                      .then((result) => {
                        if (!result.ok)
                          setError(
                            result.diagnostics.map((d) => d.message).join('; '),
                          );
                      });
                  }}
                  navigation={
                    navigation?.target.fileId === activeId
                      ? navigation
                      : undefined
                  }
                  linkHost={{
                    createLink: (target) =>
                      createWorkspaceLink({
                        kind: 'cell',
                        fileId: target.frameId,
                        cellId: target.cellId,
                      }),
                    openLink: (href) => {
                      void openLink(href);
                    },
                  }}
                  onOpenFrame={(fileId) => {
                    void openLink(
                      createWorkspaceLink({ kind: 'file', fileId }),
                    );
                  }}
                  documentReferences={previews({
                    snapshot: state,
                    locale: 'zh',
                    open: (fileId, anchor) => {
                      void openLink(
                        createWorkspaceLink(
                          anchor
                            ? { kind: 'heading', fileId, slug: anchor }
                            : { kind: 'file', fileId },
                        ),
                      );
                    },
                    openLink: (href) => {
                      void openLink(href);
                    },
                    scroll: previewScroll,
                    path: [activeId],
                    instance: 'external',
                    active: true,
                    history,
                    edit: (id, change) => {
                      const live = session.getState().documents.get(id)?.file;
                      if (!live) return;
                      return session.apply({
                        type: 'file',
                        file: { ...live, text: change.value },
                      });
                    },
                  })}
                />
              )}
            </div>
          </WorkspaceAssetScope>
        )}
        {!entry && state && (
          <div role="alert">
            {state.diagnostics.map((d) => d.message).join('；') ||
              '文件内容无法编辑'}
          </div>
        )}
      </main>
    </WorkspaceDesignProvider>
  );
}

function ExternalDocumentAssets({
  markdown,
  resolve,
  children,
}: {
  markdown: boolean;
  resolve(source: string): Promise<string>;
  children: ReactNode;
}) {
  const inherited = useContext(DocumentAssetContext);
  const resources = useContext(DocumentResourcesContext);
  return (
    <DocumentAssetContext.Provider value={markdown ? resolve : inherited}>
      <DocumentResourcesContext.Provider
        value={markdown ? markdownResources : resources}
      >
        {children}
      </DocumentResourcesContext.Provider>
    </DocumentAssetContext.Provider>
  );
}

const markdownResources = {};
