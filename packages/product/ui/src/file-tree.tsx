import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Download,
  Ellipsis,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutTemplate,
  LibraryBig,
  Network,
  Pencil,
  Trash2,
  TriangleAlert,
  Upload,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { WorkspaceActionConfirmation } from './workspace-action-confirmation';
import { FileTreeMenu, type FileTreeMenuItem } from './file-tree-menu';

export interface FileTreeEntry {
  path: string;
  kind: 'file' | 'directory';
  canvas?: boolean;
  /** `*.verd-doc.json` payload files. */
  document?: boolean;
}

export interface FileTreeCanvas {
  frameId: string;
  path: string;
  name: string;
  dirty?: boolean;
  conflicted?: boolean;
  /** Diagram icon; every file remains visible at its real path. */
  diagram?:
    | 'canvas'
    | 'mind'
    | 'workflow'
    | 'architecture'
    | 'uml-class'
    | 'uml-sequence';
}

export interface FileTreeSubgraph {
  frameId: string;
  name: string;
  path: string;
  diagram: 'mind' | 'workflow' | 'architecture' | 'uml-class' | 'uml-sequence';
  placement: 'owned' | 'unorganized' | 'standalone' | 'legacy';
  ownerFrameId?: string;
  dirty?: boolean;
  conflicted?: boolean;
}

export interface FileTreeDocument {
  fileId: string;
  path: string;
  name: string;
  dirty?: boolean;
  conflicted?: boolean;
}

/** One row in the tree — a canvas or an independent document. */
interface TreeFile {
  fileId: string;
  path: string;
  name: string;
  kind: 'canvas' | 'document';
  diagram?: FileTreeCanvas['diagram'];
  dirty?: boolean;
  conflicted?: boolean;
}

export interface FileTreeProps {
  entries: FileTreeEntry[];
  canvases: FileTreeCanvas[];
  /** Independent `*.verd-doc.json` documents. */
  documents?: FileTreeDocument[];
  activeFileId?: string | null;
  expandedDirs: string[];
  locale?: 'zh' | 'en';
  /** Opens any file identity — canvas root or document id. */
  onOpenFile(fileId: string): void;
  onToggleDir(path: string): void;
  onCreateCanvas(dirPath: string): void;
  /** Creates an independent document inside `dirPath`. */
  onCreateDocument?(dirPath: string): void;
  /** Create a directory `name` inside `dirPath`. */
  onCreateFolder?(dirPath: string, name: string): void;
  onTrash(frameId: string): void;
  onTrashDirectory?(path: string): Promise<void>;
  onMove?(frameId: string, toPath: string): void;
  /** Independent copy of the file plus its dependency closure. */
  onDuplicate?(frameId: string): void;
  /** Exports the file plus its dependency closure as a bundle. */
  onExport?(frameId: string): void;
  /** Imports a `.verd.json` file or canvas bundle into the workspace. */
  onImport?(): void;
  /** Hides every control that would write to the workspace. */
  readonly?: boolean;
  /** Organization metadata used to derive navigation-only shortcuts. */
  subgraphs?: FileTreeSubgraph[];
  expandedOwners?: string[];
  onToggleOwner?(frameId: string): void;
  onOpenLibrary?(): void;
  libraryActive?: boolean;
  /** Reveal the canonical row after the host expands its ancestor directories. */
  revealFile?: { fileId: string; nonce: number };
  onRevealFile?(fileId: string): void;
}

interface TreeDir {
  path: string;
  name: string;
  dirs: TreeDir[];
  files: TreeFile[];
}

