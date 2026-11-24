import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  BookOpen,
  File,
  Folder,
  FolderOpen,
  House,
  Search,
  Zap,
} from 'lucide-react';
import {
  FileTreeMenu,
  VmDialog,
  WorkspaceButton,
  WorkspaceInput,
} from '@sue/verd-board-ui';
import {
  quickDiagramKinds,
  type QuickFileEntry,
  type QuickFileKind,
  type OpenWorkspaceRequest,
  type WorkspaceHistoryEntry,
} from '@sue/verd-board-workspace';
import { IndependentFileRenameDialog } from './independent-file-rename-dialog';
import { myWorkspaceEntries } from './management/workspace-switcher';
import './product-navigation.scss';

export interface WorkspaceFileOpenTarget {
  id: string;
  path: string;
  workspace?: OpenWorkspaceRequest;
}

export type ProductPage = 'home' | 'quick-create' | 'workspace';
type Locale = 'zh' | 'en';

export type IndependentFileRef =
  { kind: 'directory-entry'; path: string } | { kind: 'recent'; id: string };

export interface RecentIndependentFile {
  id: string;
  name: string;
  folder: string;
  available: boolean;
}

export interface QuickFilesHost {
  listQuickFiles(directory: string): Promise<QuickFileEntry[]>;
  listRecentFiles(): Promise<RecentIndependentFile[]>;
  createQuickFile(kind: QuickFileKind): Promise<string>;
  revealQuickDirectory(directory: string): Promise<void>;
  openFile(ref: IndependentFileRef): Promise<void>;
  renameFile(ref: IndependentFileRef, stem: string): Promise<string>;
  trashFile(ref: IndependentFileRef): Promise<void>;
  forgetRecentFile(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export interface ProductNavigationHost {
  restoreWorkspace?: boolean;
  startup?(): Promise<boolean>;
  workspaceIdle?(): Promise<void>;
  quickFiles?: QuickFilesHost;
  onCreateWorkspace?(listener: () => void): () => void;
}

export function ProductNav({
  locale,
  page,
  hasQuickFiles,
  onPage,
}: {
  locale: Locale;
  page: ProductPage;
  hasQuickFiles: boolean;
  onPage(page: ProductPage): void;
}) {
  const zh = locale === 'zh';
  return (
    <nav
      className="product-navigation workspace-sidebar-nav"
      aria-label={zh ? '应用导航' : 'Application navigation'}
    >
      <button
        className="file-tree-nav vm-nav-row"
        type="button"
        aria-current={page === 'home' ? 'page' : undefined}
        onClick={() => onPage('home')}
      >
        <House size={16} aria-hidden /> <span>{zh ? '首页' : 'Home'}</span>
      </button>
      {hasQuickFiles && (
        <button
          className="file-tree-nav vm-nav-row"
          type="button"
          aria-current={page === 'quick-create' ? 'page' : undefined}
          onClick={() => onPage('quick-create')}
        >
          <Zap size={16} aria-hidden />{' '}
          <span>{zh ? '快速创建' : 'Quick Create'}</span>
        </button>
      )}
    </nav>
  );
}

export function ProductHome({
  locale,
  history,
  currentHistoryId,
  onResume,
  onOpen,
  onOpenFolder,
  onOpenBuiltin,
  onOpenPatterns,
  onCreate,
}: {
  locale: Locale;
  history: WorkspaceHistoryEntry[];
  currentHistoryId?: string;
  onResume?(): void;
  onOpen(id: string): void;
  onOpenFolder?(): void;
  onOpenBuiltin?(): void;
  onOpenPatterns?(): void;
  onCreate?(): void;
}) {
  const zh = locale === 'zh';
  const [query, setQuery] = useState('');
  const entries = myWorkspaceEntries(history, locale);
  const words = query.trim().toLocaleLowerCase().split(/\s+/);
  const rows = entries.filter(({ name, description, directoryHint }) =>
    words.every((word) =>
      [name, description, directoryHint].some((value) =>
        value?.toLocaleLowerCase().includes(word),
      ),
    ),
  );
  return (
    <section className="product-page product-home" data-testid="product-home">
      <header className="product-home__group">
        <h1>{zh ? '首页' : 'Home'}</h1>
        <div className="product-page__actions">
          {onCreate && (
            <WorkspaceButton intent="primary" onClick={onCreate}>
              {zh ? '新建工作区' : 'New workspace'}
            </WorkspaceButton>
          )}
          {onOpenFolder && (
            <WorkspaceButton onClick={onOpenFolder}>
              {zh ? '导入工作区' : 'Import workspace'}
            </WorkspaceButton>
          )}
        </div>
      </header>
      <section className="product-home__group">
        <h2>{zh ? '我的工作区' : 'My workspaces'}</h2>
        <WorkspaceInput
          type="search"
          className="product-home__search"
          prefix={<Search strokeWidth={1.75} size={16} aria-hidden />}
          aria-label={zh ? '搜索工作区' : 'Find workspaces'}
          placeholder={
            zh
              ? '按名称或目录查找工作区…'
              : 'Find a workspace by name or folder…'
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="product-page__list">
          {rows.map((entry) => {
            const current = entry.id === currentHistoryId;
            const unavailable =
              !!entry.availability && entry.availability !== 'available';
            return (
              <li key={entry.id}>
                <WorkspaceButton
                  className="product-home__row"
                  intent="ghost"
                  disabled={unavailable}
                  aria-current={current ? 'true' : undefined}
                  onClick={() =>
                    current && onResume ? onResume() : onOpen(entry.id)
                  }
                >
                  <Folder size={16} aria-hidden />
                  <span className="product-workspace-name">
                    <span title={entry.name}>{entry.name}</span>
                    {(entry.description ?? entry.directoryHint) && (
                      <small title={entry.directoryHint}>
                        {entry.description ?? entry.directoryHint}
                      </small>
                    )}
                  </span>
                  {current && (
                    <span className="vm-badge">{zh ? '当前' : 'Current'}</span>
                  )}
                  {unavailable && (
                    <span className="vm-badge">
                      {zh ? '目录不可用' : 'Folder unavailable'}
                    </span>
                  )}
                </WorkspaceButton>
              </li>
            );
          })}
        </ul>
        {!rows.length && (
          <p className="vm-empty">
            {entries.length
              ? zh
                ? '没有匹配的工作区'
                : 'No matching workspaces'
              : zh
                ? '还没有加入工作区'
                : 'No workspaces added yet'}
          </p>
        )}
      </section>
      {(onOpenBuiltin || onOpenPatterns) && (
        <section className="product-home__group">
          <h2>{zh ? '使用指南' : 'Guides'}</h2>
          <div className="product-page__actions">
            {onOpenBuiltin && (
              <WorkspaceButton
                data-testid="workspace-open-builtin"
                onClick={onOpenBuiltin}
              >
                <House size={16} aria-hidden />
                {zh ? '系统介绍' : 'System introduction'}
              </WorkspaceButton>
            )}
            {onOpenPatterns && (
              <WorkspaceButton
                data-testid="workspace-open-patterns"
                onClick={onOpenPatterns}
              >
                <BookOpen size={16} aria-hidden />
                {zh ? '文档编写推荐库' : 'Document authoring recommendations'}
              </WorkspaceButton>
            )}
          </div>
        </section>
      )}
    </section>
  );
}

export function ProductWorkspaceDialog({
  locale,
  onClose,
  onPickParent,
  onCreate,
}: {
  locale: Locale;
  onClose(): void;
  onPickParent?(): Promise<string | null>;
  onCreate(name: string, parentPath?: string): Promise<boolean>;
}) {
  const zh = locale === 'zh';
  const parentId = useId();
  const [name, setName] = useState('');
  const [parentPath, setParentPath] = useState<string>();
  const [operation, setOperation] = useState<'pick' | 'create'>();
  const [error, setError] = useState('');
  const busy = operation !== undefined;
  const canCreate = !busy && !!name.trim() && (!onPickParent || !!parentPath);
  const chooseParent = async () => {
    if (!onPickParent || busy) return;
    setOperation('pick');
    setError('');
    try {
      const path = await onPickParent();
      if (path) setParentPath(path);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setOperation(undefined);
    }
  };
  return (
    <VmDialog
      className="product-workspace-dialog"
      title={zh ? '新建工作区' : 'New workspace'}
      closeLabel={zh ? '关闭' : 'Close'}
      busy={busy}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canCreate) return;
          setOperation('create');
          setError('');
          void onCreate(name.trim(), parentPath)
            .then(
              (created) => {
                if (created) onClose();
              },
              (cause) => setError(String(cause)),
            )
            .finally(() => setOperation(undefined));
        }}
      >
        <label>
          {zh ? '名称' : 'Name'}
          <WorkspaceInput
            autoFocus
            disabled={busy}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {onPickParent && (
          <div className="product-workspace-dialog__parent">
            <label htmlFor={parentId}>{zh ? '父目录' : 'Parent folder'}</label>
            <div className="product-workspace-dialog__location">
              <WorkspaceInput
                id={parentId}
                value={parentPath ?? ''}
                placeholder={zh ? '请选择父目录' : 'Select a parent folder'}
                title={parentPath}
                readOnly
              />
              <WorkspaceButton
                onClick={() => void chooseParent()}
                disabled={operation === 'create'}
                aria-busy={operation === 'pick'}
              >
                {zh ? '选择父目录…' : 'Choose parent folder…'}
              </WorkspaceButton>
            </div>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="vm-dialog__footer">
          <WorkspaceButton onClick={onClose} disabled={busy}>
            {zh ? '取消' : 'Cancel'}
          </WorkspaceButton>
          <WorkspaceButton type="submit" intent="primary" disabled={!canCreate}>
            {zh ? '创建' : 'Create'}
          </WorkspaceButton>
        </div>
      </form>
    </VmDialog>
  );
}

export function ProductQuickFiles({
  actions,
  locale,
}: {
  actions: QuickFilesHost;
  locale: Locale;
}) {
  const zh = locale === 'zh';
  const [directory, setDirectory] = useState('');
  const [entries, setEntries] = useState<QuickFileEntry[]>([]);
  const [recent, setRecent] = useState<RecentIndependentFile[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [rename, setRename] = useState<{
    ref: IndependentFileRef;
    name: string;
  }>();
  const loadSequence = useRef(0);
  const load = useCallback(
    async (location: string) => {
      const sequence = ++loadSequence.current;
      try {
        const [next, history] = await Promise.all([
          actions.listQuickFiles(location),
          actions.listRecentFiles(),
        ]);
        if (sequence !== loadSequence.current) return;
        setEntries(next);
        setRecent(history);
      } catch (cause) {
        if (sequence !== loadSequence.current) return;
        setEntries([]);
        setError(String(cause));
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [actions],
  );

  useEffect(() => {
    setLoading(true);
    const refresh = () => void load(directory);
    refresh();
    window.addEventListener('focus', refresh);
    const unlisten = actions.subscribe(refresh);
    return () => {
      loadSequence.current++;
      window.removeEventListener('focus', refresh);
      unlisten();
    };
  }, [actions, directory, load]);

  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
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
  const rowActions = (
    ref: IndependentFileRef,
    name: string,
    available = true,
  ) => (
    <div className="product-page__file-actions">
      {available && (
        <>
          <WorkspaceButton
            intent="ghost"
            disabled={busy}
            aria-label={zh ? `重命名 ${name}` : `Rename ${name}`}
            onClick={() => setRename({ ref, name })}
          >
            {zh ? '重命名' : 'Rename'}
          </WorkspaceButton>
          <WorkspaceButton
            intent="ghost"
            disabled={busy}
            aria-label={zh ? `移到废纸篓 ${name}` : `Move ${name} to Trash`}
            onClick={() => void run(() => actions.trashFile(ref))}
          >
            {zh ? '移到废纸篓' : 'Move to Trash'}
          </WorkspaceButton>
        </>
      )}
      {ref.kind === 'recent' && (
        <WorkspaceButton
          intent="ghost"
          disabled={busy}
          aria-label={
            zh ? `从最近记录移除 ${name}` : `Remove ${name} from Recent`
          }
          onClick={() => void run(() => actions.forgetRecentFile(ref.id))}
        >
          {zh ? '从最近记录移除' : 'Remove from Recent'}
        </WorkspaceButton>
      )}
    </div>
  );
  const create = (kind: QuickFileKind) =>
    void run(async () => {
      await actions.createQuickFile(kind);
      setDirectory('');
      await load('');
    });
  return (
    <section className="product-page" data-testid="quick-create-page">
      <h1>{zh ? '快速创建' : 'Quick Create'}</h1>
      <div className="product-page__actions">
        <WorkspaceButton
          intent="primary"
          disabled={busy}
          onClick={() => create('document')}
        >
          {zh ? '新建文件' : 'New file'}
        </WorkspaceButton>
        <WorkspaceButton
          aria-haspopup="menu"
          aria-expanded={!!menu}
          disabled={busy}
          onClick={(event) => setMenu(menu ? null : event.currentTarget)}
        >
          {zh ? '新建图' : 'New diagram'}
        </WorkspaceButton>
        <WorkspaceButton
          onClick={() =>
            void run(() => actions.revealQuickDirectory(directory))
          }
        >
          {zh ? '在文件管理器中显示' : 'Show in file manager'}
        </WorkspaceButton>
        <WorkspaceButton
          onClick={() => {
            setError('');
            void load(directory);
          }}
        >
          {zh ? '刷新' : 'Refresh'}
        </WorkspaceButton>
      </div>
      {menu && (
        <FileTreeMenu
          label={zh ? '新建图' : 'New diagram'}
          anchor={menu}
          locale={locale}
          items={quickDiagramKinds.map(({ kind, zh, en }) => ({
            id: kind,
            label: locale === 'zh' ? zh : en,
            icon: File,
            onSelect: () => create(kind),
          }))}
          onClose={() => setMenu(null)}
        />
      )}
      <h2>{zh ? '独立文件' : 'Independent files'}</h2>
      {directory && (
        <div className="product-page__actions">
          <WorkspaceButton
            intent="ghost"
            onClick={() => {
              setError('');
              setDirectory(directory.split('/').slice(0, -1).join('/'));
            }}
          >
            {zh ? '上一级' : 'Up one level'}
          </WorkspaceButton>
          <span>{directory}</span>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {loading && (
        <p role="status">{zh ? '正在读取文件…' : 'Reading files…'}</p>
      )}
      {!loading && !entries.length && !error && (
        <p>{zh ? '这个目录为空' : 'This folder is empty'}</p>
      )}
      <ul className="product-page__list" aria-busy={loading}>
        {entries.map((entry) => (
          <li key={entry.path}>
            {entry.kind === 'other' ? (
              <span>
                <File size={16} aria-hidden /> {entry.name}
              </span>
            ) : (
              <WorkspaceButton
                intent="ghost"
                disabled={busy || loading}
                onClick={() => {
                  setError('');
                  if (entry.kind === 'directory') setDirectory(entry.path);
                  else
                    void run(async () => {
                      try {
                        await actions.openFile({
                          kind: 'directory-entry',
                          path: entry.path,
                        });
                      } catch (cause) {
                        await load(directory);
                        throw cause;
                      }
                    });
                }}
              >
                {entry.kind === 'directory' ? (
                  <FolderOpen size={16} aria-hidden />
                ) : (
                  <File size={16} aria-hidden />
                )}{' '}
                {entry.name}
              </WorkspaceButton>
            )}
            {(entry.kind === 'document' || entry.kind === 'canvas') &&
              rowActions(
                { kind: 'directory-entry', path: entry.path },
                entry.name,
              )}
          </li>
        ))}
      </ul>
      <h2>{zh ? '最近打开' : 'Recently opened'}</h2>
      {!recent.length && (
        <p>
          {zh
            ? '没有最近打开的独立文件'
            : 'No recently opened independent files'}
        </p>
      )}
      <ul className="product-page__list">
        {recent.map((entry) => {
          const ref = { kind: 'recent', id: entry.id } as const;
          return (
            <li key={entry.id}>
              <WorkspaceButton
                intent="ghost"
                disabled={busy || !entry.available}
                onClick={() => void run(() => actions.openFile(ref))}
              >
                <File size={16} aria-hidden /> {entry.name}
              </WorkspaceButton>
              <span title={entry.folder}>
                {entry.available
                  ? entry.folder
                  : zh
                    ? '文件不可用'
                    : 'File unavailable'}
              </span>
              {rowActions(ref, entry.name, entry.available)}
            </li>
          );
        })}
      </ul>
      {rename && (
        <IndependentFileRenameDialog
          name={rename.name}
          locale={locale}
          onClose={() => setRename(undefined)}
          onRename={(stem) => actions.renameFile(rename.ref, stem)}
        />
      )}
    </section>
  );
}
