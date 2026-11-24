import type { ActionResult } from '@sue/board-common';
import {
  WorkspaceButton,
  WorkspaceInput,
  IconButton,
  SidebarSection,
  FileTreeMenu,
  type FileTreeMenuItem,
} from '@sue/verd-board-ui';
import { isWorkspaceContentPath } from '@sue/verd-board-workspace';
import { ManagementContext } from './workspace-management-slots';
import {
  WorkspaceSearchDialog,
  ManagementDialog,
} from './workspace-management-dialogs';
import { diagramKindOf } from '@sue/verd-board-workspace';
import SearchWorker from './search.worker?worker&inline';
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  LayoutDashboard,
  Search,
  PanelLeftClose,
  PanelsTopLeft,
  PanelLeftOpen,
  ArrowUp,
  Ellipsis,
  Pencil,
  FolderInput,
  Trash2,
  Check,
  ChevronsDownUp,
  TriangleAlert,
  Pin,
  PinOff,
  FileText,
  X,
} from 'lucide-react';
import type {
  WorkspaceHost,
  WorkspaceSession,
  WorkspaceSessionSnapshot,
  WorkspaceCommand,
} from '@sue/verd-board-workspace';
import { workspaceFileId, workspaceFileTitle } from '@sue/verd-board-workspace';
import { readOrganization, topLevelPaths } from '@sue/verd-board-workspace';
import {
  searchRecords,
  extractSearchRecord,
  type SearchHit,
  type WorkspaceSearchScope,
} from './search';
export {
  WorkspaceManagementSidebar,
  WorkspaceManagementMain,
} from './workspace-management-slots';

export interface WorkspaceSearchRequest {
  scope: WorkspaceSearchScope;
  activation: 'pointer' | 'keyboard';
}