const labels = {
  zh: {
    library: '图表库',
    actions: (name: string) => `「${name}」的操作`,
    open: '打开',
    reveal: '在文件夹中显示',
    shortcut: '快捷入口',
    newCanvasHere: '在此新建画布',
    newDocumentHere: '在此新建文档',
    newFolderHere: '在此新建文件夹…',
    expandSubgraphs: '展开图表快捷入口',
    collapseSubgraphs: '收起图表快捷入口',
    unsaved: '未保存',
    files: '文件',
    newCanvas: '新建画布',
    newDocument: '新建文档',
    newFolder: '新建文件夹',
    rename: '重命名/移动',
    remove: '移入回收站',
    trashDirectory: '文件夹及全部内容将整体移入回收站，可以还原。',
    processing: '处理中…',
    empty: '工作区为空',
    renamePrompt: '输入新的工作区相对路径',
    conflicted: '存在冲突',
    duplicate: '创建独立副本',
    export: '导出(含依赖)',
    folderName: '文件夹名称',
    confirm: '确定',
    cancel: '取消',
    import: '导入画布/包',
  },
  en: {
    library: 'Chart library',
    actions: (name: string) => `Actions for ${name}`,
    open: 'Open',
    reveal: 'Show in folder',
    shortcut: 'Shortcut',
    newCanvasHere: 'New canvas here',
    newDocumentHere: 'New document here',
    newFolderHere: 'New folder here…',
    expandSubgraphs: 'Expand chart shortcuts',
    collapseSubgraphs: 'Collapse chart shortcuts',
    unsaved: 'Unsaved',
    files: 'Files',
    newCanvas: 'New canvas',
    newDocument: 'New document',
    newFolder: 'New folder',
    rename: 'Rename/move',
    remove: 'Move to trash',
    trashDirectory:
      'The folder and all its contents will move to trash together and can be restored.',
    processing: 'Processing…',
    empty: 'Workspace is empty',
    renamePrompt: 'Enter a new workspace-relative path',
    conflicted: 'Conflicted',
    duplicate: 'Duplicate independently',
    export: 'Export (with closure)',
    folderName: 'Folder name',
    confirm: 'OK',
    cancel: 'Cancel',
    import: 'Import canvas/bundle',
  },
};

/** Builds the directory hierarchy from flat workspace paths. */
const buildTree = (dirPaths: string[], files: TreeFile[]): TreeDir => {
  const root: TreeDir = { path: '', name: '', dirs: [], files: [] };
  const dirFor = (path: string): TreeDir => {
    if (!path) return root;
    const segments = path.split('/');
    let cursor = root;
    let current = '';
    segments.forEach((segment) => {
      current = current ? `${current}/${segment}` : segment;
      let next = cursor.dirs.find((dir) => dir.path === current);
      if (!next) {
        next = { path: current, name: segment, dirs: [], files: [] };
        cursor.dirs.push(next);
      }
      cursor = next;
    });
    return cursor;
  };
  dirPaths.forEach(dirFor);
  files.forEach((file) => {
    const dir = file.path.includes('/')
      ? file.path.slice(0, file.path.lastIndexOf('/'))
      : '';
    dirFor(dir).files.push(file);
  });
  const sort = (dir: TreeDir) => {
    dir.dirs.sort((a, b) => a.name.localeCompare(b.name));
    dir.files.sort((a, b) => a.name.localeCompare(b.name));
    dir.dirs.forEach(sort);
  };
  sort(root);
  return root;
};

/** Native dialogs also work in Electron, where window.prompt is unavailable. */
function FileTreePrompt({
  title,
  initialValue,
  confirm,
  cancel,
  rename,
  onSubmit,
  onClose,
}: {
  title: string;
  initialValue: string;
  confirm: string;
  cancel: string;
  rename?: boolean;
  onSubmit(value: string): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    const element = ref.current!;
    element.showModal();
    input.current?.focus();
    if (rename) {
      const start = initialValue.lastIndexOf('/') + 1;
      const suffix = initialValue.match(/\.verd(?:-doc)?\.json$/)?.[0] ?? '';
      input.current?.setSelectionRange(
        start,
        initialValue.length - suffix.length,
      );
    }
    // Removing the dialog releases the top layer. Closing it in effect cleanup
    // queues a close event during StrictMode's replay and dismisses the new mount.
  }, [initialValue, rename]);
  return (
    <dialog
      ref={ref}
      className="file-tree-prompt"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim() && value.trim() !== initialValue) {
            onSubmit(value.trim());
            onClose();
          }
        }}
      >
        <h2 id={titleId} className="file-tree-prompt__title">
          {title}
        </h2>
        <input
          ref={input}
          aria-label={title}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="file-tree-prompt__actions">
          <button
            className="workspace-button-ghost"
            type="button"
            onClick={onClose}
          >
            {cancel}
          </button>
          <button
            className="workspace-button-primary"
            type="submit"
            disabled={!value.trim() || value.trim() === initialValue}
          >
            {confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}
const diagramIcons = {
  canvas: LayoutTemplate,
  mind: Network,
  workflow: Workflow,
  architecture: Boxes,
  'uml-class': Boxes,
  'uml-sequence': Workflow,
};

