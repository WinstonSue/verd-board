import { registerUmlCells } from '@sue/board-uml';
import {
  ChevronRight,
  LoaderCircle,
  UserRound,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createCellRegistry,
  createFrameCell,
  createFrameReferenceCell,
  createDocumentReferenceCell,
  createDocumentFrameCell,
  isDocumentFrameCell,
  frameScene,
  indexCells,
  isFrameReferenceCell,
  isFrameCell,
  type CellChange,
  type CellId,
  type CellRegistry,
} from '@sue/board-core';
import { registerDrawCells } from '@sue/board-draw';
import {
  ChartLibrary,
  OrganizePreview,
  type OrganizePreviewRow,
  DocumentPage,
  FileTree,
  I18nProvider,
  WorkspaceEmpty,
  WorkspaceSettings,
  WorkspaceMenu,
  MyPage,
  WorkspaceTabs,
  VerdFrame,
  useI18n,
  type DocumentEditorChange,
  type DocumentSelection,
  type DocumentSaveState,
} from '@sue/verd-board-ui';
import {
  assessReferencePlace,
  createFrameFile,
  diagramKindOf,
  isRegularCanvas,
  partitionCellStore,
  organizePreviewIsStale,
  recommendOrganization,
  referenceSourcesOf,
  sameFrameContent,
  type FrameFileV2,
} from './frames/frame-files';
import {
  createDocumentFile,
  documentPathFor,
  isDocumentFileV1,
  type DocumentFileV1,
} from './documents/document-files';
import { parseDocumentLink } from './documents/document-links';
import {
  workspaceDocumentPreviews,
  WorkspaceCanvasReference,
  type PreviewOptions,
} from './documents/workspace-previews';
import {
  workspaceExportBundle,
  parseWorkspaceExport,
} from './documents/workspace-references';
import {
  parseMarkdownToTextDocument,
  serializeTextDocumentToMarkdown,
} from '@sue/board-markdown-to-text';
import type { FrameSnapshot } from '@sue/board-core';
import type { WorkspaceSnapshot } from './frames/workspace-storage';
import {
  canvasDisplayName,
  documentDisplayName,
  openWorkspaceSession,
  type WorkspaceFileEntry,
  type WorkspaceSession,
  type WorkspaceSessionSnapshot,
} from './session/workspace-session';
import {
  createCanvasSession,
  refOccurrenceId,
  rootOccurrenceId,
} from './canvas/canvas-session';
import {
  planReturnToSource,
  rememberEntrySource,
  type EntrySource,
} from './session/entry-source';
import type { FrameInstanceHost, FrameOpenSource } from '@sue/verd-board-ui';
import {
  closeWorkspaceTabs,
  deleteWorkspaceTabGroup,
  pruneWorkspaceTabs,
  retainedWorkspaceTabs,
  updateWorkspaceNavigation,
  workspaceFileDirectories,
  workspaceTabGroups,
  type TabCloseScope,
} from './session/workspace-navigation';
import type {
  OpenWorkspaceRequest,
  WorkspaceHandle,
  WorkspaceHost,
} from './host/workspace-host';
import type { SaveStatus } from './storage-adapter';

export interface WorkspaceAppProps {
  host: WorkspaceHost;
  workspace?: OpenWorkspaceRequest;
  registry?: CellRegistry;
  parseLegacy?(definition: string, filename: string): Promise<FrameSnapshot>;
  /**
   * Reads the pre-workspace storage record (flat manifest / legacy keys).
   * Consulted only when the opened workspace has no canvas files; its
   * snapshot is partitioned into `.verd.json` files via `import-files`.
   */
  importLegacy?(): Promise<WorkspaceSnapshot | null>;
  /** Renders the workspace read-only: canvas edits and file mutations off. */
  readonly?: boolean;
  onOpen?(handle: WorkspaceHandle): void;
  /** Desktop directory picker and return-to-built-in actions. */
  allowWorkspaceSwitching?: boolean;
}

const sameFile = (left: FrameFileV2, right: FrameFileV2) =>
  JSON.stringify(left) === JSON.stringify(right);