type Props = {
  session: WorkspaceSession;
  snapshot: WorkspaceSessionSnapshot;
  host: WorkspaceHost;
  content: RefObject<HTMLDivElement | null>;
  locale: 'zh' | 'en';
  readonly: boolean;
  workspaceVisible?: boolean;
  onEnterWorkspace?(): Promise<boolean>;
  children: ReactNode;
  tree: ReactNode;
  revealFolder?: { path: string; nonce: number };
  onOpenResource?(path: string): void;
  onOpenFailedFile?(path: string): void;
  onOpen(id: string, origin?: 'all' | 'library'): void;
  setFavorite(id: string, favorite: boolean): Promise<ActionResult>;
  onOpenSearch(activation: WorkspaceSearchRequest['activation']): void;
  onSearchFile(id: string): Promise<ActionResult>;
  onSearchHit(hit: SearchHit): Promise<boolean>;
  onLibrary(): void;
  run(
    command: WorkspaceCommand,
  ): Promise<{ ok: boolean; diagnostics: { message: string }[] }>;
};
export function WorkspaceManagement(p: Props) {
  const zh = p.locale === 'zh';
  const t = (a: string, b: string) => (zh ? a : b);
  const org = readOrganization(p.snapshot.config.value);
  const files = useMemo(
    () =>
      [...p.snapshot.files.values(), ...p.snapshot.documents.values()].map(
        (e) => ({
          id: workspaceFileId(e.file),
          title: workspaceFileTitle(e.file),
          path: e.path,
          file: e.file,
        }),
      ),
    [p.snapshot.files, p.snapshot.documents],
  );
  const identity = String(p.snapshot.config.value['identity'] ?? 'default');
  const view =
    p.snapshot.session.activeView ??
    (p.snapshot.session.tabs.length ? 'file' : 'all');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [viewName, setViewName] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [directoryFilter, setDirectoryFilter] = useState('');
  const [menu, setMenu] = useState<{
    anchor: HTMLElement;
    items: FileTreeMenuItem[];
  } | null>(null);
  const [scope, setScope] = useState<WorkspaceSearchScope | null>(null);
  const searchActivation =
    useRef<WorkspaceSearchRequest['activation']>('keyboard');
  const [searchPointerFocus, setSearchPointerFocus] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{
    key: string;
    hits: SearchHit[];
  }>();
  const [indexVersion, setIndexVersion] = useState(0);
  const searchKey = JSON.stringify([searchQuery.trim(), scope, indexVersion]);
  const [limit, setLimit] = useState(60);
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string>('');
  const [dialog, setDialog] = useState<'move' | 'rename' | 'trash' | null>(
    null,
  );
  const [destination, setDestination] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState('all');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [width, setWidth] = useState(248);
  const [collapsed, setCollapsed] = useState(false);
  const worker = useRef<Worker | null>(null);
  const revisions = useRef(new Map<string, (typeof files)[number]>());
  const queryId = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const dragPaths = useRef<string[]>([]);
  const [drop, setDrop] = useState<{
    path: string;
    side: 'before' | 'after' | 'inside';
  } | null>(null);
  const changeView = useCallback(
    (activeView: 'all' | 'file' | 'library') =>
      p.session.setSessionState({
        ...p.session.getState().session,
        activeView,
      }),
    [p.session],
  );
  const updateOrg = (navigation: typeof org) =>
    p.session.setWorkspaceConfig({
      ...p.session.getState().config.value,
      navigation,
    });
  const saveDevice = useCallback(
    async (patch: Record<string, unknown>) => {
      for (let n = 0; n < 5; n++) {
        const config = await p.host.readGlobalConfig();
        const devices = (config.value['workspaceDevices'] ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        if (
          (
            await p.host.writeGlobalConfig(
              {
                ...config.value,
                workspaceDevices: {
                  ...devices,
                  [identity]: { ...devices[identity], ...patch },
                },
              },
              config.version,
            )
          ).applied
        )
          return;
      }
      throw new Error('Device preferences changed; retry');
    },
    [p.host, identity],
  );
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      setDialog(null);
      setSelected([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const run = async (command: WorkspaceCommand) => {
    const result = await p.run(command);
    if (!result.ok)
      throw new Error(result.diagnostics.map((d) => d.message).join('; '));
  };
  useEffect(() => {
    let alive = true;
    void p.host.readGlobalConfig().then((config) => {
      if (!alive) return;
      const d = (
        config.value['workspaceDevices'] as
          Record<string, { width?: number; collapsed?: boolean }> | undefined
      )?.[identity];
      setWidth(d?.width ?? 248);
      setCollapsed(d?.collapsed ?? false);
    });
    return () => {
      alive = false;
    };
  }, [p.host, identity]);
  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    const w = new SearchWorker();
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.id === queryId.current)
        setSearchResult({ key: data.key, hits: data.hits });
    };
    return () => {
      w.terminate();
      worker.current = null;
      revisions.current.clear();
    };
  }, []);
  useEffect(() => {
    const changed = files.filter((file) => {
      const previous = revisions.current.get(file.id);
      return (
        !previous || previous.file !== file.file || previous.path !== file.path
      );
    });
    const next = new Map(files.map((file) => [file.id, file]));
    const removed = [...revisions.current.keys()].filter((id) => !next.has(id));
    if (!changed.length && !removed.length) return;
    worker.current?.postMessage({ type: 'update', files: changed, removed });
    revisions.current = next;
    setIndexVersion((version) => version + 1);
  }, [files]);
  useEffect(() => {
    const id = ++queryId.current;
    if (!scope || !searchQuery.trim()) return;
    const timer = setTimeout(() => {
      if (worker.current)
        worker.current.postMessage({
          type: 'query',
          id,
          key: searchKey,
          query: searchQuery,
          scope,
        });
      else
        setSearchResult({
          key: searchKey,
          hits: searchRecords(
            files.map((file) => extractSearchRecord(file.file, file.path)),
            searchQuery,
            scope,
          ),
        });
    }, 120);
    return () => clearTimeout(timer);
  }, [scope, searchKey, searchQuery, files]);
  useEffect(() => setLimit(60), [query]);
  useEffect(() => {
    setSelected([]);
  }, [p.snapshot.session.activeTabId]);
  const revealedFolderNonce = useRef<number | undefined>(undefined);
  const revealFolderPath = p.revealFolder?.path;
  const revealFolderNonce = p.revealFolder?.nonce;
  useLayoutEffect(() => {
    if (
      revealFolderPath === undefined ||
      revealFolderNonce === undefined ||
      revealedFolderNonce.current === revealFolderNonce
    )
      return;
    revealedFolderNonce.current = revealFolderNonce;
    setCollapsed(false);
    setSelected([revealFolderPath]);
    anchor.current = revealFolderPath;
  }, [revealFolderPath, revealFolderNonce]);
  // Directory reveal focuses on the next frame, after the sidebar is visible.
  useLayoutEffect(() => {
    const element = root.current?.closest('aside');
    if (element) {
      element.style.width = collapsed ? '44px' : `${width}px`;
      element.classList.toggle('management-collapsed', collapsed);
    }
  }, [width, collapsed]);
  useEffect(() => {
    const organize = (e: Event) => {
      if (p.readonly) return;
      const detail = (
        e as CustomEvent<{ path: string; kind: 'move' | 'rename' }>
      ).detail;
      setSelected([detail.path]);
      setName(
        detail.path
          .split('/')
          .pop()!
          .replace(/\.verd(?:(?:-doc)?\.json)?$/, ''),
      );
      setDialog(detail.kind);
    };
    const shell = p.content.current?.closest('.workspace-shell');
    shell?.addEventListener('workspace-organize', organize);
    return () => shell?.removeEventListener('workspace-organize', organize);
  }, [p.session, p.readonly, p.content]);
  useEffect(() => {
    const open = (e: Event) => {
      const { scope: requestedScope, activation } = (
        e as CustomEvent<WorkspaceSearchRequest>
      ).detail;
      if (!scope) setSearchQuery('');
      searchActivation.current = activation;
      setScope(requestedScope);
    };
    const el = p.content.current?.closest('.workspace-shell');
    el?.addEventListener('workspace-search', open);
    return () => el?.removeEventListener('workspace-search', open);
  }, [p.content, scope]);
  const choose = (path: string, e: MouseEvent, range?: string[]) => {
    if (e.shiftKey) {
      const paths =
        range ??
        [
          ...root.current!.querySelectorAll<HTMLElement>('[data-entry-path]'),
        ].map((el) => el.dataset['entryPath']!);
      const a = paths.indexOf(anchor.current),
        b = paths.indexOf(path);
      setSelected(paths.slice(Math.min(a < 0 ? b : a, b), Math.max(a, b) + 1));
    } else if (e.metaKey || e.ctrlKey)
      setSelected((old) =>
        old.includes(path) ? old.filter((x) => x !== path) : [...old, path],
      );
    else setSelected([path]);
    anchor.current = path;
  };
  const toggleFavorite = async (id: string) => {
    const result = await p.setFavorite(id, !org.favorites.includes(id));
    if ('code' in result) setError(result.message ?? result.code);
  };
  const open = (id: string) => p.onOpen(id, view === 'all' ? 'all' : undefined);
  const targetForDrop = (target: HTMLElement, clientY: number) => {
    const row = target.closest<HTMLElement>('[data-entry-path]');
    if (!row) return null;
    const path = row.dataset['entryPath']!;
    const rect = row.getBoundingClientRect();
    const ratio = (clientY - rect.top) / rect.height;
    const directory = p.snapshot.entries.some(
      (entry) => entry.path === path && entry.kind === 'directory',
    );
    const side =
      directory && ratio > 0.25 && ratio < 0.75
        ? ('inside' as const)
        : org.sort === 'manual'
          ? ratio < 0.5
            ? ('before' as const)
            : ('after' as const)
          : directory
            ? ('inside' as const)
            : null;
    return side ? { path, side } : null;
  };
  const selectedRoots = topLevelPaths(selected);
  const move = async (paths: string[], dir: string, navigation?: typeof org) =>
    run({
      type: 'organize-entries',
      moves: topLevelPaths(paths).map((from) => ({
        from,
        to: (dir ? dir + '/' : '') + from.split('/').pop(),
      })),
      navigation,
    });
  const refsFor = (dir: string) => {
    const items = p.snapshot.entries.filter(
      (e) =>
        (e.path.includes('/')
          ? e.path.slice(0, e.path.lastIndexOf('/'))
          : '') === dir,
    );
    const nameFor = (path: string) =>
      files.find((file) => file.path === path)?.title ??
      path.split('/').pop() ??
      path;
    items.sort((a, b) => nameFor(a.path).localeCompare(nameFor(b.path)));
    const refs = items.map((e) => {
      const f = files.find((f) => f.path === e.path);
      return f ? 'file:' + f.id : 'path:' + e.path;
    });
    return [
      ...(org.order[dir] ?? []).filter((r) => refs.includes(r)),
      ...refs.filter((r) => !(org.order[dir] ?? []).includes(r)),
    ];
  };
  const fileById = new Map(files.map((file) => [file.id, file]));
  const matchesProperties = (id: string) => {
    const item = fileById.get(id);
    if (!item) return false;
    return (
      (type === 'all' ||
        (type === 'document'
          ? item.file.format === 'verd-document'
          : item.file.format === 'verd-frame' &&
            diagramKindOf(item.file) === type)) &&
      (!favoriteOnly || org.favorites.includes(item.id)) &&
      (!tagFilter || item.file.properties?.tags?.includes(tagFilter)) &&
      (!statusFilter || item.file.properties?.status === statusFilter) &&
      (!directoryFilter || item.path.startsWith(directoryFilter + '/'))
    );
  };
  const rawViews = p.snapshot.config.value['savedViews'];
  const savedViews = (Array.isArray(rawViews) ? rawViews : []).filter(
    (
      value,
    ): value is {
      name: string;
      query: string;
      tag: string;
      status: string;
      directory: string;
      type: string;
      favorites: boolean;
    } =>
      !!value &&
      typeof value === 'object' &&
      ['name', 'query', 'tag', 'status', 'directory', 'type'].every(
        (key) => typeof value[key] === 'string',
      ) &&
      typeof value.favorites === 'boolean',
  );
  const rows = files.filter(
    (f) =>
      (type === 'all' ||
        (type === 'document'
          ? f.file.format === 'verd-document'
          : f.file.format === 'verd-frame' &&
            diagramKindOf(f.file) === type)) &&
      matchesProperties(f.id) &&
      (!favoriteOnly || org.favorites.includes(f.id)) &&
      `${f.title} ${f.path} ${(f.file.properties?.tags ?? []).join(' ')} ${f.file.properties?.status ?? ''} ${f.file.properties?.source ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const ordinaryFiles = useMemo(
    () =>
      p.snapshot.entries.filter(
        (entry) =>
          entry.kind === 'file' &&
          !entry.canvas &&
          !entry.document &&
          !/\.verd(?:(?:-doc)?\.json)?$/.test(entry.path) &&
          isWorkspaceContentPath(entry.path, p.snapshot.entries),
      ),
    [p.snapshot.entries],
  );
  const visibleFailures = [...p.snapshot.failedFiles.values()].filter((entry) =>
    isWorkspaceContentPath(entry.path, p.snapshot.entries),
  );
  const matchesPathFilters = (path: string) =>
    !tagFilter &&
    !statusFilter &&
    !favoriteOnly &&
    (!directoryFilter || path.startsWith(directoryFilter + '/')) &&
    path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const rawRows = ordinaryFiles.filter(
    (entry) =>
      (type === 'all' || type === 'resource') && matchesPathFilters(entry.path),
  );
  const failedRows = visibleFailures.filter(
    (entry) =>
      (type === 'all' || type === entry.kind) && matchesPathFilters(entry.path),
  );
  const pathTerms = searchQuery
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const matchesSearchPath = (path: string) =>
    pathTerms.length > 0 &&
    pathTerms.every((term) => path.toLocaleLowerCase().includes(term));
  const pathResults =
    scope && scope !== 'body'
      ? [
          ...(p.onOpenResource
            ? ordinaryFiles
                .filter(({ path }) => matchesSearchPath(path))
                .map(({ path }) => ({
                  path,
                  kind: 'resource' as const,
                }))
            : []),
          ...(p.onOpenFailedFile
            ? visibleFailures
                .filter(({ path }) => matchesSearchPath(path))
                .map(({ path }) => ({
                  path,
                  kind: 'failed' as const,
                }))
            : []),
        ]
      : [];
  const resultCount = rows.length + rawRows.length + failedRows.length;
  const resultPaths = [...rows, ...rawRows, ...failedRows].map(
    (item) => item.path,
  );
  const pinnedFiles = org.favorites
    .map((id) => fileById.get(id))
    .filter((file) => !!file)
    .map((file) => (
      <div className="management-shortcut vm-nav-row" key={file.id}>
        <button
          type="button"
          className="management-shortcut-main"
          onClick={() => open(file.id)}
          title={file.path}
        >
          {file.file.format === 'verd-document' ? (
            <FileText strokeWidth={1.75} size={16} aria-hidden />
          ) : (
            <PanelsTopLeft strokeWidth={1.75} size={16} aria-hidden />
          )}
          <span>{file.title}</span>
        </button>
        {!p.readonly && (
          <>
            <IconButton
              icon={ArrowUp}
              aria-label={t('上移置顶文件', 'Move pinned file up')}
              disabled={org.favorites.indexOf(file.id) === 0}
              onClick={() => {
                const next = [...org.favorites];
                const current = next.indexOf(file.id);
                [next[current - 1], next[current]] = [
                  next[current],
                  next[current - 1],
                ];
                updateOrg({ ...org, favorites: next });
              }}
            />
            <IconButton
              icon={PinOff}
              aria-label={t('取消置顶', 'Unpin')}
              onClick={() => void toggleFavorite(file.id)}
            />
          </>
        )}
      </div>
    ));
  const selectionToolbar = (
    <>
      {selected.length > 0 && !p.readonly && (
        <div className="management-toolbar">
          <span className="vm-badge">{selected.length}</span>
          {selected.length === 1 && (
            <IconButton
              icon={Pencil}
              aria-label={t('重命名', 'Rename')}
              onClick={() => {
                setName(
                  selected[0]
                    .split('/')
                    .pop()!
                    .replace(/\.verd(?:(?:-doc)?\.json)?$/, ''),
                );
                setDialog('rename');
              }}
            />
          )}
          <IconButton
            icon={FolderInput}
            aria-label={t('移动到', 'Move to')}
            onClick={() => setDialog('move')}
          />
          <IconButton
            icon={Trash2}
            aria-label={t('回收', 'Trash')}
            onClick={() => setDialog('trash')}
          />
          <IconButton
            icon={X}
            aria-label={t('清除选择', 'Clear selection')}
            onClick={() => setSelected([])}
          />
        </div>
      )}
    </>
  );
  const treeOptions = !p.readonly && (
    <IconButton
      icon={Ellipsis}
      data-testid="file-tree-options"
      aria-label={t('文件选项', 'File options')}
      aria-haspopup="menu"
      onClick={(e) =>
        setMenu({
          anchor: e.currentTarget,
          items: [
            ...(['name', 'manual'] as const).map((sort) => ({
              id: sort,
              label:
                sort === 'name'
                  ? t('名称排序', 'Name order')
                  : t('手动排序', 'Manual order'),
              icon: Check,
              checked: org.sort === sort,
              onSelect: () => updateOrg({ ...org, sort }),
            })),
            {
              id: 'collapse',
              label: t('收起全部', 'Collapse all'),
              icon: ChevronsDownUp,
              onSelect: () =>
                p.session.setSessionState({
                  ...p.snapshot.session,
                  expandedDirs: [],
                }),
            },
          ],
        })
      }
    />
  );
  const toggle = (
    <IconButton
      className="management-toggle"
      aria-expanded={!collapsed}
      icon={collapsed ? PanelLeftOpen : PanelLeftClose}
      aria-label={
        collapsed
          ? t('展开侧栏', 'Expand sidebar')
          : t('收起侧栏', 'Collapse sidebar')
      }
      onClick={() => {
        setCollapsed(!collapsed);
        void saveDevice({ collapsed: !collapsed }).catch((e) =>
          setError(String(e)),
        );
      }}
    />
  );
  const sidebar = (
    <div className="management-navigation" ref={root}>
      <nav
        className="workspace-sidebar-nav"
        aria-label={
          p.onEnterWorkspace ? t('当前工作区', 'Current workspace') : undefined
        }
      >
        <button
          type="button"
          className="file-tree-nav vm-nav-row"
          aria-current={
            p.workspaceVisible !== false &&
            (view === 'all' || view === 'library')
              ? 'page'
              : undefined
          }
          onClick={async () => {
            if (p.onEnterWorkspace && !(await p.onEnterWorkspace())) return;
            changeView('all');
          }}
        >
          <LayoutDashboard strokeWidth={1.75} size={16} aria-hidden />
          <span>{t('工作区', 'Workspace')}</span>
        </button>
        <button
          type="button"
          className="file-tree-nav vm-nav-row workspace-search-trigger"
          aria-haspopup="dialog"
          aria-expanded={scope !== null}
          data-pointer-focus={searchPointerFocus || undefined}
          onKeyDownCapture={() => setSearchPointerFocus(false)}
          onBlur={() => setSearchPointerFocus(false)}
          onClick={(event) =>
            p.onOpenSearch(event.detail > 0 ? 'pointer' : 'keyboard')
          }
        >
          <Search strokeWidth={1.75} size={16} aria-hidden />
          <span>{t('搜索', 'Search')}</span>
        </button>
      </nav>
      <div className="management-sidebar-body">
        {pinnedFiles.length ? (
          <SidebarSection
            title={t('置顶', 'Pinned')}
            storageKey={`verd-favorites-${identity}`}
          >
            {pinnedFiles}
          </SidebarSection>
        ) : (
          <p className="management-pinned-empty vm-section-label">
            {t('置顶 · 暂无', 'Pinned · None')}
          </p>
        )}
        {view === 'file' && selectionToolbar}
        <div
          className="management-tree"
          onClickCapture={(e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>(
              '[data-entry-path]',
            );
            if (!row) return;
            const path = row.dataset['entryPath']!;
            if (e.metaKey || e.ctrlKey || e.shiftKey) {
              if (p.readonly) return;
              choose(path, e);
              e.preventDefault();
              e.stopPropagation();
            } else if ((e.target as HTMLElement).closest('.file-tree-main')) {
              setSelected([]);
              anchor.current = path;
            }
          }}
          onKeyDown={(e) => {
            const buttons = [
              ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                '.file-tree-main',
              ),
            ].filter((b) => b.offsetParent !== null);
            const at = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const row = (
              document.activeElement as HTMLElement
            )?.closest<HTMLElement>('[data-entry-path]');
            if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && row) {
              const toggle = row.querySelector<HTMLButtonElement>(
                '.file-tree-dir-toggle',
              );
              if (
                toggle &&
                toggle.getAttribute('aria-expanded') ===
                  (e.key === 'ArrowRight' ? 'false' : 'true')
              ) {
                e.preventDefault();
                toggle.click();
              } else if (e.key === 'ArrowLeft') {
                const path = row.dataset['entryPath']!;
                const parent = path.includes('/')
                  ? path.slice(0, path.lastIndexOf('/'))
                  : '';
                const target = [
                  ...root.current!.querySelectorAll<HTMLElement>(
                    '[data-entry-path]',
                  ),
                ].find((el) => el.dataset['entryPath'] === parent);
                target
                  ?.querySelector<HTMLButtonElement>('.file-tree-main')
                  ?.focus();
              }
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              buttons[
                Math.max(
                  0,
                  Math.min(
                    buttons.length - 1,
                    at + (e.key === 'ArrowDown' ? 1 : -1),
                  ),
                )
              ]?.focus();
            }
          }}
          onDragStart={(e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>(
              '[data-entry-path]',
            );
            if (!row || p.readonly) return;
            const path = row.dataset['entryPath']!;
            dragPaths.current = selected.includes(path)
              ? selectedRoots
              : [path];
            e.dataTransfer.setData(
              'text/plain',
              JSON.stringify(dragPaths.current),
            );
          }}
          onDragOver={(e) => {
            if (!dragPaths.current.length) return;
            const target = targetForDrop(e.target as HTMLElement, e.clientY);
            if (target) {
              e.preventDefault();
              setDrop(target);
            }
          }}
          onDragEnd={() => {
            dragPaths.current = [];
            setDrop(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const target = targetForDrop(e.target as HTMLElement, e.clientY);
            if (!target || p.readonly) return;
            const drop = target;
            const paths = dragPaths.current;
            if (paths.includes(drop.path)) {
              setDrop(null);
              dragPaths.current = [];
              return;
            }
            dragPaths.current = [];
            setDrop(null);
            void perform(async () => {
              const dir =
                drop.side === 'inside'
                  ? drop.path
                  : drop.path.includes('/')
                    ? drop.path.slice(0, drop.path.lastIndexOf('/'))
                    : '';
              let navigation: typeof org | undefined;
              if (drop.side !== 'inside') {
                const refs = refsFor(dir);
                const moving = paths.map((path) => {
                  const f = files.find((f) => f.path === path);
                  return f
                    ? 'file:' + f.id
                    : 'path:' +
                        ((dir ? dir + '/' : '') + path.split('/').pop());
                });
                const target = files.find((f) => f.path === drop.path);
                const targetRef = target
                  ? 'file:' + target.id
                  : 'path:' + drop.path;
                const order = refs.filter((r) => !moving.includes(r));
                const index = order.indexOf(targetRef);
                order.splice(
                  index + (drop.side === 'after' ? 1 : 0),
                  0,
                  ...moving,
                );
                navigation = { ...org, order: { ...org.order, [dir]: order } };
              }
              await move(paths, dir, navigation);
            });
          }}
        >
          {isValidElement(p.tree)
            ? cloneElement(
                p.tree as ReactElement<{
                  headerOptions?: ReactNode;
                  selectedPaths?: string[];
                  dropTarget?: typeof drop;
                }>,
                {
                  headerOptions: treeOptions,
                  selectedPaths: selected,
                  dropTarget: drop,
                },
              )
            : p.tree}
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
  const resize = (
    <>
      {/* The focusable separator supports keyboard resizing as well as dragging. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className="workspace-resize-handle"
        role="separator"
        aria-label={t('侧栏宽度', 'Sidebar width')}
        aria-orientation="vertical"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const next = Math.min(
              360,
              Math.max(220, width + (e.key === 'ArrowRight' ? 8 : -8)),
            );
            setWidth(next);
            void saveDevice({ width: next });
          }
        }}
        onPointerDown={(e) => {
          const start = e.clientX,
            original = width;
          e.currentTarget.setPointerCapture(e.pointerId);
          const element = e.currentTarget;
          const move = (event: PointerEvent) =>
            setWidth(
              Math.min(360, Math.max(220, original + event.clientX - start)),
            );
          const up = (event: PointerEvent) => {
            element.removeEventListener('pointermove', move);
            element.removeEventListener('pointerup', up);
            void saveDevice({
              width: Math.min(
                360,
                Math.max(220, original + event.clientX - start),
              ),
            });
          };
          element.addEventListener('pointermove', move);
          element.addEventListener('pointerup', up);
        }}
      />
    </>
  );
  const main = (
    <>
      {(view === 'all' || view === 'library') && (
        <div className="content-tabs">
          <button
            type="button"
            aria-current={view === 'all' ? 'page' : undefined}
            onClick={() => changeView('all')}
          >
            {t('全部内容', 'All content')}
          </button>
          <button
            type="button"
            aria-current={view === 'library' ? 'page' : undefined}
            onClick={p.onLibrary}
          >
            {t('图表', 'Charts')}
          </button>
        </div>
      )}
      {view === 'all' && (
        <section
          className="management-page"
          data-testid="workspace-management-page"
        >
          <h1>{t('工作区', 'Workspace')}</h1>
          {selectionToolbar}
          <WorkspaceInput
            type="search"
            placeholder={t('筛选名称或路径…', 'Filter names or paths…')}
            aria-label={t('筛选名称或路径', 'Filter names or paths')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="management-toolbar">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              aria-label={t('类型', 'Type')}
            >
              <option value="all">{t('全部', 'All')}</option>
              <option value="document">{t('文档', 'Documents')}</option>
              <option value="resource">{t('资源', 'Resources')}</option>
              <option value="canvas">{t('普通画布', 'Canvases')}</option>
              {[
                ['mind', '思维导图', 'Mind maps'],
                ['workflow', '工作流', 'Workflows'],
                ['architecture', '架构图', 'Architecture'],
                ['uml-class', 'UML 类图', 'UML classes'],
                ['uml-sequence', 'UML 时序图', 'UML sequences'],
              ].map(([value, cn, en]) => (
                <option key={value} value={value}>
                  {t(cn, en)}
                </option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                checked={favoriteOnly}
                onChange={(e) => setFavoriteOnly(e.target.checked)}
              />
              {t('仅置顶', 'Pinned only')}
            </label>
            <WorkspaceInput
              aria-label={t('标签筛选', 'Filter tags')}
              placeholder={t('标签', 'Tag')}
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
            />
            <WorkspaceInput
              aria-label={t('状态筛选', 'Filter status')}
              placeholder={t('状态', 'Status')}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            />
            <WorkspaceInput
              aria-label={t('目录筛选', 'Filter folders')}
              placeholder={t('目录', 'Folder')}
              value={directoryFilter}
              onChange={(event) => setDirectoryFilter(event.target.value)}
            />
            {!p.readonly && (
              <WorkspaceInput
                aria-label={t('视图名称', 'View name')}
                placeholder={t('视图名称', 'View name')}
                value={viewName}
                onChange={(event) => setViewName(event.target.value)}
              />
            )}
            {!p.readonly && (
              <WorkspaceButton
                disabled={!viewName.trim()}
                onClick={() => {
                  const label = viewName;
                  if (label?.trim())
                    p.session.setWorkspaceConfig({
                      ...p.session.getState().config.value,
                      savedViews: [
                        ...savedViews.filter(
                          (view) => view.name !== label.trim(),
                        ),
                        {
                          name: label.trim(),
                          query,
                          tag: tagFilter,
                          status: statusFilter,
                          directory: directoryFilter,
                          type,
                          favorites: favoriteOnly,
                        },
                      ],
                    });
                }}
              >
                {t('保存筛选视图', 'Save filtered view')}
              </WorkspaceButton>
            )}
            {savedViews.map((saved) => (
              <span key={saved.name}>
                <WorkspaceButton
                  onClick={() => {
                    setQuery(saved.query);
                    setTagFilter(saved.tag);
                    setStatusFilter(saved.status);
                    setDirectoryFilter(saved.directory);
                    setType(saved.type);
                    setFavoriteOnly(saved.favorites);
                  }}
                >
                  {saved.name}
                </WorkspaceButton>
                {!p.readonly && (
                  <WorkspaceButton
                    aria-label={t('删除视图 ', 'Delete view ') + saved.name}
                    onClick={() =>
                      p.session.setWorkspaceConfig({
                        ...p.session.getState().config.value,
                        savedViews: savedViews.filter(
                          (view) => view.name !== saved.name,
                        ),
                      })
                    }
                  >
                    <X strokeWidth={1.75} size={16} aria-hidden />
                  </WorkspaceButton>
                )}
              </span>
            ))}
          </div>
          <p className="content-result-count">
            {resultCount} {t('项结果', 'results')}
          </p>
          {!resultCount && (
            <p className="workspace-empty-state">
              {t('没有匹配的内容', 'No matching content')}
            </p>
          )}
          {rows.slice(0, limit).map((f) => (
            <div className="management-result" key={f.id}>
              <input
                type="checkbox"
                checked={selected.includes(f.path)}
                aria-label={t('选择', 'Select') + ' ' + f.title}
                onClick={(e) => {
                  if (e.shiftKey) {
                    e.preventDefault();
                    choose(f.path, e, resultPaths);
                  } else anchor.current = f.path;
                }}
                onChange={() =>
                  setSelected((old) =>
                    old.includes(f.path)
                      ? old.filter((x) => x !== f.path)
                      : [...old, f.path],
                  )
                }
              />
              <button
                type="button"
                className="management-result-open"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey)
                    choose(f.path, e, resultPaths);
                  else open(f.id);
                }}
              >
                {f.file.format === 'verd-document' ? (
                  <FileText strokeWidth={1.75} size={16} aria-hidden />
                ) : (
                  <PanelsTopLeft strokeWidth={1.75} size={16} aria-hidden />
                )}
                <span>
                  {f.title}
                  <small>
                    {[
                      f.file.properties?.status,
                      ...(f.file.properties?.tags ?? []),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                  <small>{f.path}</small>
                </span>
              </button>
              <IconButton
                icon={org.favorites.includes(f.id) ? PinOff : Pin}
                tooltip={!p.readonly}
                aria-pressed={org.favorites.includes(f.id)}
                aria-label={
                  org.favorites.includes(f.id)
                    ? t('取消置顶', 'Unpin')
                    : t('置顶', 'Pin')
                }
                disabled={p.readonly}
                onClick={() => toggleFavorite(f.id)}
              />
              {!p.readonly && (
                <IconButton
                  icon={Ellipsis}
                  aria-label={t('更多操作', 'More actions')}
                  aria-haspopup="menu"
                  onClick={(e) =>
                    setMenu({
                      anchor: e.currentTarget,
                      items: [
                        {
                          id: 'rename',
                          label: t('重命名', 'Rename'),
                          icon: Pencil,
                          onSelect: () => {
                            setSelected([f.path]);
                            setName(f.title);
                            setDialog('rename');
                          },
                        },
                        {
                          id: 'move',
                          label: t('移动到…', 'Move to…'),
                          icon: FolderInput,
                          onSelect: () => {
                            setSelected([f.path]);
                            setDialog('move');
                          },
                        },
                        {
                          id: 'trash',
                          label: t('移入回收站', 'Move to trash'),
                          icon: Trash2,
                          danger: true,
                          onSelect: () => {
                            setSelected([f.path]);
                            setDialog('trash');
                          },
                        },
                      ],
                    })
                  }
                />
              )}
            </div>
          ))}
          {rawRows
            .slice(0, Math.max(0, limit - rows.length))
            .map((resource) => {
              const path = resource.path,
                title = path.split('/').pop()!;
              return (
                <div
                  className="management-result"
                  key={path}
                  data-entry-path={path}
                  data-entry-kind="resource"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(path)}
                    aria-label={t('选择', 'Select') + ' ' + title}
                    onClick={(event) => {
                      if (event.shiftKey) {
                        event.preventDefault();
                        choose(path, event, resultPaths);
                      } else anchor.current = path;
                    }}
                    onChange={() =>
                      setSelected((old) =>
                        old.includes(path)
                          ? old.filter((value) => value !== path)
                          : [...old, path],
                      )
                    }
                  />
                  <button
                    type="button"
                    className="management-result-open"
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey)
                        choose(path, event, resultPaths);
                      else p.onOpenResource?.(path);
                    }}
                  >
                    <FileText size={16} aria-hidden />
                    <span>
                      {title}
                      <small>{path}</small>
                    </span>
                  </button>
                  {!p.readonly && (
                    <IconButton
                      icon={Ellipsis}
                      aria-label={t('更多操作', 'More actions')}
                      aria-haspopup="menu"
                      onClick={(event) =>
                        setMenu({
                          anchor: event.currentTarget,
                          items: [
                            {
                              id: 'rename',
                              label: t('重命名', 'Rename'),
                              icon: Pencil,
                              onSelect: () => {
                                setSelected([path]);
                                setName(title);
                                setDialog('rename');
                              },
                            },
                            {
                              id: 'move',
                              label: t('移动到…', 'Move to…'),
                              icon: FolderInput,
                              onSelect: () => {
                                setSelected([path]);
                                setDialog('move');
                              },
                            },
                            {
                              id: 'trash',
                              label: t('移入回收站', 'Move to trash'),
                              icon: Trash2,
                              danger: true,
                              onSelect: () => {
                                setSelected([path]);
                                setDialog('trash');
                              },
                            },
                          ],
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
          {failedRows
            .slice(0, Math.max(0, limit - rows.length - rawRows.length))
            .map((failure) => (
              <div
                key={failure.path}
                className="management-result"
                data-entry-path={failure.path}
                data-entry-kind="failed"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(failure.path)}
                  aria-label={t('选择', 'Select') + ' ' + failure.path}
                  onChange={() =>
                    setSelected((old) =>
                      old.includes(failure.path)
                        ? old.filter((path) => path !== failure.path)
                        : [...old, failure.path],
                    )
                  }
                />
                <button
                  type="button"
                  className="management-result-open"
                  onClick={() => p.onOpenFailedFile?.(failure.path)}
                >
                  <TriangleAlert size={16} aria-hidden />
                  <span>
                    {failure.path}
                    <small>
                      {failure.diagnostics
                        .map((issue) => issue.message)
                        .join('; ')}
                    </small>
                  </span>
                </button>
              </div>
            ))}
          {resultCount > limit && (
            <WorkspaceButton onClick={() => setLimit(limit + 60)}>
              {t('显示更多', 'Show more')}
            </WorkspaceButton>
          )}
        </section>
      )}
    </>
  );
  return (
    <ManagementContext.Provider
      value={{
        sidebar,
        main,
        toggle,
        resize,
      }}
    >
      {p.children}
      {scope && (
        <WorkspaceSearchDialog
          zh={zh}
          scope={scope}
          query={searchQuery}
          loading={!!searchQuery.trim() && searchResult?.key !== searchKey}
          hits={searchResult?.key === searchKey ? searchResult.hits : []}
          paths={pathResults}
          onQuery={setSearchQuery}
          onScope={setScope}
          onClose={() => {
            setSearchPointerFocus(searchActivation.current === 'pointer');
            setSearchResult(undefined);
            setScope(null);
          }}
          onOpenHit={async (hit) => {
            if (hit.source === 'content') return p.onSearchHit(hit);
            const result = await p.onSearchFile(hit.id);
            return result.status === 'completed' || result.status === 'noop';
          }}
          onOpenPath={({ path, kind }) => {
            if (kind === 'failed') p.onOpenFailedFile?.(path);
            else p.onOpenResource?.(path);
          }}
        />
      )}
      {menu && (
        <FileTreeMenu
          label={t('操作', 'Actions')}
          anchor={menu.anchor}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
      {dialog &&
        createPortal(
          <ManagementDialog
            onClose={() => {
              if (!busy) setDialog(null);
            }}
            className="management-modal"
            aria-label={t('管理', 'Manage')}
            title={
              dialog === 'move'
                ? t('移动到', 'Move to')
                : dialog === 'rename'
                  ? t('重命名', 'Rename')
                  : t('移入回收站', 'Move to trash')
            }
            closeLabel={t('关闭', 'Close')}
            busy={busy}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  if (dialog === 'move') await move(selectedRoots, destination);
                  else if (dialog === 'trash')
                    await run({
                      type: 'organize-entries',
                      trashPaths: selectedRoots,
                    });
                  else {
                    const path = selected[0];
                    const f = files.find((f) => f.path === path);
                    if (f)
                      await run({
                        type:
                          f.file.format === 'verd-document'
                            ? 'rename-document'
                            : 'rename-canvas',
                        fileId: f.id,
                        title: name,
                      });
                    else {
                      if (
                        !name.trim() ||
                        /[/\\]/.test(name) ||
                        name === '.' ||
                        name === '..'
                      )
                        throw new Error('Invalid name');
                      await run({
                        type: 'move-directory',
                        path,
                        toPath:
                          (path.includes('/')
                            ? path.slice(0, path.lastIndexOf('/') + 1)
                            : '') + name.trim(),
                      });
                    }
                  }
                });
              }}
            >
              {dialog === 'move' ? (
                <select
                  aria-label={t('目标目录', 'Destination folder')}
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">
                    {t('工作区根目录', 'Workspace root')}
                  </option>
                  {p.snapshot.entries
                    .filter(
                      (e) =>
                        e.kind === 'directory' &&
                        isWorkspaceContentPath(e.path, p.snapshot.entries) &&
                        !selectedRoots.some(
                          (path) =>
                            e.path === path || e.path.startsWith(path + '/'),
                        ),
                    )
                    .map((e) => (
                      <option key={e.path} value={e.path}>
                        {e.path}
                      </option>
                    ))}
                </select>
              ) : dialog === 'rename' ? (
                <WorkspaceInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              ) : (
                <p>
                  {t(
                    '将所选项目移入回收站，可撤销。',
                    'Move selected items to trash. This can be undone.',
                  )}
                </p>
              )}
              <div className="vm-dialog__footer">
                <WorkspaceButton
                  className="vm-btn vm-btn--secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  {t('取消', 'Cancel')}
                </WorkspaceButton>
                <WorkspaceButton
                  type="submit"
                  className={`vm-btn ${dialog === 'trash' ? 'vm-btn--danger' : 'vm-btn--primary'}`}
                  disabled={busy || (dialog === 'rename' && !name.trim())}
                >
                  {t('确定', 'Confirm')}
                </WorkspaceButton>
              </div>
            </form>
            {error && <p role="alert">{error}</p>}
          </ManagementDialog>,
          document.body,
        )}
    </ManagementContext.Provider>
  );
}