export function FileTree({
  entries,
  canvases,
  documents = [],
  activeFileId,
  expandedDirs,
  locale = 'zh',
  onOpenFile,
  onToggleDir,
  onCreateCanvas,
  onCreateDocument,
  onCreateFolder,
  onTrash,
  onTrashDirectory,
  onMove,
  onDuplicate,
  onExport,
  onImport,
  readonly = false,
  subgraphs = [],
  expandedOwners = [],
  onToggleOwner,
  onOpenLibrary,
  libraryActive = false,
  revealFile,
  onRevealFile,
}: FileTreeProps) {
  const t = labels[locale];
  const [confirmation, setConfirmation] = useState<{
    title: string;
    message: string;
    action(): void | Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [operationError, setOperationError] = useState('');
  const perform = async (action: () => void | Promise<void>, close = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setOperationError('');
    try {
      await action();
      if (close) setConfirmation(null);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const [prompt, setPrompt] = useState<
    | { kind: 'rename'; file: TreeFile }
    | { kind: 'newFolder'; dirPath: string }
    | null
  >(null);
  const [menu, setMenu] = useState<{
    key: string;
    label: string;
    anchor: HTMLElement | { x: number; y: number };
    items: FileTreeMenuItem[];
  } | null>(null);
  const ownedBy = useMemo(() => {
    const map = new Map<string, FileTreeSubgraph[]>();
    const byId = new Map(canvases.map((file) => [file.frameId, file]));
    subgraphs.forEach((item) => {
      const source = byId.get(item.frameId);
      if (
        !source ||
        item.placement !== 'owned' ||
        !item.ownerFrameId ||
        !byId.has(item.ownerFrameId)
      )
        return;
      const list = map.get(item.ownerFrameId) ?? [];
      list.push({ ...item, ...source, diagram: item.diagram });
      map.set(item.ownerFrameId, list);
    });
    map.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
    return map;
  }, [subgraphs, canvases]);
  const tree = useMemo(
    () =>
      buildTree(
        entries
          .filter((entry) => entry.kind === 'directory')
          .map((entry) => entry.path),
        [
          ...canvases.map((item) => ({
            ...item,
            fileId: item.frameId,
            kind: 'canvas' as const,
          })),
          ...documents.map((item) => ({ ...item, kind: 'document' as const })),
        ],
      ),
    [entries, canvases, documents],
  );
  const fileButtons = useRef(new Map<string, HTMLButtonElement>());
  const revealed = useRef<typeof revealFile>(undefined);
  useEffect(() => {
    if (!revealFile || revealed.current === revealFile) return;
    // Floating menus restore their trigger in a microtask when they unmount.
    // Reveal afterwards, once the canonical row and its directories are ready.
    const frame = requestAnimationFrame(() => {
      const button = fileButtons.current.get(revealFile.fileId);
      if (!button) return;
      revealed.current = revealFile;
      button.scrollIntoView?.({ block: 'nearest' });
      button.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [revealFile, expandedDirs, tree]);
  const expanded = new Set(expandedDirs);
  const item = (
    id: string,
    label: string,
    icon: LucideIcon,
    onSelect: () => void,
    extra: Partial<FileTreeMenuItem> = {},
  ): FileTreeMenuItem => ({ id, label, icon, onSelect, ...extra });
  const openMenu = (
    event: MouseEvent<HTMLElement>,
    key: string,
    name: string,
    items: FileTreeMenuItem[],
  ) => {
    event.preventDefault();
    if (!items.length) return;
    if (event.type === 'contextmenu') {
      const trigger =
        event.currentTarget.querySelector<HTMLButtonElement>('.file-tree-more');
      trigger?.focus();
    }
    setMenu({
      key,
      label: t.actions(name),
      items,
      anchor:
        event.type === 'contextmenu'
          ? { x: event.clientX, y: event.clientY }
          : event.currentTarget,
    });
  };
  const fileItems = (file: TreeFile, shortcut = false): FileTreeMenuItem[] => {
    const id = file.fileId;
    if (shortcut)
      return [
        item('open', t.open, ExternalLink, () => onOpenFile(id)),
        ...(onRevealFile
          ? [item('reveal', t.reveal, FolderOpen, () => onRevealFile(id))]
          : []),
      ];
    const result: FileTreeMenuItem[] = [];
    if (!readonly) {
      if (onMove)
        result.push(
          item('rename', t.rename, Pencil, () =>
            setPrompt({ kind: 'rename', file }),
          ),
        );
      if (onDuplicate)
        result.push(
          item('duplicate', t.duplicate, CopyPlus, () => onDuplicate(id)),
        );
    }
    if (onExport)
      result.push(item('export', t.export, Download, () => onExport(id)));
    if (!readonly)
      result.push(
        item('trash', t.remove, Trash2, () => onTrash(id), {
          danger: true,
          groupStart: true,
        }),
      );
    return result;
  };
  const moreButton = (key: string, name: string, items: FileTreeMenuItem[]) =>
    items.length ? (
      <button
        type="button"
        className="file-tree-more"
        aria-label={t.actions(name)}
        aria-haspopup="menu"
        aria-expanded={menu?.key === key}
        onClick={(event) => openMenu(event, key, name, items)}
      >
        <Ellipsis size={14} aria-hidden />
      </button>
    ) : null;
  const fileRow = (
    file: TreeFile,
    depth: number,
    subgraph?: FileTreeSubgraph,
  ): ReactNode => {
    const children = subgraph ? [] : (ownedBy.get(file.fileId) ?? []);
    const open = expandedOwners.includes(file.fileId);
    const active = file.fileId === activeFileId;
    const items = fileItems(file, !!subgraph);
    const rowKey = JSON.stringify(
      subgraph
        ? ['shortcut', subgraph.ownerFrameId, file.fileId]
        : ['file', file.fileId],
    );
    const label = subgraph ? `${file.name} (${t.shortcut})` : file.name;
    const Icon =
      file.kind === 'document'
        ? FileText
        : diagramIcons[file.diagram ?? 'canvas'];
    return (
      <div key={rowKey} className="file-tree-block">
        <div
          className={`file-tree-row file-tree-file${subgraph ? ' file-tree-subgraph' : ''}${active ? ' is-active' : ''}${file.conflicted ? ' is-conflicted' : ''}${menu?.key === rowKey ? ' is-menu-open' : ''}`}
          data-file-id={file.fileId}
          data-entry-kind={subgraph ? 'shortcut' : 'file'}
          style={{ '--depth': depth } as CSSProperties}
          onContextMenu={(event) => openMenu(event, rowKey, label, items)}
        >
          {children.length ? (
            <button
              type="button"
              className="file-tree-twisty"
              aria-expanded={open}
              aria-label={open ? t.collapseSubgraphs : t.expandSubgraphs}
              onClick={() => onToggleOwner?.(file.fileId)}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="file-tree-twisty" aria-hidden />
          )}
          <button
            type="button"
            className="file-tree-main file-tree-name"
            aria-current={active ? 'page' : undefined}
            title={subgraph ? `${t.shortcut}: ${file.path}` : file.path}
            aria-label={subgraph ? label : undefined}
            ref={
              subgraph
                ? undefined
                : (node) => {
                    if (node) fileButtons.current.set(file.fileId, node);
                    else fileButtons.current.delete(file.fileId);
                  }
            }
            onClick={() => onOpenFile(file.fileId)}
          >
            <Icon className="file-tree-icon" size={15} aria-hidden />
            {subgraph && (
              <ExternalLink
                className="file-tree-shortcut-icon"
                size={11}
                aria-hidden
              />
            )}
            <span className="file-tree-label">{file.name}</span>
            {file.conflicted ? (
              <TriangleAlert
                className="file-tree-conflict"
                size={13}
                role="img"
                aria-label={t.conflicted}
              />
            ) : file.dirty ? (
              <span
                className="file-tree-dirty"
                role="img"
                aria-label={t.unsaved}
              />
            ) : null}
          </button>
          {moreButton(rowKey, label, items)}
        </div>
        {open
          ? children.map((child) =>
              fileRow(
                { ...child, fileId: child.frameId, kind: 'canvas' },
                depth + 1,
                child,
              ),
            )
          : null}
      </div>
    );
  };
  const dirRows = (dir: TreeDir, depth: number): ReactNode => {
    const open = expanded.has(dir.path);
    const dirKey = JSON.stringify(['directory', dir.path]);
    const inDir = (action: () => void) => () => {
      if (!open) onToggleDir(dir.path);
      action();
    };
    const items = readonly
      ? []
      : [
          item(
            'canvas',
            t.newCanvasHere,
            FilePlus2,
            inDir(() => onCreateCanvas(dir.path)),
          ),
          ...(onCreateDocument
            ? [
                item(
                  'document',
                  t.newDocumentHere,
                  FileText,
                  inDir(() => onCreateDocument(dir.path)),
                ),
              ]
            : []),
          ...(onCreateFolder
            ? [
                item(
                  'folder',
                  t.newFolderHere,
                  FolderPlus,
                  inDir(() =>
                    setPrompt({ kind: 'newFolder', dirPath: dir.path }),
                  ),
                ),
              ]
            : []),
          ...(onTrashDirectory && dir.path
            ? [
                item(
                  'trash-directory',
                  t.remove,
                  Trash2,
                  () => {
                    setOperationError('');
                    setConfirmation({
                      title: `${t.remove} ${dir.name}`,
                      message: t.trashDirectory,
                      action: () => onTrashDirectory(dir.path),
                    });
                  },
                  { danger: true, groupStart: true },
                ),
              ]
            : []),
        ];
    return (
      <div key={dir.path || '__root'}>
        {dir.path ? (
          <div
            className={`file-tree-row file-tree-dir${menu?.key === dirKey ? ' is-menu-open' : ''}`}
            style={{ '--depth': depth } as CSSProperties}
            onContextMenu={(event) => openMenu(event, dirKey, dir.name, items)}
          >
            <button
              type="button"
              className="file-tree-main file-tree-dir-toggle"
              aria-expanded={open}
              onClick={() => onToggleDir(dir.path)}
            >
              <span className="file-tree-twisty" aria-hidden>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              {open ? (
                <FolderOpen size={15} aria-hidden />
              ) : (
                <Folder size={15} aria-hidden />
              )}
              <span className="file-tree-label">{dir.name}</span>
            </button>
            {moreButton(dirKey, dir.name, items)}
          </div>
        ) : null}
        {open || !dir.path ? (
          <div className={dir.path ? 'file-tree-children' : undefined}>
            {dir.dirs.map((child) => dirRows(child, dir.path ? depth + 1 : 0))}
            {dir.files.map((file) => fileRow(file, dir.path ? depth + 1 : 0))}
          </div>
        ) : null}
      </div>
    );
  };
  const headerButton = (
    label: string,
    Icon: LucideIcon,
    action: () => void,
  ) => (
    <button type="button" aria-label={label} title={label} onClick={action}>
      <Icon size={15} aria-hidden />
    </button>
  );
  return (
    <div className="file-tree">
      {onOpenLibrary ? (
        <button
          type="button"
          className={`file-tree-nav${libraryActive ? ' is-active' : ''}`}
          aria-current={libraryActive ? 'page' : undefined}
          onClick={onOpenLibrary}
        >
          <LibraryBig size={16} aria-hidden />
          {t.library}
        </button>
      ) : null}
      <div className="file-tree-header">
        <span>{t.files}</span>
        {!readonly ? (
          <span className="file-tree-header-actions">
            {headerButton(t.newCanvas, FilePlus2, () => onCreateCanvas(''))}
            {onCreateDocument
              ? headerButton(t.newDocument, FileText, () =>
                  onCreateDocument(''),
                )
              : null}
            {onCreateFolder
              ? headerButton(t.newFolder, FolderPlus, () =>
                  setPrompt({ kind: 'newFolder', dirPath: '' }),
                )
              : null}
            {onImport ? headerButton(t.import, Upload, onImport) : null}
          </span>
        ) : null}
      </div>
      <div className="file-tree-body">
        {tree.dirs.length + tree.files.length ? (
          dirRows(tree, 0)
        ) : (
          <div className="file-tree-empty">{t.empty}</div>
        )}
      </div>
      {operationError && !confirmation && (
        <p className="file-tree-operation-error" role="alert">
          {operationError}
        </p>
      )}
      {confirmation && (
        <WorkspaceActionConfirmation
          title={confirmation.title}
          message={confirmation.message}
          confirm={busy ? t.processing : t.confirm}
          cancel={t.cancel}
          busy={busy}
          error={operationError}
          onClose={() => {
            setConfirmation(null);
            setOperationError('');
          }}
          onConfirm={() => void perform(confirmation.action, true)}
        />
      )}
      {menu ? (
        <FileTreeMenu
          key={menu.key}
          label={menu.label}
          anchor={menu.anchor}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {prompt ? (
        <FileTreePrompt
          title={prompt.kind === 'rename' ? t.renamePrompt : t.folderName}
          initialValue={prompt.kind === 'rename' ? prompt.file.path : ''}
          rename={prompt.kind === 'rename'}
          confirm={t.confirm}
          cancel={t.cancel}
          onClose={() => setPrompt(null)}
          onSubmit={(value) => {
            if (prompt.kind === 'rename') onMove?.(prompt.file.fileId, value);
            else onCreateFolder?.(prompt.dirPath, value);
          }}
        />
      ) : null}
    </div>
  );
}