const download = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id-${Math.random().toString(36).slice(2)}`;

/**
 * React StrictMode mounts the open effect twice; both runs can observe an
 * empty workspace before either seeds it. Remember initialized workspace
 * handles for the page session so only the first run seeds a default board.
 */
const initializedWorkspaces = new Set<string>();

/**
 * Workspace-level shell: file tree + tabs + one VerdFrame per open canvas.
 * Open canvases stay mounted (hidden) so per-tab view state — camera,
 * selection, tool — survives tab switches without persistence.
 */
export function WorkspaceApp(props: WorkspaceAppProps) {
  return (
    <I18nProvider>
      <WorkspaceAppShell {...props} />
    </I18nProvider>
  );
}

function WorkspaceAppShell({
  host,
  workspace,
  registry,
  parseLegacy,
  importLegacy,
  readonly = false,
  onOpen,
  allowWorkspaceSwitching = false,
}: WorkspaceAppProps) {
  const { language } = useI18n();
  const locale = language === 'en' ? 'en' : 'zh';
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSessionSnapshot | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    text: string;
    tone: 'info' | 'error';
  } | null>(null);
  const notify = useCallback(
    (text: string, tone: 'info' | 'error' = 'info') =>
      setNotice({ text, tone }),
    [],
  );
  const [handleName, setHandleName] = useState('');
  const [isDefaultWorkspace, setIsDefaultWorkspace] = useState(false);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [documentNavigation, setDocumentNavigation] = useState<{
    fileId: CellId;
    anchor: string | null;
    requestId: number;
  } | null>(null);
  const requestSequence = useRef(0);
  const switchingRef = useRef(false);
  const activeWorkspace = useRef<{
    handle: WorkspaceHandle;
    session: WorkspaceSession;
    unsubscribe(): void;
  } | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [menuFocusRequest, setMenuFocusRequest] = useState(0);
  const menuFocusHandled = useRef(0);
  useEffect(() => {
    if (switchingWorkspace || menuFocusRequest === menuFocusHandled.current)
      return;
    const frame = requestAnimationFrame(() => {
      settingsButtonRef.current?.focus();
      menuFocusHandled.current = menuFocusRequest;
    });
    return () => cancelAnimationFrame(frame);
  }, [switchingWorkspace, menuFocusRequest]);
  const myFocus = useRef<HTMLElement | null>(null);
  const openMy = () => {
    myFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSettingsView('my');
  };
  const closeMy = () => {
    setSettingsView(null);
    requestAnimationFrame(() => myFocus.current?.focus());
  };
  const closeSettings = () => {
    setSettingsView(null);
    requestAnimationFrame(() => settingsButtonRef.current?.focus());
  };
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [expandedOwners, setExpandedOwners] = useState<string[]>([]);
  const [fileTreeReveal, setFileTreeReveal] = useState<{
    fileId: string;
    nonce: number;
  }>();
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryDiagram, setLibraryDiagram] = useState<
    | 'all'
    | 'canvas'
    | 'mind'
    | 'workflow'
    | 'architecture'
    | 'uml-class'
    | 'uml-sequence'
  >('all');
  const [libraryOwner, setLibraryOwner] = useState('all');
  const [libraryScroll, setLibraryScroll] = useState(0);
  const [pickerMode, setPickerMode] = useState<'chart' | 'preview'>('chart');
  const [pickerFileId, setPickerFileId] = useState<string | null>(null);
  const [documentPickerFileId, setDocumentPickerFileId] = useState<
    string | null
  >(null);
  const [documentPickerEditable, setDocumentPickerEditable] = useState(false);
  const [embeddedEditRequest, setEmbeddedEditRequest] = useState<
    { instanceId: string; nonce: number } | undefined
  >();
  const embeddedRestoreRef = useRef(
    new Map<string, { revision: number; selection?: DocumentSelection }>(),
  );
  const referenceScrollRef = useRef(
    new Map<string, { top: number; left: number }>(),
  );
  const [placeTarget, setPlaceTarget] = useState<{
    fileId: string;
    targetId: string;
    kind?: 'document' | 'document-frame';
    newDocument?: boolean;
  } | null>(null);
  const [reveal, setReveal] = useState<{
    fileId: string;
    cellId: string;
    nonce: number;
  } | null>(null);
  const [organizeRows, setOrganizeRows] = useState<OrganizePreviewRow[] | null>(
    null,
  );
  const sourcesRef = useRef(new Map<string, EntrySource>());
  const [sourceRev, setSourceRev] = useState(0);
  const [settingsView, setSettingsView] = useState<'workspace' | 'my' | null>(
    null,
  );
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>();
  const canvasRef = useRef<ReturnType<typeof createCanvasSession> | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  /**
   * The exact FrameSnapshot every mounted VerdFrame currently holds. All
   * tabs share the session's assembled store, so this is one cache: when
   * file content is unchanged (self-originated edits round-trip through
   * the same object, navigation ops don't touch files) the identical
   * `value` keeps `runtime.replace` and canvas-internal undo intact;
   * genuinely new content (undo, sync, restore, import) rebuilds it.
   */
  const emittedRef = useRef<{
    files: Map<CellId, FrameFileV2>;
    snapshot: FrameSnapshot;
  } | null>(null);
  const canvasValue = (state: WorkspaceSessionSnapshot): FrameSnapshot => {
    const prev = emittedRef.current;
    if (
      prev &&
      prev.files.size === state.files.size &&
      [...state.files.entries()].every(([id, entry]) => {
        const held = prev.files.get(id);
        return !!held && sameFile(entry.file, held);
      })
    )
      return prev.snapshot;
    const snapshot: FrameSnapshot = { store: state.store };
    emittedRef.current = {
      files: new Map(
        [...state.files.entries()].map(([id, entry]) => [id, entry.file]),
      ),
      snapshot,
    };
    return snapshot;
  };
  const registryRef = useRef<CellRegistry | null>(null);
  if (!registryRef.current) {
    registryRef.current = registry ?? createCellRegistry();
    if (!registry) registerDrawCells(registryRef.current);
    registerUmlCells(registryRef.current);
  }

  const openWorkspaceRequest = async (
    request?: OpenWorkspaceRequest,
    initial = false,
  ) => {
    if (switchingRef.current && !initial) return;
    const sequence = ++requestSequence.current;
    const previous = activeWorkspace.current;
    let candidate: WorkspaceSession | null = null;
    let candidateHandle: WorkspaceHandle | null = null;
    switchingRef.current = true;
    setSwitchingWorkspace(true);
    try {
      if (previous) {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement) focused.blur();
        await new Promise((resolve) => setTimeout(resolve, 0));
        previous.session.freeze();
        if (!(await previous.session.flush()))
          throw new Error(
            locale === 'zh'
              ? '当前工作区未能保存，请解决保存错误后重试。'
              : 'Save the current workspace before switching folders.',
          );
      }
      const handle = await host.openWorkspace(request);
      candidateHandle = handle;
      if (sequence !== requestSequence.current) return;
      if (!handle) {
        if (!previous) setError('Workspace was not opened');
        return;
      }
      if (handle.key === previous?.handle.key) {
        await host.activateWorkspace?.(handle);
        return;
      }
      // Preserve the difference between missing navigation and deliberately
      // closed tabs. Only a first built-in open gets a reading starting point.
      const raw = await host.readSnapshot(handle);
      const opened = await openWorkspaceSession(host, handle, {
        registry: registryRef.current ?? undefined,
        onCommitted: (savedAt) => setLastSavedAt(savedAt),
      });
      candidate = opened;
      if (sequence !== requestSequence.current) return;
      const state = opened.getState();
      if (previous && state.diagnostics.length)
        throw new Error(
          state.diagnostics.map((item) => item.message).join('; '),
        );
      const initialized =
        !!state.config.value['workspaceInitialized'] ||
        raw.session !== null ||
        state.files.size > 0 ||
        state.documents.size > 0 ||
        state.diagnostics.length > 0;
      if (
        !initialized &&
        !state.session.tabs.length &&
        !readonly &&
        !initializedWorkspaces.has(handle.key)
      ) {
        // Explicit folders never import unrelated device-level legacy data.
        const legacy =
          importLegacy && handle.isDefault !== false
            ? await importLegacy()
            : null;
        const migrated = legacy ? partitionCellStore(legacy.store).files : [];
        if (migrated.length) {
          const result = await opened.apply({
            type: 'import-files',
            files: migrated,
            label: 'migrate-legacy',
          });
          if (!result.ok)
            throw new Error(
              result.diagnostics.map((d) => d.message).join('; '),
            );
          opened.setWorkspaceConfig({
            ...state.config.value,
            workspaceInitialized: true,
            migratedFromLegacy: true,
          });
          opened.setSessionState({
            tabs: [{ fileId: migrated[0].frame.id }],
            activeTabId: migrated[0].frame.id,
            expandedDirs: [],
          });
        } else {
          const frameId = uuid();
          const result = await opened.apply({
            type: 'create-file',
            file: createFrameFile(createFrameCell(frameId)),
            label: 'seed-default-board',
            recordHistory: false,
          });
          if (!result.ok)
            throw new Error(
              result.diagnostics.map((d) => d.message).join('; '),
            );
          opened.setWorkspaceConfig({
            ...state.config.value,
            workspaceInitialized: true,
          });
          opened.setSessionState({
            tabs: [{ fileId: frameId }],
            activeTabId: frameId,
            expandedDirs: [],
          });
        }
        initializedWorkspaces.add(handle.key);
      } else if (
        handle.isDefault &&
        raw.session === null &&
        state.files.has('board-root')
      ) {
        opened.setSessionState({
          tabs: [{ fileId: 'board-root' }],
          activeTabId: 'board-root',
          expandedDirs: state.entries
            .filter(
              (entry) => entry.kind === 'directory' && entry.path === '文档',
            )
            .map((entry) => entry.path),
        });
      }
      if (sequence !== requestSequence.current) return;
      // Cover metadata queued while the candidate was loading as well as
      // the content drained before the directory picker opened.
      if (previous && !(await previous.session.flush()))
        throw new Error(
          locale === 'zh'
            ? '当前工作区未能保存，请解决保存错误后重试。'
            : 'Save the current workspace before switching folders.',
        );
      await host.activateWorkspace?.(handle);
      previous?.unsubscribe();
      previous?.session.dispose();
      canvasRef.current?.dispose();
      if (previous) void host.closeWorkspace(previous.handle).catch(() => {});
      emittedRef.current = null;
      sourcesRef.current.clear();
      documentRestoreRef.current.clear();
      referenceScrollRef.current.clear();
      seenSubgraphs.current = null;
      setLibraryOpen(false);
      setSettingsView(null);
      setPlaceTarget(null);
      setPickerFileId(null);
      setDocumentPickerFileId(null);
      setOrganizeRows(null);
      setReveal(null);
      setFileTreeReveal(undefined);
      setDocumentNavigation(null);
      setExpandedOwners(
        handle.isDefault &&
          raw.session === null &&
          state.files.has('board-root')
          ? ['board-root']
          : [],
      );
      setLastSavedAt(undefined);
      canvasRef.current = createCanvasSession({
        session: opened,
        registry: registryRef.current ?? undefined,
      });
      activeWorkspace.current = {
        handle,
        session: opened,
        unsubscribe: opened.subscribe(() => setSnapshot(opened.getState())),
      };
      candidate = null;
      setHandleName(handle.name);
      setIsDefaultWorkspace(!!handle.isDefault);
      setSession(opened);
      setSnapshot(opened.getState());
      setError(null);
      onOpen?.(handle);
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      if (previous) notify(String(cause), 'error');
      else setError(String(cause));
    } finally {
      candidate?.dispose();
      if (candidateHandle && candidate && sequence === requestSequence.current)
        await host.closeWorkspace(candidateHandle);
      previous?.session.unfreeze();
      if (sequence === requestSequence.current) {
        switchingRef.current = false;
        setSwitchingWorkspace(false);
      }
    }
  };

  const disposeActiveWorkspace = () => {
    requestSequence.current++;
    const active = activeWorkspace.current;
    active?.unsubscribe();
    active?.session.dispose();
    canvasRef.current?.dispose();
    activeWorkspace.current = null;
    if (active) void host.closeWorkspace(active.handle);
  };

  useEffect(() => {
    void openWorkspaceRequest(workspace, true);
    return disposeActiveWorkspace;
    // The initial request is read once. Later switches use the same lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  useEffect(() => {
    const flush = () => void session?.flush().catch(() => {});
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    // Desktop quit path: the host awaits this flush before closing;
    // web returns a no-op since its pagehide handler above is the
    // best-effort equivalent for IndexedDB writes.
    const offShutdown =
      host.onShutdown?.(() =>
        session
          ? session.flush().then((saved) => {
              if (!saved) throw new Error('Workspace could not be saved');
            })
          : Promise.resolve(),
      ) ?? (() => {});
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      offShutdown();
    };
  }, [session, host]);

  const tabs = snapshot?.session.tabs ?? [];
  const activeTabId = snapshot?.session.activeTabId ?? null;
  const groups = snapshot ? workspaceTabGroups(snapshot.session) : [];
  const mountedTabs = snapshot ? retainedWorkspaceTabs(snapshot.session) : [];

  const persistNav = useCallback(
    (patch: Partial<WorkspaceSessionSnapshot['session']>) => {
      if (!session) return;
      const current = session.getState().session;
      const next = updateWorkspaceNavigation(current, patch);
      const retained = new Set(
        retainedWorkspaceTabs(next).map((tab) => tab.fileId),
      );
      const removed = retainedWorkspaceTabs(current).filter(
        (tab) => !retained.has(tab.fileId),
      );
      if (next.activeTabId !== current.activeTabId || removed.length) {
        // Commit focused document title drafts before hiding/unmounting panes.
        const focused = document.activeElement;
        if (
          focused instanceof HTMLElement &&
          focused.closest('.workspace-pane')
        )
          focused.blur();
      }
      session.setSessionState(next);
      removed.forEach((tab) =>
        canvasRef.current?.close(rootOccurrenceId(tab.fileId)),
      );
    },
    [session],
  );

  // Remove missing files from every group, including groups currently hidden.
  useEffect(() => {
    if (!session || !snapshot) return;
    const next = pruneWorkspaceTabs(
      snapshot.session,
      (id) => snapshot.files.has(id) || snapshot.documents.has(id),
    );
    if (JSON.stringify(next) !== JSON.stringify(snapshot.session))
      persistNav({ groups: next.groups });
  }, [session, snapshot, persistNav]);

  const revealFileInTree = useCallback(
    (fileId: string) => {
      if (!session) return;
      const state = session.getState();
      const path =
        state.files.get(fileId)?.path ?? state.documents.get(fileId)?.path;
      if (!path) return;
      persistNav({
        expandedDirs: [
          ...new Set([
            ...state.session.expandedDirs,
            ...workspaceFileDirectories(path),
          ]),
        ],
      });
      setFileTreeReveal((current) => ({
        fileId,
        nonce: (current?.nonce ?? 0) + 1,
      }));
    },
    [session, persistNav],
  );

  const openFile = useCallback(
    (fileId: CellId, source?: FrameOpenSource) => {
      if (!session) return;
      rememberEntrySource(sourcesRef.current, fileId, source);
      setSourceRev((value) => value + 1);
      setLibraryOpen(false);
      setPickerFileId(null);
      const state = session.getState();
      const view = state.organization.byFile.get(fileId);
      const ownerId =
        view?.placement.kind === 'owned'
          ? view.placement.ownerFrameId
          : undefined;
      if (ownerId)
        setExpandedOwners((current) =>
          current.includes(ownerId) ? current : [...current, ownerId],
        );
      const path =
        state.files.get(fileId)?.path ?? state.documents.get(fileId)?.path;
      const ownerPath = ownerId ? state.files.get(ownerId)?.path : undefined;
      const expandedDirs = [
        ...new Set([
          ...state.session.expandedDirs,
          ...[path, ownerPath].flatMap((value) =>
            value ? workspaceFileDirectories(value) : [],
          ),
        ]),
      ];
      const current = session.getState().session;
      const exists = current.tabs.some((tab) => tab.fileId === fileId);
      persistNav({
        expandedDirs,
        tabs: exists ? current.tabs : [...current.tabs, { fileId }],
        activeTabId: fileId,
      });
      if (session.getState().files.has(fileId))
        canvasRef.current?.openFile(fileId);
    },
    [session, persistNav],
  );

  const instanceHost = useMemo<FrameInstanceHost>(
    () => ({
      get(query) {
        const canvas = canvasRef.current;
        const occurrence = canvas?.get(
          refOccurrenceId(query.ownerFileId, query.refId, query.appearance),
        );
        if (!occurrence) return null;
        const file = session?.getState().files.get(occurrence.fileId)?.file;
        return {
          occurrenceId: occurrence.id,
          runtime: occurrence.runtime,
          readonly: occurrence.contentReadonly,
          preview: !!file && isRegularCanvas(file),
        };
      },
      acquire(query) {
        const canvas = canvasRef.current;
        if (!canvas) return () => {};
        canvas.openFile(query.ownerFileId);
        const opened = canvas.openRef(
          query.ownerFileId,
          query.refId,
          query.parentOccurrenceId ?? rootOccurrenceId(query.ownerFileId),
          query.appearance,
          { activate: false },
        );
        return opened.occurrence
          ? canvas.retainOccurrence(opened.occurrence.id)
          : () => {};
      },
      release(query) {
        canvasRef.current?.close(
          refOccurrenceId(query.ownerFileId, query.refId, query.appearance),
        );
      },
      async commit(occurrenceId, transaction) {
        const result = await canvasRef.current?.dispatch(
          occurrenceId,
          transaction,
        );
        if (!result)
          return { status: 'rejected', message: 'Canvas is unavailable' };
        return result.ok
          ? { status: 'accepted' }
          : {
              status: 'rejected',
              message: result.diagnostics[0]?.message,
            };
      },
      updateMindOffset(occurrenceId, mindRootId, offset) {
        const occurrence = canvasRef.current?.get(occurrenceId);
        const owner = occurrence?.ownerFileId
          ? session?.getState().files.get(occurrence.ownerFileId)?.file
          : undefined;
        const ref =
          owner && occurrence?.refId
            ? owner.cells[occurrence.refId]
            : undefined;
        if (!ref || !isFrameReferenceCell(ref)) return;
        void canvasRef.current?.updateRefShell(occurrenceId, {
          data: {
            mindOffsets: {
              ...(ref.data.mindOffsets ?? {}),
              [mindRootId]: offset,
            },
          },
        });
      },
    }),
    [session],
  );

  const placeReference = useCallback(
    async (fileId: CellId, point: [number, number]) => {
      if (!session || !placeTarget || placeTarget.fileId !== fileId) return;
      const frames = [...session.getState().files.values()]
        .map((item) => item.file)
        .filter((item) => item.format === 'verd-frame');
      const blocked = placeTarget.kind
        ? null
        : assessReferencePlace(frames, fileId, placeTarget.targetId);
      if (blocked) {
        setPlaceTarget(null);
        notify(blocked);
        return;
      }
      const entry = session.getState().files.get(fileId);
      if (!entry || entry.file.format !== 'verd-frame') return;
      const refId = crypto.randomUUID();
      const document = placeTarget.newDocument
        ? createDocumentFile(crypto.randomUUID())
        : null;
      const targetId = document?.id ?? placeTarget.targetId;
      const cell = (
        placeTarget.kind === 'document-frame'
          ? createDocumentFrameCell
          : placeTarget.kind === 'document'
            ? createDocumentReferenceCell
            : createFrameReferenceCell
      )(refId, targetId, {
        x: point[0],
        y: point[1],
        width: placeTarget.kind ? 480 : 320,
        height: placeTarget.kind ? 400 : 200,
      });
      const result = await session.apply(
        document && isDocumentFrameCell(cell)
          ? {
              type: 'create-document-frame',
              ownerFrameId: fileId,
              document,
              cell,
              label: 'create-document-frame',
            }
          : {
              type: 'file',
              file: {
                ...entry.file,
                frame: {
                  ...entry.file.frame,
                  children: [...entry.file.frame.children, refId],
                },
                cells: { ...entry.file.cells, [refId]: cell },
              },
              label: 'reference-existing',
            },
      );
      setPlaceTarget(null);
      if (!result.ok)
        notify(result.diagnostics.map((item) => item.message).join('; '));
    },
    [session, placeTarget, notify],
  );

  const seenSubgraphs = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    const current = new Map<string, string>();
    snapshot.organization.ownedBy.forEach((ids, owner) =>
      ids.forEach((id) => current.set(id, owner)),
    );
    if (seenSubgraphs.current) {
      const owners: string[] = [];
      snapshot.organization.ownedBy.forEach((ids, owner) => {
        if (ids.some((id) => seenSubgraphs.current?.get(id) !== owner))
          owners.push(owner);
      });
      if (owners.length)
        setExpandedOwners((prev) => [...new Set([...prev, ...owners])]);
    }
    seenSubgraphs.current = current;
  }, [snapshot]);

  const closeTabs = useCallback(
    (fileId: CellId, scope: TabCloseScope = 'self') => {
      if (!session) return;
      const current = session.getState().session;
      const next = closeWorkspaceTabs(current, fileId, scope);
      if (next !== current) persistNav({ groups: next.groups });
    },
    [session, persistNav],
  );

  const reorderTab = useCallback(
    (fileId: CellId, targetFileId: CellId, position: 'before' | 'after') => {
      if (!session) return;
      const current = session.getState().session;
      const tabs = current.tabs.filter((tab) => tab.fileId !== fileId);
      const moved = current.tabs.find((tab) => tab.fileId === fileId);
      if (!moved || fileId === targetFileId) return;
      const at = tabs.findIndex((tab) => tab.fileId === targetFileId);
      if (at < 0) return;
      tabs.splice(position === 'before' ? at : at + 1, 0, moved);
      persistNav({ tabs });
    },
    [session, persistNav],
  );

  const createCanvas = useCallback(
    async (dirPath: string) => {
      if (!session) return;
      const frameId = uuid();
      const file = createFrameFile(createFrameCell(frameId));
      const base = `${file.frame.name || '未命名画布'}.verd.json`;
      const result = await session.apply({
        type: 'create-file',
        file,
        path: dirPath ? `${dirPath}/${base}` : base,
        label: 'create-canvas',
      });
      if (result.ok) openFile(frameId);
    },
    [session, openFile],
  );

  const createDocument = useCallback(
    async (dirPath: string) => {
      if (!session) return;
      const fileId = uuid();
      const file = createDocumentFile(fileId);
      const taken = new Set(session.getState().fileIdByPath.keys());
      const path = documentPathFor(file, dirPath, taken);
      const result = await session.apply({
        type: 'create-file',
        file,
        path,
        label: 'create-document',
      });
      if (result.ok) {
        createdDocumentRef.current = fileId;
        openFile(fileId);
      }
    },
    [session, openFile],
  );

  /**
   * Restore feeds for mounted document editors: each undo/redo (or
   * adopt-disk/external replay) bumps the file's revision so the editor
   * re-applies content and selection instead of treating it as an echo.
   */
  const documentRestoreRef = useRef(
    new Map<CellId, { revision: number; selection?: DocumentSelection }>(),
  );
  /** The document created most recently gets its title focused on open. */
  const createdDocumentRef = useRef<CellId | null>(null);

  const runHistory = useCallback(
    async (direction: 'undo' | 'redo') => {
      if (!session) return;
      const result =
        direction === 'undo' ? await session.undo() : await session.redo();
      if (!result.ok) {
        if (result.diagnostics.length)
          notify(
            `${locale === 'zh' ? (direction === 'undo' ? '撤销失败：' : '重做失败：') : `${direction} failed: `}${result.diagnostics.map((item) => item.message).join('; ')}`,
            'error',
          );
        return;
      }
      const restored = result.restored;
      if (!restored) return;
      const state = session.getState();
      const origin = restored.origin;
      const owner = origin && state.files.get(origin.canvasId)?.file;
      const shell = owner && owner.cells[origin!.cellId];
      if (
        origin &&
        isDocumentFrameCell(shell) &&
        shell.data.targetDocumentId === restored.fileId
      ) {
        const revision =
          (embeddedRestoreRef.current.get(origin.instanceId)?.revision ?? 0) +
          1;
        embeddedRestoreRef.current.set(origin.instanceId, {
          revision,
          selection: restored.selection as DocumentSelection | undefined,
        });
        openFile(origin.canvasId);
        setEmbeddedEditRequest({
          instanceId: origin.instanceId,
          nonce: Date.now(),
        });
        return;
      }
      if (state.documents.has(restored.fileId)) {
        const slot = documentRestoreRef.current.get(restored.fileId) ?? {
          revision: 0,
        };
        documentRestoreRef.current.set(restored.fileId, {
          revision: slot.revision + 1,
          selection: restored.selection as DocumentSelection | undefined,
        });
      }
      // History touching a background file activates it (§5.6); the
      // trashed-tab effect closes tabs whose files an undo deleted.
      if (
        state.session.activeTabId !== restored.fileId &&
        (state.documents.has(restored.fileId) ||
          state.files.has(restored.fileId))
      )
        openFile(restored.fileId);
    },
    [session, openFile, locale, notify],
  );

  /**
   * One chronological history source shared by canvas and document editors
   * (§5.3): both route undo/redo here, the session replays file snapshots.
   */
  const historyAdapter = useMemo(
    () => ({
      undo: () => void runHistory('undo'),
      redo: () => void runHistory('redo'),
      canUndo: () => session?.getState().canUndo ?? false,
      canRedo: () => session?.getState().canRedo ?? false,
      busy: () => session?.getState().saveStatus === 'saving',
    }),
    [session, runHistory],
  );

  const onDocumentChange = useCallback(
    (fileId: CellId) => (change: DocumentEditorChange) => {
      if (!session) return;
      const live = session.getState().documents.get(fileId)?.file;
      if (!live) return;
      void session.apply({
        type: 'file',
        file: { ...live, text: change.value },
        label: 'document-edit',
        history: {
          group: change.historyGroup,
          selectionBefore: change.selectionBefore,
          selectionAfter: change.selectionAfter,
          name: change.source,
        },
      });
    },
    [session],
  );

  const saveStateFor = (entry: WorkspaceFileEntry): DocumentSaveState => {
    if (entry.conflicted) return 'conflicted';
    if (snapshot?.saveStatus === 'error') return 'error';
    if (entry.dirty)
      return snapshot?.saveStatus === 'saving' ? 'saving' : 'unsaved';
    return 'saved';
  };

  const onChange = useCallback(
    (mountedFrameId: CellId) => (change: CellChange) => {
      if (!session) return;
      try {
        const existing = new Map(
          [...session.getState().files.entries()].map(
            ([id, entry]) => [id, entry.file] as const,
          ),
        );
        const mounted = existing.get(mountedFrameId);
        const partitioned = partitionCellStore(change.snapshot.store, {
          existing,
          creationOwnerId:
            mounted && isRegularCanvas(mounted) ? mountedFrameId : undefined,
        });
        const updated = partitioned.files.filter((file) => {
          const previous = existing.get(file.frame.id);
          return !!previous && !sameFrameContent(previous, file);
        });
        const created = partitioned.files.some(
          (file) => !existing.has(file.frame.id),
        );
        if (!updated.length && !created) return;
        if (updated.length <= 1) {
          const sourceId = updated[0]?.frame.id ?? mountedFrameId;
          void session
            .apply({
              type: 'edit-file',
              sourceFileId: sourceId,
              store: change.snapshot.store,
              creationOwnerId:
                existing.get(sourceId) &&
                isRegularCanvas(existing.get(sourceId)!)
                  ? sourceId
                  : mounted && isRegularCanvas(mounted)
                    ? mountedFrameId
                    : undefined,
              label: change.transaction.id,
            })
            .then((result) => {
              if (!result.ok)
                notify(
                  result.diagnostics.map((item) => item.message).join('; '),
                );
            });
          return;
        }
        void session.apply({
          type: 'edit-files',
          edits: updated.map((file) => ({
            sourceFileId: file.frame.id,
            store: {
              rootId: file.frame.id,
              cells: { [file.frame.id]: file.frame, ...file.cells },
            },
          })),
          label: change.transaction.id,
        });
      } catch {
        // The runtime already rejected invalid stores; ignore echoes.
      }
    },
    [session, notify],
  );

  /** Owning file root for a cell: the first frame ancestor in the assembled store. */
  const ownerOfCell = useCallback(
    (id: CellId, fallback: CellId): CellId => {
      const store = session?.getState().store;
      if (!store) return fallback;
      const index = indexCells(store);
      const ascend = (cellId: CellId) =>
        index.parentOf.get(cellId) ?? index.membersOf.get(cellId);
      let owner = ascend(id);
      while (owner && !isFrameCell(store.cells[owner])) owner = ascend(owner);
      return owner ?? fallback;
    },
    [session],
  );

  const onDuplicateReference = useCallback(
    (mountedFrameId: CellId) => (refIds: string[]) => {
      if (!session) return;
      refIds.forEach(
        (refId) =>
          void session.apply({
            type: 'duplicate-reference',
            ownerFrameId: ownerOfCell(refId, mountedFrameId),
            refId,
            label: 'duplicate-reference',
          }),
      );
    },
    [session, ownerOfCell],
  );

  const exportFrame = useCallback(
    (fileId: CellId, format: 'json' | 'markdown' = 'json') => {
      if (!session) return;
      const state = session.getState();
      const docEntry = state.documents.get(fileId);
      if (docEntry) {
        const file = session.exportDocument(fileId);
        if (!file) return;
        const name = file.title || documentDisplayName(docEntry.path);
        if (format === 'markdown') {
          const { markdown, warnings } = serializeTextDocumentToMarkdown(
            file.text,
          );
          if (warnings.length)
            notify(
              (locale === 'zh'
                ? '部分格式无法导出为 Markdown：'
                : 'Some formatting could not be exported to Markdown: ') +
                warnings.map((item) => item.message).join('; '),
            );
          download(
            `${name}.md`,
            new Blob([markdown], { type: 'text/markdown' }),
          );
          return;
        }
        const closure = session.exportWorkspaceFiles(fileId);
        download(
          closure.length > 1 ? `${name}.verd.json` : `${name}.verd-doc.json`,
          new Blob(
            [
              JSON.stringify(
                closure.length > 1
                  ? workspaceExportBundle(closure, fileId)
                  : file,
                null,
                2,
              ),
            ],
            { type: 'application/json' },
          ),
        );
        return;
      }
      const files = session.exportWorkspaceFiles(fileId);
      if (!files.length) return;
      const entry = state.files.get(fileId);
      const name =
        entry?.file.frame.name || canvasDisplayName(entry?.path ?? 'frame');
      download(
        `${name}.verd.json`,
        new Blob(
          [JSON.stringify(workspaceExportBundle(files, fileId), null, 2)],
          {
            type: 'application/json',
          },
        ),
      );
    },
    [session, locale, notify],
  );

  const importDocument = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !session) return;
      try {
        const definition = await file.text();
        let imported: (FrameFileV2 | DocumentFileV1)[] | null = null;
        if (/\.(md|markdown)$/i.test(file.name)) {
          // Markdown imports become new standalone documents.
          const id = uuid();
          const { document: text, warnings } = parseMarkdownToTextDocument(
            definition,
            { id },
          );
          imported = [
            {
              format: 'verd-document',
              version: 1,
              id,
              title: file.name.replace(/\.(md|markdown)$/i, ''),
              text,
            },
          ];
          if (warnings.length)
            notify(
              (locale === 'zh'
                ? '部分 Markdown 结构已降级：'
                : 'Some Markdown structures were degraded: ') +
                warnings.map((item) => item.message).join('; '),
            );
        } else {
          try {
            const parsed: unknown = JSON.parse(definition);
            // A standalone document file imports as itself; anything else
            // falls through to the canvas bundle / legacy readers.
            if (isDocumentFileV1(parsed)) imported = [parsed];
            else imported = parseWorkspaceExport(parsed);
          } catch {
            imported = null;
          }
        }
        if (!imported && parseLegacy) {
          const snapshot = await parseLegacy(definition, file.name);
          imported = partitionCellStore(snapshot.store).files;
        }
        if (!imported?.length) throw new Error('Unsupported or empty document');
        const result = await session.apply({
          type: 'import-files',
          files: imported,
          label: 'import',
        });
        if (!result.ok)
          notify(
            `${locale === 'zh' ? '导入失败：' : 'Import failed: '}${result.diagnostics.map((item) => item.message).join('; ')}`,
            'error',
          );
      } catch (cause) {
        notify(
          `${locale === 'zh' ? '导入失败：' : 'Import failed: '}${cause instanceof Error ? cause.message : String(cause)}`,
          'error',
        );
      }
    },
    [session, parseLegacy, locale, notify],
  );

  if (error)
    return (
      <div className="workspace-error" role="alert">
        <div className="workspace-error-card">
          <TriangleAlert size={32} aria-hidden />
          <h1>
            {locale === 'zh' ? '无法打开工作区' : 'Unable to open workspace'}
          </h1>
          <p>{error}</p>
          <button
            className="workspace-button-primary"
            type="button"
            onClick={() => window.location.reload()}
          >
            {locale === 'zh' ? '重新加载' : 'Reload'}
          </button>
          {allowWorkspaceSwitching && (
            <>
              <button
                type="button"
                disabled={switchingWorkspace}
                onClick={() => void openWorkspaceRequest({ pick: true })}
              >
                {locale === 'zh' ? '打开工作区文件夹' : 'Open workspace folder'}
              </button>
              <button
                type="button"
                disabled={switchingWorkspace}
                onClick={() => void openWorkspaceRequest({ default: true })}
              >
                {locale === 'zh' ? '回到内置工作区' : 'Open built-in workspace'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  if (!session || !snapshot)
    return (
      <div className="workspace-loading">
        <LoaderCircle size={24} aria-hidden />
        <span>
          {locale === 'zh' ? '正在打开工作区…' : 'Opening workspace…'}
        </span>
      </div>
    );

  const files = snapshot.files;
  const documents = snapshot.documents;
  const openPreview = (fileId: string, anchor: string | null = null) => {
    if (!files.has(fileId) && !documents.has(fileId)) {
      notify('引用的文件不存在', 'error');
      return;
    }
    openFile(fileId);
    if (documents.has(fileId))
      setDocumentNavigation((previous) => ({
        fileId,
        anchor,
        requestId: (previous?.requestId ?? 0) + 1,
      }));
  };
  const openPreviewLink = (href: string, sourceId: string) => {
    const link = parseDocumentLink(href, sourceId);
    if (link?.kind === 'external') {
      window.open(link.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (link?.kind === 'file') openPreview(link.fileId, link.anchor);
    else notify('链接地址不受支持', 'error');
  };
  const previewOptions = (fileId: string): PreviewOptions => ({
    snapshot,
    locale,
    open: openPreview,
    openLink: openPreviewLink,
    scroll: referenceScrollRef.current,
    path: [fileId],
    instance: fileId,
    active: activeTabId === fileId,
    history: historyAdapter,
    restore: embeddedRestoreRef.current,
    editRequest: embeddedEditRequest,
    edit: (id, change, origin) => {
      const file = session.getState().documents.get(id)?.file;
      if (!file) return;
      void session.apply({
        type: 'file',
        file: { ...file, text: change.value },
        label: 'document-edit',
        history: {
          group: change.historyGroup,
          selectionBefore: change.selectionBefore,
          selectionAfter: change.selectionAfter,
          name: change.source,
          origin,
        },
      });
    },
    rename: (id, title) => {
      void session.apply({ type: 'rename-document', fileId: id, title });
    },
  });
  const canvases = [...files.values()].map((entry) => ({
    frameId: entry.file.frame.id,
    path: entry.path,
    name: entry.file.frame.name || canvasDisplayName(entry.path),
    dirty: entry.dirty,
    conflicted: entry.conflicted,
    diagram: diagramKindOf(entry.file),
  }));
  const docs = [...documents.values()].map((entry) => ({
    fileId: entry.file.id,
    path: entry.path,
    name: entry.file.title || documentDisplayName(entry.path),
    dirty: entry.dirty,
    conflicted: entry.conflicted,
  }));
  const entryForTab = (fileId: CellId) =>
    files.get(fileId) ?? documents.get(fileId);
  const activeTab = tabs.find((tab) => tab.fileId === activeTabId);
  const activeEntry = activeTab ? entryForTab(activeTab.fileId) : undefined;

  const defaultName = isDefaultWorkspace
    ? locale === 'zh'
      ? '我的工作区'
      : 'My workspace'
    : handleName;
  const workspaceName =
    typeof snapshot.config.value['name'] === 'string' &&
    snapshot.config.value['name'].trim()
      ? snapshot.config.value['name'].trim()
      : defaultName;
  return (
    <div
      className="workspace-shell"
      inert={switchingWorkspace}
      aria-busy={switchingWorkspace}
    >
      {documentPickerFileId && !readonly && (
        <div
          role="dialog"
          aria-label={locale === 'zh' ? '引用文档' : 'Reference document'}
          className="workspace-document-picker"
          style={{
            position: 'fixed',
            inset: '15% 20%',
            zIndex: 100,
            background: 'white',
            border: '1px solid #cbd5e1',
            borderRadius: 12,
            padding: 20,
            overflow: 'auto',
            boxShadow: '0 20px 80px #0003',
          }}
        >
          <h2>
            {documentPickerEditable
              ? '文档 Frame'
              : locale === 'zh'
                ? '引用文档（只读）'
                : 'Reference document (read-only)'}
          </h2>
          <button type="button" onClick={() => setDocumentPickerFileId(null)}>
            {locale === 'zh' ? '取消' : 'Cancel'}
          </button>
          {documentPickerEditable && (
            <button
              type="button"
              onClick={() => {
                setPlaceTarget({
                  fileId: documentPickerFileId,
                  targetId: '',
                  kind: 'document-frame',
                  newDocument: true,
                });
                setDocumentPickerFileId(null);
              }}
            >
              新建文档
            </button>
          )}
          {docs.map((doc) => (
            <button
              type="button"
              key={doc.fileId}
              style={{
                display: 'block',
                padding: 12,
                width: '100%',
                textAlign: 'left',
              }}
              onClick={() => {
                setPlaceTarget({
                  fileId: documentPickerFileId,
                  targetId: doc.fileId,
                  kind: documentPickerEditable ? 'document-frame' : 'document',
                });
                setDocumentPickerFileId(null);
              }}
            >
              {doc.name} <small>{doc.path}</small>
            </button>
          ))}
          {!docs.length && (
            <p>
              {locale === 'zh'
                ? '工作区中没有文档'
                : 'No documents in this workspace'}
            </p>
          )}
        </div>
      )}
      <aside className="workspace-sidebar">
        <WorkspaceMenu
          name={workspaceName}
          locale={locale}
          switching={switchingWorkspace}
          isDefault={isDefaultWorkspace}
          triggerRef={settingsButtonRef}
          onSettings={() => setSettingsView('workspace')}
          onOpenFolder={
            allowWorkspaceSwitching && !readonly
              ? () => {
                  void openWorkspaceRequest({ pick: true }).finally(() =>
                    setMenuFocusRequest((current) => current + 1),
                  );
                }
              : undefined
          }
          onOpenBuiltin={
            allowWorkspaceSwitching && !readonly
              ? () => {
                  void openWorkspaceRequest({ default: true }).finally(() =>
                    setMenuFocusRequest((current) => current + 1),
                  );
                }
              : undefined
          }
        />
        <FileTree
          entries={snapshot.entries}
          canvases={canvases}
          documents={docs}
          activeFileId={libraryOpen ? null : (activeTab?.fileId ?? null)}
          libraryActive={libraryOpen}
          expandedDirs={snapshot.session.expandedDirs}
          locale={locale}
          onOpenFile={openFile}
          subgraphs={[...files.values()]
            .filter((entry) => diagramKindOf(entry.file) !== 'canvas')
            .map((entry) => {
              const view = snapshot.organization.byFile.get(
                entry.file.frame.id,
              );
              const placement = view?.placement;
              const ownerId =
                placement?.kind === 'owned'
                  ? placement.ownerFrameId
                  : undefined;
              return {
                frameId: entry.file.frame.id,
                name: entry.file.frame.name || canvasDisplayName(entry.path),
                path: entry.path,
                diagram: diagramKindOf(entry.file) as
                  | 'mind'
                  | 'workflow'
                  | 'architecture'
                  | 'uml-class'
                  | 'uml-sequence',
                placement:
                  placement?.kind === 'owned'
                    ? ('owned' as const)
                    : placement?.kind === 'unorganized'
                      ? ('unorganized' as const)
                      : placement?.kind === 'standalone'
                        ? ('standalone' as const)
                        : ('legacy' as const),
                ownerFrameId: ownerId,
                dirty: entry.dirty,
                conflicted: entry.conflicted,
              };
            })}
          expandedOwners={expandedOwners}
          onToggleOwner={(frameId) =>
            setExpandedOwners((current) =>
              current.includes(frameId)
                ? current.filter((id) => id !== frameId)
                : [...current, frameId],
            )
          }
          onOpenLibrary={() => {
            setPickerFileId(null);
            setLibraryOpen(true);
          }}
          revealFile={fileTreeReveal}
          onRevealFile={revealFileInTree}
          onToggleDir={(path) => {
            const dirs = snapshot.session.expandedDirs;
            persistNav({
              expandedDirs: dirs.includes(path)
                ? dirs.filter((dir) => dir !== path)
                : [...dirs, path],
            });
          }}
          onCreateCanvas={createCanvas}
          onCreateDocument={createDocument}
          onCreateFolder={(dirPath, name) => {
            const trimmed = name.trim();
            if (trimmed)
              session.mkdir(dirPath ? `${dirPath}/${trimmed}` : trimmed);
          }}
          onTrash={(frameId) =>
            void session.apply({ type: 'trash-file', frameId })
          }
          onTrashDirectory={async (path) => {
            const result = await session.apply({
              type: 'trash-directory',
              path,
            });
            if (!result.ok)
              throw new Error(
                result.diagnostics.map((item) => item.message).join('; '),
              );
          }}
          onMove={(frameId, toPath) =>
            void session.apply({ type: 'move-file', frameId, toPath })
          }
          onDuplicate={(frameId) =>
            void session.apply({ type: 'duplicate-file', frameId })
          }
          onExport={exportFrame}
          onImport={() => importInput.current?.click()}
          readonly={readonly || switchingWorkspace}
        />
        <div className="workspace-sidebar-footer">
          <button
            type="button"
            data-testid="workspace-my"
            onClick={() => openMy()}
          >
            <UserRound size={16} aria-hidden />{' '}
            {locale === 'zh' ? '我的' : 'My'}
          </button>
        </div>
      </aside>
      <main className="workspace-main">
        <WorkspaceTabs
          tabs={tabs.map((tab) => {
            const entry = entryForTab(tab.fileId);
            if (!entry) return { id: tab.fileId, title: tab.fileId };
            const file = entry.file;
            return {
              id: tab.fileId,
              title:
                file.format === 'verd-document'
                  ? file.title || documentDisplayName(entry.path)
                  : file.frame.name || canvasDisplayName(entry.path),
            };
          })}
          activeTabId={libraryOpen ? null : activeTabId}
          locale={locale}
          onActivate={(frameId) => {
            setLibraryOpen(false);
            setPickerFileId(null);
            persistNav({ activeTabId: frameId });
          }}
          groups={groups.map((group) => ({
            id: group.id,
            name: group.name || (locale === 'zh' ? '默认分组' : 'Default'),
          }))}
          activeGroupId={snapshot.session.activeGroupId ?? groups[0]?.id}
          onSwitchGroup={(groupId) => {
            setLibraryOpen(false);
            setPickerFileId(null);
            persistNav({ activeGroupId: groupId });
          }}
          onCreateGroup={(name) => {
            const group = { id: uuid(), name, tabs: [], activeTabId: null };
            setLibraryOpen(false);
            setPickerFileId(null);
            persistNav({
              groups: [
                ...workspaceTabGroups(session.getState().session),
                group,
              ],
              activeGroupId: group.id,
            });
          }}
          onRenameGroup={(groupId, name) =>
            persistNav({
              groups: workspaceTabGroups(session.getState().session).map(
                (group) => (group.id === groupId ? { ...group, name } : group),
              ),
            })
          }
          onDeleteGroup={(groupId) => {
            const next = deleteWorkspaceTabGroup(
              session.getState().session,
              groupId,
            );
            setLibraryOpen(false);
            setPickerFileId(null);
            persistNav({
              groups: next.groups,
              activeGroupId: next.activeGroupId,
            });
          }}
          onClose={closeTabs}
          onCloseMany={closeTabs}
          onAdd={readonly ? undefined : () => void createCanvas('')}
          onReorder={reorderTab}
        />
        <div
          className="workspace-content"
          key={activeWorkspace.current?.handle.key}
        >
          {libraryOpen ? (
            <ChartLibrary
              locale={locale}
              readonly={
                readonly || switchingWorkspace || snapshot.mutationsPaused
              }
              owners={[...files.values()]
                .filter((entry) => isRegularCanvas(entry.file))
                .map((entry) => ({
                  frameId: entry.file.frame.id,
                  name: entry.file.frame.name || canvasDisplayName(entry.path),
                }))}
              rows={[...files.values()].map((entry) => {
                const view = snapshot.organization.byFile.get(
                  entry.file.frame.id,
                );
                const placement = view?.placement;
                const ownerId =
                  placement?.kind === 'owned'
                    ? placement.ownerFrameId
                    : undefined;
                const sources = referenceSourcesOf(
                  [...files.values()].map((item) => item.file),
                  entry.file.frame.id,
                );
                return {
                  frameId: entry.file.frame.id,
                  name: entry.file.frame.name || canvasDisplayName(entry.path),
                  path: entry.path,
                  diagram: diagramKindOf(entry.file),
                  placement:
                    placement?.kind === 'owned'
                      ? ('owned' as const)
                      : placement?.kind === 'unorganized'
                        ? ('unorganized' as const)
                        : placement?.kind === 'standalone'
                          ? ('standalone' as const)
                          : ('legacy' as const),
                  ownerFrameId: ownerId,
                  ownerName: ownerId
                    ? files.get(ownerId)?.file.frame.name ||
                      canvasDisplayName(files.get(ownerId)?.path ?? ownerId)
                    : undefined,
                  referenceLabel:
                    locale === 'zh'
                      ? `${sources.reduce((sum, group) => sum + group.refIds.length, 0)} 处引用 · ${sources.length} 个画布`
                      : `${sources.reduce((sum, group) => sum + group.refIds.length, 0)} references · ${sources.length} canvases`,
                  dirty: entry.dirty,
                  conflicted: entry.conflicted,
                };
              })}
              query={libraryQuery}
              diagram={libraryDiagram}
              owner={libraryOwner}
              scrollTop={libraryScroll}
              onQueryChange={setLibraryQuery}
              onDiagramChange={setLibraryDiagram}
              onOwnerChange={setLibraryOwner}
              onScroll={setLibraryScroll}
              picker={pickerFileId ? pickerMode : null}
              onPickerMode={setPickerMode}
              onPick={(targetId) => {
                if (!pickerFileId) return;
                setPlaceTarget({ fileId: pickerFileId, targetId });
                setPickerFileId(null);
                setLibraryOpen(false);
              }}
              onChangeOrganization={async (fileId, organization) => {
                const result = await session.apply({
                  type: 'set-organization',
                  fileId,
                  organization,
                });
                if (!result.ok)
                  throw new Error(
                    result.diagnostics.map((item) => item.message).join('; '),
                  );
              }}
              onOpen={openFile}
              onBack={() => {
                setPickerFileId(null);
                setLibraryOpen(false);
              }}
              onOrganize={() => {
                const frames = [...files.values()].map((entry) => entry.file);
                const recommended = recommendOrganization(frames);
                setOrganizeRows(
                  recommended.map((row) => {
                    const file = files.get(row.fileId)!;
                    const sources = referenceSourcesOf(frames, row.fileId);
                    const ownerId =
                      row.organization.kind === 'subgraph'
                        ? row.organization.ownerFrameId
                        : undefined;
                    return {
                      fileId: row.fileId,
                      name:
                        file.file.frame.name || canvasDisplayName(file.path),
                      path: file.path,
                      diagram: diagramKindOf(file.file),
                      sources: sources
                        .map(
                          (source) =>
                            files.get(source.fileId)?.file.frame.name ||
                            canvasDisplayName(
                              files.get(source.fileId)?.path ?? source.fileId,
                            ),
                        )
                        .join(', '),
                      recommendedOwnerName: ownerId
                        ? files.get(ownerId)?.file.frame.name ||
                          canvasDisplayName(files.get(ownerId)?.path ?? ownerId)
                        : locale === 'zh'
                          ? '独立'
                          : 'Standalone',
                      reason: row.reason,
                      choice: ownerId ? 'owner' : 'standalone',
                      ownerFrameId: ownerId,
                      basisSources: sources.map((source) => source.fileId),
                    };
                  }),
                );
              }}
            />
          ) : null}
          <div className="workspace-panes" hidden={libraryOpen}>
            {tabs.length === 0 ? (
              <WorkspaceEmpty
                locale={locale}
                onCreate={() => void createCanvas('')}
                onCreateDocument={() => void createDocument('')}
              />
            ) : null}
            {mountedTabs.map((tab) => {
              const entry = entryForTab(tab.fileId);
              if (!entry) return null;
              if (entry.file.format === 'verd-document') {
                const restore = documentRestoreRef.current.get(tab.fileId);
                return (
                  <div
                    key={tab.fileId}
                    className={`workspace-pane${tab.fileId === activeTabId ? ' is-active' : ''}`}
                  >
                    <div className="workspace-pane-body">
                      <DocumentPage
                        frameChoices={[...files.values()].map((item) => ({
                          frameId: item.file.frame.id,
                          title: item.file.frame.name || item.file.frame.id,
                          path: item.path,
                        }))}
                        renderFrameReference={({
                          targetFrameId,
                          instanceId,
                        }) => (
                          <WorkspaceCanvasReference
                            targetFrameId={targetFrameId}
                            options={{
                              ...previewOptions(tab.fileId),
                              instance: JSON.stringify([
                                tab.fileId,
                                'block',
                                instanceId,
                              ]),
                            }}
                          />
                        )}
                        value={entry.file.text}
                        title={
                          entry.file.title || documentDisplayName(entry.path)
                        }
                        readonly={
                          readonly ||
                          switchingWorkspace ||
                          snapshot.mutationsPaused
                        }
                        locale={locale}
                        saveState={saveStateFor(entry)}
                        history={historyAdapter}
                        restore={
                          restore
                            ? {
                                revision: restore.revision,
                                selection: restore.selection,
                              }
                            : undefined
                        }
                        autoFocusTitle={
                          createdDocumentRef.current === tab.fileId
                        }
                        onChange={onDocumentChange(tab.fileId)}
                        navigation={
                          tab.fileId === activeTabId &&
                          documentNavigation?.fileId === tab.fileId
                            ? documentNavigation
                            : undefined
                        }
                        onOpenLink={(href) => {
                          const link = parseDocumentLink(href, tab.fileId);
                          if (link?.kind === 'external') {
                            window.open(
                              link.url,
                              '_blank',
                              'noopener,noreferrer',
                            );
                            return;
                          }
                          if (
                            !link ||
                            (!session.getState().files.has(link.fileId) &&
                              !session.getState().documents.has(link.fileId))
                          ) {
                            notify(
                              locale === 'zh'
                                ? '链接指向的文件不存在或地址不受支持。'
                                : 'The linked file is missing or its address is unsupported.',
                              'error',
                            );
                            return;
                          }
                          openFile(link.fileId);
                          setDocumentNavigation((previous) => ({
                            fileId: link.fileId,
                            anchor: link.anchor,
                            requestId: (previous?.requestId ?? 0) + 1,
                          }));
                        }}
                        onTitleCommit={(title) =>
                          void session.apply({
                            type: 'rename-document',
                            fileId: tab.fileId,
                            title,
                            label: 'rename-document',
                          })
                        }
                        onExport={(format) => exportFrame(tab.fileId, format)}
                      />
                    </div>
                  </div>
                );
              }
              const scene = frameScene(canvasValue(snapshot).store, tab.fileId);
              const pane =
                scene === 'mind-root'
                  ? 'mind'
                  : scene === 'workflow-start'
                    ? 'workflow'
                    : scene === 'architecture-layer'
                      ? 'architecture'
                      : 'board';
              return (
                <div
                  key={tab.fileId}
                  data-workspace-pane={
                    tab.fileId === activeTabId ? pane : undefined
                  }
                  className={`workspace-pane${tab.fileId === activeTabId ? ' is-active' : ''}`}
                >
                  <FrameBreadcrumb
                    fileId={tab.fileId}
                    files={files}
                    organization={snapshot.organization}
                    source={sourcesRef.current.get(tab.fileId)}
                    sourceRev={sourceRev}
                    locale={locale}
                    onOpen={openFile}
                    onReturn={(source) => {
                      const owner = files.get(source.sourceFileId)?.file;
                      const shell = owner?.cells[source.refId];
                      const plan = planReturnToSource(
                        source,
                        files.has(source.sourceFileId),
                        !!shell && isFrameReferenceCell(shell),
                      );
                      if (plan.type === 'drop') {
                        rememberEntrySource(sourcesRef.current, tab.fileId);
                        setSourceRev((value) => value + 1);
                        return;
                      }
                      openFile(source.sourceFileId);
                      if (plan.type === 'missing-shell')
                        notify(
                          locale === 'zh'
                            ? '引用已被移除'
                            : 'The reference was removed',
                        );
                      else
                        setReveal({
                          fileId: plan.fileId,
                          cellId: plan.cellId,
                          nonce: Date.now(),
                        });
                    }}
                  />
                  <div className="workspace-pane-body">
                    <VerdFrame
                      onOpenMy={() => {
                        openMy();
                        myFocus.current = document.querySelector<HTMLElement>(
                          '.workspace-pane.is-active [data-testid="app-menu-trigger"]',
                        );
                      }}
                      value={canvasValue(snapshot)}
                      documentReferences={workspaceDocumentPreviews(
                        previewOptions(tab.fileId),
                      )}
                      onReferenceDocument={() => {
                        setDocumentPickerEditable(false);
                        setDocumentPickerFileId(tab.fileId);
                      }}
                      onCreateDocumentFrame={() => {
                        setDocumentPickerEditable(true);
                        setDocumentPickerFileId(tab.fileId);
                      }}
                      onExportNative={
                        session
                          .exportWorkspaceFiles(tab.fileId)
                          .some((file) => file.format === 'verd-document')
                          ? () => exportFrame(tab.fileId)
                          : undefined
                      }
                      frameId={tab.fileId}
                      onChange={onChange(tab.fileId)}
                      onOpenFrame={openFile}
                      onDuplicateReference={onDuplicateReference(tab.fileId)}
                      instanceHost={instanceHost}
                      suspended={
                        libraryOpen ||
                        snapshot.mutationsPaused ||
                        settingsView !== null ||
                        tab.fileId !== activeTabId
                      }
                      placing={placeTarget?.fileId === tab.fileId}
                      onPlace={(point) => placeReference(tab.fileId, point)}
                      onCancelPlace={() => setPlaceTarget(null)}
                      onReferenceExisting={() => {
                        setPickerFileId(tab.fileId);
                        setLibraryOpen(true);
                      }}
                      revealCellId={
                        reveal?.fileId === tab.fileId ? reveal.cellId : null
                      }
                      revealNonce={reveal?.nonce}
                      mindDefaultWidth={
                        typeof snapshot.config.value['mindDefaultWidth'] ===
                        'number'
                          ? (snapshot.config.value[
                              'mindDefaultWidth'
                            ] as number)
                          : undefined
                      }
                      saveStatus={
                        snapshot.dirty &&
                        snapshot.saveStatus !== 'saving' &&
                        snapshot.saveStatus !== 'error'
                          ? 'idle'
                          : ((snapshot.saveStatus as SaveStatus) ?? 'idle')
                      }
                      lastSavedAt={lastSavedAt}
                      readonly={
                        readonly ||
                        switchingWorkspace ||
                        snapshot.mutationsPaused
                      }
                      history={historyAdapter}
                      parseLegacy={parseLegacy}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {organizeRows ? (
            <OrganizePreview
              locale={locale}
              owners={[...files.values()]
                .filter((entry) => isRegularCanvas(entry.file))
                .map((entry) => ({
                  frameId: entry.file.frame.id,
                  name: entry.file.frame.name || canvasDisplayName(entry.path),
                }))}
              rows={organizeRows}
              onCancel={() => setOrganizeRows(null)}
              onChange={(fileId, choice, ownerFrameId) =>
                setOrganizeRows(
                  (current) =>
                    current?.map((row) =>
                      row.fileId === fileId
                        ? { ...row, choice, ownerFrameId }
                        : row,
                    ) ?? null,
                )
              }
              onConfirm={() => {
                const frames = [...files.values()].map((entry) => entry.file);
                const stale = (organizeRows ?? []).filter((row) => {
                  const file = files.get(row.fileId)?.file;
                  const sources = referenceSourcesOf(frames, row.fileId).map(
                    (source) => source.fileId,
                  );
                  return organizePreviewIsStale(
                    row.basisSources ?? [],
                    sources,
                    !!file?.organization,
                  );
                });
                if (stale.length) {
                  const refreshed = recommendOrganization(frames);
                  setOrganizeRows(
                    (current) =>
                      current?.map((row) => {
                        if (!stale.some((item) => item.fileId === row.fileId))
                          return row;
                        const next = refreshed.find(
                          (item) => item.fileId === row.fileId,
                        );
                        if (!next) return row;
                        const ownerId =
                          next.organization.kind === 'subgraph'
                            ? next.organization.ownerFrameId
                            : undefined;
                        return {
                          ...row,
                          reason: next.reason,
                          choice: ownerId ? 'owner' : 'standalone',
                          ownerFrameId: ownerId,
                          basisSources: referenceSourcesOf(
                            frames,
                            row.fileId,
                          ).map((source) => source.fileId),
                          recommendedOwnerName: ownerId
                            ? files.get(ownerId)?.file.frame.name ||
                              canvasDisplayName(
                                files.get(ownerId)?.path ?? ownerId,
                              )
                            : row.recommendedOwnerName,
                        };
                      }) ?? null,
                  );
                  notify(
                    locale === 'zh'
                      ? '部分图表已变化，请确认更新后的建议'
                      : 'Some charts changed. Review the refreshed rows.',
                  );
                  return;
                }
                void session
                  .organize(
                    organizeRows.map((row) => ({
                      fileId: row.fileId,
                      organization:
                        row.choice === 'owner' && row.ownerFrameId
                          ? {
                              kind: 'subgraph' as const,
                              ownerFrameId: row.ownerFrameId,
                            }
                          : row.choice === 'unorganized'
                            ? { kind: 'subgraph' as const }
                            : { kind: 'standalone' as const },
                      basisOrganization: null,
                      basisSources: referenceSourcesOf(frames, row.fileId).map(
                        (source) => source.fileId,
                      ),
                    })),
                  )
                  .then((result) => {
                    if (!result.ok)
                      notify(
                        result.diagnostics
                          .map((item) => item.message)
                          .join('; '),
                      );
                    else setOrganizeRows(null);
                  });
              }}
            />
          ) : null}
          <div className="workspace-banners">
            {snapshot.trashUnconfirmed && (
              <div className="workspace-notice-banner is-error" role="alert">
                <span>
                  {locale === 'zh'
                    ? '回收站操作结果尚未确认，请重试后继续编辑。'
                    : 'The trash operation is unconfirmed. Retry before continuing to edit.'}
                </span>
                <button
                  type="button"
                  data-testid="workspace-trash-retry"
                  onClick={async () => {
                    const result = await session.retryTrashOperation();
                    if (!result.ok)
                      notify(
                        result.diagnostics
                          .map((item) => item.message)
                          .join('; '),
                        'error',
                      );
                  }}
                >
                  {locale === 'zh' ? '重试' : 'Retry'}
                </button>
              </div>
            )}

            {notice ? (
              <div
                className={`workspace-notice-banner${notice.tone === 'error' ? ' is-error' : ''}`}
                role={notice.tone === 'error' ? 'alert' : 'status'}
              >
                <span>{notice.text}</span>
                <button type="button" onClick={() => setNotice(null)}>
                  {locale === 'zh' ? '知道了' : 'Dismiss'}
                </button>
              </div>
            ) : null}
            {activeEntry?.conflicted ? (
              <div
                className="workspace-conflict-banner"
                data-file={activeEntry.path}
              >
                <span>
                  {locale === 'zh'
                    ? '该文件与磁盘版本存在冲突，等待解决。'
                    : 'This file conflicts with the on-disk version.'}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    activeTab &&
                    void session.resolveConflict(activeTab.fileId, 'keep-local')
                  }
                >
                  {locale === 'zh' ? '保留本地' : 'Keep local'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    activeTab &&
                    void session.resolveConflict(activeTab.fileId, 'load-disk')
                  }
                >
                  {locale === 'zh' ? '采用磁盘' : 'Load disk'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </main>
      {settingsView === 'workspace' ? (
        <WorkspaceSettings
          trash={{
            entries: snapshot.trash,
            workspaceName,
            readonly: readonly || switchingWorkspace,
            unconfirmed: snapshot.trashUnconfirmed,
            onRestore: async (entryId) => {
              const result = await session.apply({
                type: 'restore-file',
                entryId,
              });
              if (!result.ok)
                throw new Error(
                  result.diagnostics.map((item) => item.message).join('; '),
                );
            },
            onPurge: async (entryIds) => {
              const result = await session.apply({
                type: 'purge-trash',
                entryIds,
              });
              if (!result.ok)
                throw new Error(
                  result.diagnostics.map((item) => item.message).join('; '),
                );
            },
            onRetry: async () => {
              const result = await session.retryTrashOperation();
              if (!result.ok)
                throw new Error(
                  result.diagnostics.map((item) => item.message).join('; '),
                );
            },
          }}
          locale={locale}
          defaultName={defaultName}
          config={{
            name:
              typeof snapshot.config.value['name'] === 'string'
                ? snapshot.config.value['name']
                : undefined,
            mindDefaultWidth:
              typeof snapshot.config.value['mindDefaultWidth'] === 'number'
                ? snapshot.config.value['mindDefaultWidth']
                : undefined,
          }}
          onConfig={(patch) =>
            session.setWorkspaceConfig({ ...snapshot.config.value, ...patch })
          }
          onBack={closeSettings}
        />
      ) : null}
      {settingsView === 'my' ? (
        <MyPage
          onBack={closeMy}
          backLabel={locale === 'zh' ? '返回工作区' : 'Back to workspace'}
        />
      ) : null}
      <input
        ref={importInput}
        type="file"
        accept=".json,.verd.json,.verd-doc.json,.md,.markdown"
        hidden
        onChange={(event) => void importDocument(event)}
      />
    </div>
  );
}

export function FrameBreadcrumb({
  fileId,
  files,
  organization,
  source,
  locale,
  onOpen,
  onReturn,
}: {
  fileId: string;
  files: WorkspaceSessionSnapshot['files'];
  organization: WorkspaceSessionSnapshot['organization'];
  source?: FrameOpenSource;
  sourceRev: number;
  locale: 'zh' | 'en';
  onOpen(fileId: string): void;
  onReturn(source: FrameOpenSource): void;
}) {
  const view = organization.byFile.get(fileId);
  const entry = files.get(fileId);
  if (!entry || view?.placement.kind !== 'owned') return null;
  const owner = files.get(view.placement.ownerFrameId);
  const fileLabel = (item: {
    file: { frame: { name?: string } };
    path: string;
  }) => item.file.frame.name || canvasDisplayName(item.path);
  const ownerName = owner ? fileLabel(owner) : view.placement.ownerFrameId;
  const sourceEntry = source ? files.get(source.sourceFileId) : undefined;
  const sources = referenceSourcesOf(
    [...files.values()].map((item) => item.file),
    fileId,
  );
  return (
    <div className="workspace-breadcrumb" data-source-rev>
      <button
        type="button"
        onClick={() => owner && onOpen(owner.file.frame.id)}
      >
        {ownerName}
      </button>
      <ChevronRight size={14} aria-hidden />
      <span className="workspace-breadcrumb-current">{fileLabel(entry)}</span>
      {source && sourceEntry ? (
        <button
          type="button"
          className="workspace-breadcrumb-return"
          onClick={() => onReturn(source)}
        >
          {locale === 'zh' ? '返回' : 'Back to'} {fileLabel(sourceEntry)}
        </button>
      ) : null}
      {sources.length ? (
        <div className="workspace-reference-locations">
          {sources.map((group) => {
            const located = files.get(group.fileId);
            return (
              <div key={group.fileId}>
                <span>{located ? fileLabel(located) : group.fileId}</span>
                {group.refIds.map((refId) => (
                  <button
                    key={refId}
                    type="button"
                    onClick={() =>
                      onReturn({
                        sourceFileId: group.fileId,
                        refId,
                        occurrenceId: `${group.fileId}/${refId}`,
                      })
                    }
                  >
                    {locale === 'zh' ? '定位' : 'Locate'}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
