import {
  FrameAutoCalculationProvider,
  createFrameAutoCalculationSession,
} from '@sue/verd-board-ui';
import {
  WorkspaceContentBoundary,
  WorkspaceFileError,
} from './workspace-content-boundary';
import { WorkspaceDocumentPage } from './workspace-document-page';
import {
  createNavigationFeedback,
  navigationPaintOpportunity,
  withNavigationFeedback,
  REPLACEABLE_NAVIGATION_ACTIONS,
  type NavigationIntent,
} from './workspace-navigation-feedback';
import { WorkspaceNavigationProgress } from './workspace-navigation-progress';
import { WorkspacePaneEntrance } from './workspace-pane-entrance';
import { createPageFilePersistence } from './documents/page-file-persistence';
import {
  ActionScope,
  useActionSource,
  type ActionScopeValue,
} from '@sue/board-react-actions';
import {
  createWorkspaceActionRegistry,
  type WorkspaceActionContext,
  workspaceActionCommandResult,
} from './session/workspace-actions';
import {
  createWorkspaceSurfaceActions,
  workspaceActionArgument,
} from './session/workspace-surface-actions';
import type { WorkspaceCommand } from './session/workspace-session';
import {
  actionLabel,
  createWorkspaceLink,
  parseWorkspaceLink,
  parseExternalLink,
  type WorkspaceTarget,
  type ActionResult,
} from '@sue/board-common';
import type { FrameCanvasController } from '@sue/verd-board-ui';
import type { DocumentEditorController } from '@sue/verd-board-ui';
import {
  resolveWorkspaceTarget,
  type NavigationOrigin,
  type WorkspaceNavigationRequest,
} from './session/target-navigation';
import { createArchitecturePlugin } from '@sue/board-architecture';
import type { FrameSnapshot } from '@sue/board-core';
import {
  createCellRegistry,
  createDocumentFrameCell,
  createDocumentReferenceCell,
  createFrameCell,
  createFrameReferenceCell,
  frameScene,
  indexCells,
  isDocumentFrameCell,
  isDocumentCell,
  isFrameCell,
  isFrameReferenceCell,
  type CellChange,
  type CellId,
  type CellRegistry,
} from '@sue/board-core';
import { createDrawPlugin } from '@sue/board-draw';
import {
  parseMarkdownToTextDocument,
  serializeTextDocumentToMarkdown,
} from '@sue/board-markdown-to-text';
import { createMindPlugin } from '@sue/board-mind';
import { createUmlPlugin } from '@sue/board-uml';
import { createWorkflowPlugin } from '@sue/board-workflow';
import type { FrameInstanceHost, FrameOpenSource } from '@sue/verd-board-ui';
import {
  ChartLibrary,
  FileTree,
  I18nProvider,
  MyPage,
  OrganizePreview,
  PreviewMountProvider,
  useAppearancePreference,
  useI18n,
  VerdFrame,
  WorkspaceEmpty,
  WorkspaceMenu,
  WorkspaceSettings,
  WorkspaceTabs,
  WorkspaceFileNavigation,
  bindWorkspaceAction,
  type WorkspaceReferenceLocationGroup,
  type DocumentEditorChange,
  type DocumentSaveState,
  type DocumentSelection,
  type OrganizePreviewRow,
} from '@sue/verd-board-ui';
import { LoaderCircle, TriangleAlert, UserRound } from 'lucide-react';
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createCanvasSession,
  refOccurrenceId,
  rootOccurrenceId,
} from './canvas/canvas-session';
import {
  createDocumentFile,
  documentPathFor,
  isDocumentFileV1,
  type DocumentFileV1,
} from './documents/document-files';
import {
  createWorkspaceDocumentPreviewCache,
  type PreviewOptions,
} from './documents/workspace-previews';
import {
  parseWorkspaceExport,
  workspaceDocumentDependents,
  workspaceExportBundle,
} from './documents/workspace-references';
import {
  assessReferencePlace,
  createFrameFile,
  diagramKindOf,
  isRegularCanvas,
  organizePreviewIsStale,
  partitionCellStore,
  recommendOrganization,
  referenceSourcesOf,
  sameFrameContent,
  type FrameFileV2,
} from './frames/frame-files';
import type { WorkspaceSnapshot } from './frames/workspace-storage';
import type {
  OpenWorkspaceRequest,
  WorkspaceHandle,
  WorkspaceHost,
  WorkspaceHistoryEntry,
} from './host/workspace-host';
import {
  buildReferenceLocations,
  referenceLocationKey,
  type ReferenceLocation,
} from './documents/reference-locations';
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
import {
  canvasDisplayName,
  documentDisplayName,
  openWorkspaceSession,
  type WorkspaceFileEntry,
  type WorkspaceSession,
  type WorkspaceSessionSnapshot,
} from './session/workspace-session';

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
  left === right || JSON.stringify(left) === JSON.stringify(right);

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
  useAppearancePreference();
  return (
    <I18nProvider>
      <PreviewMountProvider>
        <WorkspaceAppShell {...props} />
      </PreviewMountProvider>
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
  const autoCalculationSession = useMemo(
    () =>
      createFrameAutoCalculationSession((frameId) => {
        for (const [fileId, entry] of session?.getState().files ?? []) {
          const file = entry.file;
          if (
            !isDocumentFileV1(file) &&
            (file.frame.id === frameId || isFrameCell(file.cells[frameId]))
          )
            return fileId;
        }
        return frameId;
      }),
    [session],
  );
  const workspaceActionContext = useRef<WorkspaceActionContext>({
    session,
    readonly,
  });
  workspaceActionContext.current = { session, readonly };
  const navigationFeedback = useMemo(createNavigationFeedback, [session]);
  const navigationFeedbackRef = useRef(navigationFeedback);
  navigationFeedbackRef.current = navigationFeedback;
  const workspaceContent = useRef<HTMLDivElement>(null);
  const workspaceDialogs = useRef<
    Record<string, (args?: unknown) => void | Promise<unknown>>
  >({});
  const workspaceScope = useRef<ActionScopeValue | null>(null);
  const workspaceEditing = useRef<
    () => () => Promise<import('@sue/board-common').ActionResult>
  >(() => async () => ({ status: 'completed' }));
  const workspaceSurfaceState = useRef({
    allowWorkspaceSwitching,
    isDefaultWorkspace: false,
    workspaceHistory: undefined as ReadonlySet<string> | undefined,
    currentHistoryId: undefined as string | undefined,
    hasOrigin: false,
    returnSources: new Map<string, string>(),
  });
  const workspaceActions = useMemo(
    () =>
      withNavigationFeedback(
        createWorkspaceActionRegistry({
          getContext: () => ({
            ...workspaceActionContext.current,
            paused: switchingRef.current,
            flushEditing: workspaceEditing.current(),
          }),
          dialogs: createWorkspaceSurfaceActions({
            getState: () => workspaceSurfaceState.current,
            invoke: (id, args) =>
              workspaceDialogs.current[id]?.(args) as
                | void
                | import('@sue/board-common').ActionResult
                | Promise<void | import('@sue/board-common').ActionResult>,
          }).map((entry) =>
            REPLACEABLE_NAVIGATION_ACTIONS.has(entry.id)
              ? { ...entry, concurrency: 'queue' as const }
              : entry,
          ),
        }),
        navigationFeedback,
        (id, args): NavigationIntent | null => {
          const current = workspaceActionContext.current.session;
          if (!current) return null;
          const state = current.getState();
          const sourceFileId = state.session.activeTabId;
          let targetFileId: string | null | undefined;
          switch (id) {
            case 'workspace.tab.activate':
            case 'workspace.file.open':
              targetFileId = String(workspaceActionArgument(args, 'fileId'));
              if (
                targetFileId === sourceFileId &&
                !workspaceContent.current?.querySelector(
                  '.workspace-panes[hidden]',
                )
              ) {
                navigationFeedback.cancel();
                return null;
              }
              break;
            case 'workspace.group.switch': {
              const groupId = String(workspaceActionArgument(args, 'groupId'));
              if (groupId === state.session.activeGroupId) {
                navigationFeedback.cancel();
                return null;
              }
              targetFileId =
                workspaceTabGroups(state.session).find(
                  (group) => group.id === groupId,
                )?.activeTabId ?? null;
              break;
            }
            case 'workspace.file.return':
              targetFileId = workspaceSurfaceState.current.returnSources.get(
                String(workspaceActionArgument(args, 'fileId')),
              );
              break;
            case 'workspace.reference.locate':
              targetFileId = (
                workspaceActionArgument(args, 'location') as
                  ReferenceLocation | undefined
              )?.sourceFileId;
              break;
            case 'workspace.return':
              targetFileId = navigationOriginsRef.current.at(-1)?.fileId;
              break;
            case 'workspace.create-document':
            case 'workspace.directory.create-document':
            case 'workspace.create-canvas':
            case 'workspace.directory.create-canvas':
              break;
            case 'workspace.tab.close':
            case 'workspace.tab.close-left':
            case 'workspace.tab.close-right':
            case 'workspace.tab.close-others':
            case 'workspace.group.delete':
            case 'workspace.open-folder':
            case 'workspace.open-history':
            case 'workspace.open-builtin':
            case 'workspace.library':
            case 'workspace.settings':
            case 'workspace.my':
              navigationFeedback.cancel();
              return null;
            default:
              return null;
          }
          return {
            session: current,
            sourceFileId,
            targetFileId,
            cold:
              targetFileId === undefined ||
              (targetFileId !== null &&
                !frameControllers.current.has(targetFileId) &&
                !documentControllers.current.has(targetFileId)),
          };
        },
        () =>
          workspaceActionContext.current.session?.getState().session
            .activeTabId ?? null,
      ),
    // A session identity defines this registry lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session],
  );
  useActionSource(workspaceActions);
  const workspaceActionName = (id: string) => {
    const action = workspaceActions
      .actions()
      .find((action) => action.id === id);
    return action ? actionLabel(action.label, locale) : id;
  };
  const workspaceActionState = (id: string, args?: unknown) =>
    workspaceActions.getActionState(id, args);
  const workspaceActionsRef = useRef(workspaceActions);
  workspaceActionsRef.current = workspaceActions;
  const actionsMounted = useRef(false);
  useEffect(() => {
    actionsMounted.current = true;
    return () => {
      actionsMounted.current = false;
      queueMicrotask(() => {
        if (
          !actionsMounted.current ||
          workspaceActionsRef.current !== workspaceActions
        )
          workspaceActions.dispose();
      });
    };
  }, [workspaceActions]);
  const applyWorkspaceAction = useCallback(
    async (command: WorkspaceCommand) => {
      if (workspaceActionContext.current.session !== session)
        return {
          ok: false as const,
          diagnostics: [{ message: 'stale-context' }],
        };
      return workspaceActionCommandResult(
        await workspaceActionsRef.current.executeAction(
          `workspace.${command.type}`,
          command,
        ),
      );
    },
    [session],
  );
  const documentPreviews = useMemo(createWorkspaceDocumentPreviewCache, [
    session,
  ]);
  const [snapshot, setSnapshot] = useState<WorkspaceSessionSnapshot | null>(
    null,
  );
  const openAutoCalculationFiles = useRef<{
    owner: typeof autoCalculationSession;
    ids: Set<string>;
  } | null>(null);
  const autoCalculationNavigation = snapshot?.session;
  useEffect(() => {
    if (!autoCalculationNavigation) return;
    const ids = new Set(
      (
        autoCalculationNavigation.groups?.flatMap((group) => group.tabs) ??
        autoCalculationNavigation.tabs
      ).map((tab) => tab.fileId),
    );
    const previous = openAutoCalculationFiles.current;
    if (previous?.owner === autoCalculationSession)
      for (const fileId of previous.ids)
        if (!ids.has(fileId)) autoCalculationSession.clearFile(fileId);
    openAutoCalculationFiles.current = { owner: autoCalculationSession, ids };
  }, [autoCalculationNavigation, autoCalculationSession]);
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
  const [history, setHistory] = useState<WorkspaceHistoryEntry[]>([]);
  const [currentHistoryId, setCurrentHistoryId] = useState<string>();
  const historyRequests = useRef({ sequence: 0 });
  const refreshHistory = useCallback(async () => {
    const sequence = ++historyRequests.current.sequence;
    if (!allowWorkspaceSwitching || !host.listWorkspaceHistory) return;
    try {
      const entries = await host.listWorkspaceHistory();
      if (sequence === historyRequests.current.sequence) setHistory(entries);
    } catch (cause) {
      if (sequence === historyRequests.current.sequence)
        notify(String(cause), 'error');
    }
  }, [host, allowWorkspaceSwitching, notify]);
  useEffect(() => {
    const requests = historyRequests.current;
    setHistory([]);
    void refreshHistory();
    return () => {
      requests.sequence++;
    };
  }, [refreshHistory]);
  const [handleName, setHandleName] = useState('');
  const [isDefaultWorkspace, setIsDefaultWorkspace] = useState(false);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [navigationRequest, setNavigationRequest] =
    useState<WorkspaceNavigationRequest | null>(null);
  const [navigationOrigins, setNavigationOrigins] = useState<
    NavigationOrigin[]
  >([]);
  const navigationOriginsRef = useRef(navigationOrigins);
  navigationOriginsRef.current = navigationOrigins;
  const pendingOrigin = useRef<{
    requestId: number;
    origin: NavigationOrigin;
    targetFileId: string;
  } | null>(null);
  const navigationAbort = useRef<AbortController | null>(null);
  const navigationSequence = useRef(0);
  const navigationResultHandler = useRef<
    (
      id: number,
      result: {
        status: 'revealed' | 'unavailable' | 'cancelled';
        code?: string;
      },
    ) => void
  >(() => {});
  const onNavigationResult = useCallback(
    (
      id: number,
      result: {
        status: 'revealed' | 'unavailable' | 'cancelled';
        code?: string;
      },
    ) => {
      navigationFeedbackRef.current.navigationResult(id, result.status);
      navigationResultHandler.current(id, result);
    },
    [],
  );
  const pendingReturn = useRef<NavigationOrigin | null>(null);
  const restoringEmbeddedOrigin = useRef<NavigationOrigin | null>(null);
  const restoreOriginHandler = useRef<() => void>(() => {});
  const frameControllers = useRef(new Map<string, FrameCanvasController>());
  const documentControllers = useRef(
    new Map<string, DocumentEditorController>(),
  );
  const frameReadyCallbacks = useRef(
    new Map<string, (controller: FrameCanvasController | null) => void>(),
  );
  const documentReadyCallbacks = useRef(
    new Map<string, (controller: DocumentEditorController | null) => void>(),
  );
  workspaceEditing.current = () => {
    const capturedSession = workspaceActionContext.current.session;
    const sourceId = capturedSession?.getState().session.activeTabId;
    const frame = sourceId
      ? frameControllers.current.get(sourceId)?.getActiveController()
      : undefined;
    const text = sourceId
      ? documentControllers.current.get(sourceId)
      : undefined;
    return async () => {
      const frameResult = await frame?.flushEditing();
      if (frameResult?.status === 'rejected')
        return {
          status: 'rejected',
          code: 'editing-flush-failed',
          message: frameResult.message,
        };
      if (workspaceActionContext.current.session !== capturedSession)
        return { status: 'cancelled', code: 'stale-context' };
      const textResult = await text?.flushEditing();
      if (
        textResult &&
        textResult.status !== 'completed' &&
        textResult.status !== 'noop'
      )
        return textResult;
      if (workspaceActionContext.current.session !== capturedSession)
        return { status: 'cancelled', code: 'stale-context' };
      return { status: 'completed' };
    };
  };
  const frameReady = (fileId: string) => {
    let callback = frameReadyCallbacks.current.get(fileId);
    if (!callback) {
      callback = (controller) => {
        if (controller) {
          frameControllers.current.set(fileId, controller);
          navigationFeedbackRef.current.refresh();
          queueMicrotask(() => restoreOriginHandler.current());
        } else frameControllers.current.delete(fileId);
      };
      frameReadyCallbacks.current.set(fileId, callback);
    }
    return callback;
  };
  const documentReady = (fileId: string) => {
    let callback = documentReadyCallbacks.current.get(fileId);
    if (!callback) {
      callback = (controller) => {
        if (controller) {
          documentControllers.current.set(fileId, controller);
          navigationFeedbackRef.current.refresh();
          queueMicrotask(() => restoreOriginHandler.current());
        } else documentControllers.current.delete(fileId);
      };
      documentReadyCallbacks.current.set(fileId, callback);
    }
    return callback;
  };
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
      const trigger = settingsButtonRef.current;
      if (
        trigger?.getAttribute('aria-expanded') !== 'true' &&
        !document.activeElement?.closest('dialog, [role="menu"]')
      )
        trigger?.focus();
      menuFocusHandled.current = menuFocusRequest;
    });
    return () => cancelAnimationFrame(frame);
  }, [switchingWorkspace, menuFocusRequest]);
  const myFocus = useRef<HTMLElement | null>(null);
  const openMy = (opener?: HTMLElement) => {
    const active = document.activeElement;
    myFocus.current =
      opener ??
      (active instanceof HTMLElement && active !== document.body
        ? active
        : settingsButtonRef.current);
    setSettingsView('my');
  };
  const closeMy = () => {
    setSettingsView(null);
    requestAnimationFrame(() => {
      const target = myFocus.current?.isConnected
        ? myFocus.current
        : settingsButtonRef.current;
      target?.focus();
    });
  };
  const closeSettings = () => {
    setSettingsView(null);
    requestAnimationFrame(() => settingsButtonRef.current?.focus());
  };
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [failedPath, setFailedPath] = useState<string | null>(null);
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
  const [organizeRows, setOrganizeRows] = useState<OrganizePreviewRow[] | null>(
    null,
  );
  const entryOrigins = useRef(new Map<string, NavigationOrigin>());
  const [, setSourceRev] = useState(0);
  const referenceLocations = useMemo(
    () =>
      buildReferenceLocations([
        ...[...(snapshot?.files.values() ?? [])].map((entry) => entry.file),
        ...[...(snapshot?.documents.values() ?? [])].map((entry) => entry.file),
      ]),
    [snapshot?.files, snapshot?.documents],
  );
  const workspaceReferences = snapshot?.references;
  const persistenceForPage = useMemo(
    () =>
      createPageFilePersistence(snapshot?.filePersistence, workspaceReferences),
    [snapshot?.filePersistence, workspaceReferences],
  );
  const documentDependents = useMemo(
    () =>
      workspaceReferences
        ? workspaceDocumentDependents(
            [
              ...[...(snapshot?.files.values() ?? [])].map(
                (entry) => entry.file,
              ),
              ...[...(snapshot?.documents.values() ?? [])].map(
                (entry) => entry.file,
              ),
            ],
            workspaceReferences,
          )
        : new Set<string>(),
    [snapshot?.files, snapshot?.documents, workspaceReferences],
  );
  const documentFrameChoices = useMemo(
    () =>
      [...(snapshot?.files.values() ?? [])].map((entry) => ({
        frameId: entry.file.frame.id,
        title: entry.file.frame.name || entry.file.frame.id,
        path: entry.path,
      })),
    [snapshot?.files],
  );
  const [settingsView, setSettingsView] = useState<'workspace' | 'my' | null>(
    null,
  );
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
    registryRef.current =
      registry ??
      createCellRegistry({
        plugins: [
          createDrawPlugin(),
          createMindPlugin(),
          createWorkflowPlugin(),
          createArchitecturePlugin(),
          createUmlPlugin(),
        ],
      });
  }

  const openWorkspaceRequest = async (
    request?: OpenWorkspaceRequest,
    initial = false,
  ): Promise<ActionResult> => {
    if (switchingRef.current && !initial)
      return { status: 'rejected', code: 'workspace-switching' };
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
      if (sequence !== requestSequence.current)
        return { status: 'cancelled', code: 'stale-request' };
      if (!handle) {
        if (!previous) setError('Workspace was not opened');
        return { status: 'cancelled', code: 'workspace-picker-cancelled' };
      }
      if (handle.key === previous?.handle.key) {
        await host.activateWorkspace?.(handle);
        return { status: 'noop' };
      }
      // Preserve the difference between missing navigation and deliberately
      // closed tabs. Only a first built-in open gets a reading starting point.
      const raw = await host.readSnapshot(handle);
      const opened = await openWorkspaceSession(host, handle, {
        registry: registryRef.current ?? undefined,
      });
      candidate = opened;
      if (sequence !== requestSequence.current)
        return { status: 'cancelled', code: 'stale-request' };
      const state = opened.getState();
      if (
        previous &&
        state.diagnostics.some(
          (issue) =>
            !issue.frameId &&
            (!issue.path || !/\.verd(?:-doc)?\.json$/.test(issue.path)),
        )
      )
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
      if (sequence !== requestSequence.current)
        return { status: 'cancelled', code: 'stale-request' };
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
      entryOrigins.current.clear();
      documentRestoreRef.current.clear();
      referenceScrollRef.current.clear();
      seenSubgraphs.current = null;
      setFailedPath(null);
      setLibraryOpen(false);
      setSettingsView(null);
      setPlaceTarget(null);
      setPickerFileId(null);
      setDocumentPickerFileId(null);
      setOrganizeRows(null);
      navigationAbort.current?.abort();
      navigationSequence.current++;
      pendingOrigin.current = null;
      setNavigationOrigins([]);
      frameControllers.current.clear();
      documentControllers.current.clear();
      setFileTreeReveal(undefined);
      setNavigationRequest(null);
      setExpandedOwners(
        handle.isDefault &&
          raw.session === null &&
          state.files.has('board-root')
          ? ['board-root']
          : [],
      );
      canvasRef.current = createCanvasSession({
        session: opened,
        registry: registryRef.current ?? undefined,
      });
      let observed = opened.getState();
      activeWorkspace.current = {
        handle,
        session: opened,
        unsubscribe: opened.subscribe(() => {
          const next = opened.getState();
          const urgent =
            next.store !== observed.store ||
            next.documents.size !== observed.documents.size ||
            [...next.documents].some(
              ([id, entry]) => observed.documents.get(id)?.file !== entry.file,
            ) ||
            JSON.stringify(next.session) !== JSON.stringify(observed.session) ||
            next.mutationsPaused !== observed.mutationsPaused;
          observed = next;
          // Content and navigation must commit with edit/restore requests.
          // Pure save notifications can yield to ongoing canvas gestures.
          if (urgent) setSnapshot(next);
          else startTransition(() => setSnapshot(next));
        }),
      };
      candidate = null;
      setHandleName(handle.name);
      setCurrentHistoryId(handle.historyId);
      setIsDefaultWorkspace(!!handle.isDefault);
      setSession(opened);
      setSnapshot(opened.getState());
      setError(null);
      onOpen?.(handle);
      return { status: 'completed' };
    } catch (cause) {
      if (sequence !== requestSequence.current)
        return { status: 'cancelled', code: 'stale-request' };
      if (previous) notify(String(cause), 'error');
      else setError(String(cause));
      return {
        status: 'failed',
        code: 'workspace-open-failed',
        message: String(cause),
      };
    } finally {
      candidate?.dispose();
      if (
        candidateHandle &&
        sequence === requestSequence.current &&
        candidateHandle.key !== activeWorkspace.current?.handle.key
      )
        await host.closeWorkspace(candidateHandle).catch(() => {});
      previous?.session.unfreeze();
      if (sequence === requestSequence.current) {
        void refreshHistory();
        switchingRef.current = false;
        setSwitchingWorkspace(false);
      }
    }
  };

  const disposeActiveWorkspace = () => {
    requestSequence.current++;
    navigationAbort.current?.abort();
    navigationSequence.current++;
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
  const sessionNavigation = snapshot?.session;
  const mountedTabs = useMemo(
    () => (sessionNavigation ? retainedWorkspaceTabs(sessionNavigation) : []),
    [sessionNavigation],
  );
  useLayoutEffect(() => {
    navigationFeedback.commit(session, activeTabId);
    const ticket = navigationFeedback.current();
    if (
      ticket?.actionDone &&
      ticket.targetFileId &&
      !mountedTabs.some((tab) => tab.fileId === ticket.targetFileId)
    )
      navigationFeedback.cancel(ticket);
  }, [navigationFeedback, session, activeTabId, mountedTabs]);
  useEffect(() => {
    documentPreviews.retain(mountedTabs.map((tab) => tab.fileId));
  }, [documentPreviews, mountedTabs]);

  const persistNav = useCallback(
    (patch: Partial<WorkspaceSessionSnapshot['session']>) => {
      if (!session) return;
      const current = session.getState().session;
      const next = updateWorkspaceNavigation(current, patch);
      const changing =
        next.activeTabId !== current.activeTabId ||
        next.activeGroupId !== current.activeGroupId;
      const existing = navigationFeedback.current();
      const ticket = changing
        ? (existing ??
          navigationFeedback.begin({
            session,
            sourceFileId: current.activeTabId,
            targetFileId: next.activeTabId,
          }))
        : undefined;
      if (ticket) navigationFeedback.target(ticket, next.activeTabId);
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
      const update = workspaceActionsRef.current
        .executeAction('workspace.navigation.update', { state: next })
        .then((result) => {
          if (ticket && !existing) navigationFeedback.settle(ticket, result);
          else if (
            ticket &&
            result.status !== 'completed' &&
            result.status !== 'noop'
          )
            navigationFeedback.cancel(ticket);
          return result;
        });
      removed.forEach((tab) =>
        canvasRef.current?.close(rootOccurrenceId(tab.fileId)),
      );
      return update;
    },
    [session, navigationFeedback],
  );

  // Remove missing files from every group, including groups currently hidden.
  useEffect(() => {
    if (!session || !snapshot) return;
    const next = pruneWorkspaceTabs(
      snapshot.session,
      (id) =>
        snapshot.files.has(id) ||
        snapshot.documents.has(id) ||
        [...snapshot.failedFiles.values()].some(
          (failure) => failure.fileId === id,
        ),
    );
    if (JSON.stringify(next) !== JSON.stringify(snapshot.session))
      persistNav({ groups: next.groups });
  }, [session, snapshot, persistNav]);

  const revealFileInTree = useCallback(
    (fileId: string) => {
      if (!session) return;
      const state = session.getState();
      const path =
        state.files.get(fileId)?.path ??
        state.documents.get(fileId)?.path ??
        [...state.failedFiles.values()].find(
          (failure) => failure.fileId === fileId,
        )?.path;
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
    (fileId: CellId, preserveSource = false, navigating = false) => {
      if (!session) return;
      if (!navigating) {
        navigationAbort.current?.abort();
        navigationSequence.current++;
        pendingOrigin.current = null;
        pendingReturn.current = null;
        setNavigationRequest(null);
      }
      if (!preserveSource) entryOrigins.current.delete(fileId);
      setSourceRev((value) => value + 1);
      setFailedPath(null);
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
        state.files.get(fileId)?.path ??
        state.documents.get(fileId)?.path ??
        [...state.failedFiles.values()].find(
          (failure) => failure.fileId === fileId,
        )?.path;
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
      const update = persistNav({
        expandedDirs,
        tabs: exists ? current.tabs : [...current.tabs, { fileId }],
        activeTabId: fileId,
      });
      if (session.getState().files.has(fileId))
        canvasRef.current?.openFile(fileId);
      return update;
    },
    [session, persistNav],
  );

  useEffect(() => {
    if (!failedPath || !snapshot || snapshot.failedFiles.has(failedPath))
      return;
    const id = snapshot.fileIdByPath.get(failedPath);
    if (id) openFile(id);
  }, [snapshot, failedPath, openFile]);

  const instanceHost = useMemo<FrameInstanceHost>(
    () => ({
      get(query) {
        const canvas = canvasRef.current;
        const occurrence = canvas?.get(
          refOccurrenceId(query.ownerFileId, query.refId, query.appearance),
        );
        if (!occurrence || occurrence.missing) return null;
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
      updateContentOffset(occurrenceId, mindRootId, offset) {
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
      const result = await applyWorkspaceAction(
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
    [session, placeTarget, notify, applyWorkspaceAction],
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
      if (next !== current) {
        persistNav({ groups: next.groups });
      }
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
      const ticket = navigationFeedback.current();
      const frameId = uuid();
      const file = createFrameFile(createFrameCell(frameId));
      const base = `${file.frame.name || '未命名画布'}.verd.json`;
      const result = await applyWorkspaceAction({
        type: 'create-file',
        file,
        path: dirPath ? `${dirPath}/${base}` : base,
        label: 'create-canvas',
      });
      if (result.ok && (!ticket || navigationFeedback.isCurrent(ticket)))
        return openFile(frameId);
      return undefined;
    },
    [session, openFile, applyWorkspaceAction, navigationFeedback],
  );

  const createDocument = useCallback(
    async (dirPath: string) => {
      if (!session) return;
      const ticket = navigationFeedback.current();
      const fileId = uuid();
      const file = createDocumentFile(fileId);
      const taken = new Set(session.getState().fileIdByPath.keys());
      const path = documentPathFor(file, dirPath, taken);
      const result = await applyWorkspaceAction({
        type: 'create-file',
        file,
        path,
        label: 'create-document',
      });
      if (result.ok && (!ticket || navigationFeedback.isCurrent(ticket))) {
        createdDocumentRef.current = fileId;
        return openFile(fileId);
      }
      return undefined;
    },
    [session, openFile, applyWorkspaceAction, navigationFeedback],
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
      const result = workspaceActionCommandResult(
        await workspaceActionsRef.current.executeAction(
          `workspace.history.${direction}`,
        ),
      );
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
      undo: () => runHistory('undo'),
      redo: () => runHistory('redo'),
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
      return applyWorkspaceAction({
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
    [session, applyWorkspaceAction],
  );

  const saveStateFor = (entry: WorkspaceFileEntry): DocumentSaveState => {
    if (entry.conflicted) return 'conflicted';
    const id =
      entry.file.format === 'verd-document'
        ? entry.file.id
        : entry.file.frame.id;
    const status = persistenceForPage(id).status;
    return status === 'idle' ? 'unsaved' : status;
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
        // Session persistence clones files. Hold the runtime's committed
        // snapshot for its exact content echo so FrameCanvas does not replace
        // the same edit with a second, fully cloned store. A rejection, undo or
        // external update differs from these files and takes the normal path.
        // Promoted owned Frames change the store's structure: their canonical
        // reference shells must replace the raw import/creation snapshot.
        if (!partitioned.references.size)
          emittedRef.current = {
            files: new Map(
              partitioned.files.map((file) => [file.frame.id, file]),
            ),
            snapshot: change.snapshot,
          };
        if (updated.length <= 1) {
          const sourceId = updated[0]?.frame.id ?? mountedFrameId;
          void applyWorkspaceAction({
            type: 'edit-file',
            sourceFileId: sourceId,
            store: change.snapshot.store,
            creationOwnerId:
              existing.get(sourceId) && isRegularCanvas(existing.get(sourceId)!)
                ? sourceId
                : mounted && isRegularCanvas(mounted)
                  ? mountedFrameId
                  : undefined,
            label: change.transaction.id,
          }).then((result) => {
            if (!result.ok)
              notify(result.diagnostics.map((item) => item.message).join('; '));
          });
          return;
        }
        void applyWorkspaceAction({
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
    [session, notify, applyWorkspaceAction],
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
          void applyWorkspaceAction({
            type: 'duplicate-reference',
            ownerFrameId: ownerOfCell(refId, mountedFrameId),
            refId,
            label: 'duplicate-reference',
          }),
      );
    },
    [session, ownerOfCell, applyWorkspaceAction],
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
        const result = await applyWorkspaceAction({
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
    [session, parseLegacy, locale, notify, applyWorkspaceAction],
  );

  useEffect(() => {
    restoreOriginHandler.current();
  }, [snapshot?.session.activeTabId, snapshot?.session.activeGroupId]);
  useEffect(
    () => workspaceActions.invalidate(),
    [
      workspaceActions,
      snapshot,
      readonly,
      switchingWorkspace,
      history,
      currentHistoryId,
      navigationOrigins.length,
    ],
  );
  workspaceSurfaceState.current = {
    allowWorkspaceSwitching,
    isDefaultWorkspace,
    workspaceHistory: host.listWorkspaceHistory
      ? new Set(history.map((entry) => entry.id))
      : undefined,
    currentHistoryId,
    hasOrigin: navigationOrigins.length > 0,
    returnSources: new Map(
      [...entryOrigins.current].map(([id, origin]) => [
        id,
        snapshot?.files.has(origin.fileId) ||
        snapshot?.documents.has(origin.fileId)
          ? origin.fileId
          : origin.kind === 'canvas'
            ? (origin.sourceFileId ?? origin.fileId)
            : origin.fileId,
      ]),
    ),
  };
  workspaceDialogs.current['reload'] = () => window.location.reload();
  workspaceDialogs.current['open-folder'] = () =>
    openWorkspaceRequest({ pick: true }).finally(() =>
      setMenuFocusRequest((current) => current + 1),
    );
  workspaceDialogs.current['open-history'] = (args) =>
    openWorkspaceRequest({
      historyId: String(workspaceActionArgument(args, 'historyId')),
    }).finally(() => setMenuFocusRequest((current) => current + 1));
  workspaceDialogs.current['open-builtin'] = () =>
    openWorkspaceRequest({ default: true }).finally(() =>
      setMenuFocusRequest((current) => current + 1),
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
            onClick={() =>
              void workspaceActions.executeAction('workspace.reload')
            }
          >
            {workspaceActionName('workspace.reload')}
          </button>
          {allowWorkspaceSwitching && !readonly && history.length > 0 && (
            <div className="workspace-recovery-history">
              <h2>
                {locale === 'zh' ? '已打开的工作区' : 'Opened workspaces'}
              </h2>
              {history.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  data-testid={`workspace-history-${entry.id}`}
                  disabled={
                    switchingWorkspace ||
                    !workspaceActionState('workspace.open-history', {
                      historyId: entry.id,
                    }).enabled
                  }
                  onClick={() =>
                    void workspaceActions.executeAction(
                      'workspace.open-history',
                      { historyId: entry.id },
                    )
                  }
                >
                  {entry.name}
                  {entry.description ? ` · ${entry.description}` : ''}
                </button>
              ))}
            </div>
          )}
          {workspaceActionState('workspace.open-folder').visible && (
            <>
              <button
                type="button"
                disabled={
                  !workspaceActionState('workspace.open-folder').enabled
                }
                onClick={() =>
                  void workspaceActions.executeAction('workspace.open-folder')
                }
              >
                {workspaceActionName('workspace.open-folder')}
              </button>
              <button
                type="button"
                disabled={
                  !workspaceActionState('workspace.open-builtin').enabled
                }
                onClick={() =>
                  void workspaceActions.executeAction('workspace.open-builtin')
                }
              >
                {workspaceActionName('workspace.open-builtin')}
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
  const captureNavigationOrigin = (
    reference?: FrameOpenSource,
  ): NavigationOrigin | undefined => {
    if (!session) return undefined;
    const state = session.getState(),
      fileId = state.session.activeTabId;
    if (!fileId) return undefined;
    const rootFrame = frameControllers.current.get(fileId);
    const activeFrame = rootFrame?.getActiveController();
    const frame =
      reference && rootFrame?.runtime.store.rootId === reference.sourceFileId
        ? rootFrame
        : activeFrame;
    if (frame)
      return {
        kind: 'canvas',
        fileId,
        sourceFileId:
          frame.getActionContext().fileId ?? frame.runtime.store.rootId,
        occurrenceId: frame.getActionContext().occurrenceId,
        appearancePath: frame.getActionContext().appearancePath,
        groupId: state.session.activeGroupId,
        selection: structuredClone(frame.runtime.selection),
        camera: frame.getCamera(),
        embeddedDocument: frame.captureDocumentEditingView() ?? undefined,
        reference: reference
          ? { fileId: reference.sourceFileId, cellId: reference.refId }
          : undefined,
      };
    const documentController = documentControllers.current.get(fileId);
    if (documentController) {
      const content = document.querySelector<HTMLElement>(
        '.workspace-pane.is-active .document-page__content',
      );
      return {
        kind: 'document',
        fileId,
        groupId: state.session.activeGroupId,
        selection: documentController.getSelection(),
        revision: JSON.stringify(documentController.getDocument().content),
        scroll: {
          top: content?.scrollTop ?? 0,
          left: content?.scrollLeft ?? 0,
        },
      };
    }
    return undefined;
  };
  navigationResultHandler.current = (
    requestId: number,
    result: { status: 'revealed' | 'unavailable' | 'cancelled'; code?: string },
  ) => {
    if (requestId !== navigationSequence.current) return;
    if (
      result.status === 'revealed' &&
      pendingOrigin.current?.requestId === requestId
    ) {
      const origin = pendingOrigin.current.origin;
      const targetFileId = pendingOrigin.current.targetFileId;
      if (session.getState().session.activeTabId !== targetFileId) {
        pendingOrigin.current = null;
        return;
      }
      if (targetFileId !== origin.fileId) {
        entryOrigins.current.set(targetFileId, origin);
        setSourceRev((value) => value + 1);
      }
      pendingOrigin.current = null;
      setNavigationOrigins((previous) => [...previous, origin]);
    } else if (result.status === 'unavailable') {
      pendingOrigin.current = null;
      notify(
        locale === 'zh'
          ? result.code === 'stale-reference'
            ? '引用位置已变化，请重新选择。'
            : '目标对象不存在、已隐藏或无法定位。'
          : result.code === 'stale-reference'
            ? 'The reference changed. Please select it again.'
            : 'The target is missing, hidden or unavailable.',
        'error',
      );
    }
  };
  const navigateTarget = async (
    target: WorkspaceTarget,
    remember = true,
    reference?: FrameOpenSource,
    frameReference?: WorkspaceNavigationRequest['frameReference'],
  ) => {
    if (!session) return;
    // Capture the source before yielding for a cold target; feedback must not
    // retarget the original caret, scroll position or editing surface.
    const origin = remember ? captureNavigationOrigin(reference) : undefined;
    const capturedSession = session;
    const sourceId = session.getState().session.activeTabId;
    const source = sourceId
      ? frameControllers.current.get(sourceId)?.getActiveController()
      : undefined;
    const sourceDocument = sourceId
      ? documentControllers.current.get(sourceId)
      : undefined;
    const previousFeedback = navigationFeedback.current();
    const joinedFeedback =
      previousFeedback &&
      !previousFeedback.actionDone &&
      previousFeedback.navigationId === undefined &&
      (previousFeedback.targetFileId === undefined ||
        previousFeedback.targetFileId === target.fileId)
        ? previousFeedback
        : undefined;
    if (previousFeedback && !joinedFeedback)
      navigationFeedback.cancel(previousFeedback);
    const feedbackTicket =
      joinedFeedback ??
      (target.fileId !== session.getState().session.activeTabId
        ? navigationFeedback.begin({
            session,
            sourceFileId: session.getState().session.activeTabId,
            targetFileId: target.fileId,
            cold:
              (session.getState().files.has(target.fileId) ||
                session.getState().documents.has(target.fileId)) &&
              !frameControllers.current.has(target.fileId) &&
              !documentControllers.current.has(target.fileId),
          })
        : undefined);
    let feedbackScheduled = false;
    try {
      if (
        feedbackTicket?.cold &&
        !joinedFeedback &&
        !(await navigationPaintOpportunity(feedbackTicket.controller.signal))
      )
        return;
      pendingReturn.current = null;
      const requestId = ++navigationSequence.current;
      navigationAbort.current?.abort();
      const abort = new AbortController();
      navigationAbort.current = abort;
      if (feedbackTicket) {
        navigationFeedback.target(feedbackTicket, target.fileId);
        navigationFeedback.waitForNavigation(feedbackTicket, requestId);
        feedbackTicket.controller.signal.addEventListener(
          'abort',
          () => abort.abort(),
          { once: true },
        );
      }
      const flushed = await source?.flushEditing();
      const documentFlush = await sourceDocument?.flushEditing();
      if (
        documentFlush &&
        !['completed', 'noop'].includes(documentFlush.status)
      ) {
        notify(
          'message' in documentFlush
            ? (documentFlush.message ?? documentFlush.code)
            : documentFlush.status,
          'error',
        );
        return;
      }
      if (
        requestId !== navigationSequence.current ||
        abort.signal.aborted ||
        workspaceActionContext.current.session !== capturedSession ||
        session.getState().session.activeTabId !== sourceId
      )
        return;
      if (flushed?.status === 'rejected') {
        notify(flushed.message ?? 'Edit rejected', 'error');
        return;
      }
      const state = session.getState();
      const resolved = resolveWorkspaceTarget(
        target,
        state.files,
        state.documents,
      );
      if (resolved.status === 'unavailable') {
        notify(
          locale === 'zh'
            ? resolved.code === 'missing-file'
              ? '文件不存在。'
              : resolved.code === 'ambiguous-cell'
                ? '对象身份存在冲突，无法定位。'
                : '目标对象不存在或地址不受支持。'
            : resolved.code === 'missing-file'
              ? 'File does not exist.'
              : resolved.code === 'ambiguous-cell'
                ? 'The target identity is ambiguous.'
                : 'The target is missing or unsupported.',
          'error',
        );
        if (resolved.fallback) openFile(resolved.fallback.fileId);
        return;
      }
      if (
        frameReference &&
        JSON.stringify(
          state.documents.get(target.fileId)?.file.text.content,
        ) !== frameReference.revision
      ) {
        notify(
          locale === 'zh'
            ? '引用位置已变化，请重新选择。'
            : 'The reference changed. Please select it again.',
        );
        return;
      }
      pendingOrigin.current = origin
        ? { requestId, origin, targetFileId: resolved.target.fileId }
        : null;
      await openFile(
        resolved.target.fileId,
        origin?.fileId === resolved.target.fileId,
        true,
      );
      if (abort.signal.aborted || requestId !== navigationSequence.current)
        return;
      setNavigationRequest({
        requestId,
        target: resolved.target,
        origin,
        signal: abort.signal,
        frameReference,
      });
      feedbackScheduled = true;
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), 'error');
    } finally {
      if (feedbackTicket) {
        if (!feedbackScheduled) navigationFeedback.cancel(feedbackTicket);
        else if (!joinedFeedback)
          navigationFeedback.settle(feedbackTicket, { status: 'completed' });
      }
    }
  };
  const returnToNavigationOrigin = async () => {
    if (!session) return;
    let origin: NavigationOrigin | undefined;
    const remaining = [...navigationOriginsRef.current];
    while (remaining.length) {
      let candidate = remaining.pop()!;
      const state = session.getState();
      if (candidate.kind === 'canvas' && candidate.sourceFileId) {
        if (!state.files.has(candidate.sourceFileId)) continue;
        if (!state.files.has(candidate.fileId))
          candidate = {
            ...candidate,
            fileId: candidate.sourceFileId,
            occurrenceId: undefined,
            appearancePath: undefined,
          };
      }
      if (
        state.files.has(candidate.fileId) ||
        state.documents.has(candidate.fileId)
      ) {
        origin = candidate;
        break;
      }
    }
    setNavigationOrigins(remaining);
    if (!origin) return;
    await restoreNavigationOrigin(origin);
  };
  const restoreNavigationOrigin = async (origin: NavigationOrigin) => {
    navigationAbort.current?.abort();
    navigationSequence.current++;
    navigationAbort.current = new AbortController();
    const returnAbort = navigationAbort.current;
    navigationFeedback.current()?.controller.signal.addEventListener(
      'abort',
      () => {
        returnAbort.abort();
        if (pendingReturn.current === origin) pendingReturn.current = null;
        if (restoringEmbeddedOrigin.current === origin)
          restoringEmbeddedOrigin.current = null;
      },
      { once: true },
    );
    pendingOrigin.current = null;
    setNavigationRequest(null);
    pendingReturn.current = origin;
    const current = session.getState().session;
    if (
      origin.groupId &&
      current.groups?.some((group) => group.id === origin.groupId)
    )
      await persistNav({ activeGroupId: origin.groupId });
    if (pendingReturn.current !== origin) return;
    await openFile(origin.fileId, true, true);
    queueMicrotask(() => restoreOriginHandler.current());
  };
  const returnToFileOrigin = async (fileId: string) => {
    const origin = entryOrigins.current.get(fileId);
    if (!origin || session.getState().session.activeTabId !== fileId) return;
    const reference = origin.kind === 'canvas' ? origin.reference : undefined;
    const sourceFileId =
      origin.kind === 'canvas'
        ? (origin.sourceFileId ?? origin.fileId)
        : origin.fileId;
    const state = session.getState();
    if (!state.files.has(sourceFileId) && !state.documents.has(sourceFileId)) {
      entryOrigins.current.delete(fileId);
      setSourceRev((value) => value + 1);
      return;
    }
    if (
      reference &&
      !state.files.get(reference.fileId)?.file.cells[reference.cellId]
    )
      notify(
        locale === 'zh'
          ? '引用已被移除，已返回来源文件。'
          : 'The reference was removed. Returned to its source file.',
      );
    const available =
      state.files.has(origin.fileId) || state.documents.has(origin.fileId);
    await restoreNavigationOrigin(
      available
        ? origin
        : {
            ...origin,
            fileId: sourceFileId,
            ...(origin.kind === 'canvas'
              ? { occurrenceId: undefined, appearancePath: undefined }
              : {}),
          },
    );
  };
  const locateReference = async (location: ReferenceLocation) => {
    const state = session.getState();
    if (location.kind === 'canvas') {
      const cell = state.files.get(location.sourceFileId)?.file.cells[
        location.refId
      ];
      const target =
        cell &&
        (isFrameReferenceCell(cell)
          ? cell.data.targetFrameId
          : isDocumentCell(cell)
            ? cell.data.targetDocumentId
            : undefined);
      if (target !== location.targetFileId) {
        notify(
          locale === 'zh'
            ? '引用已被移除或更改。'
            : 'The reference was removed or changed.',
        );
        return;
      }
      await navigateTarget({
        kind: 'cell',
        fileId: location.sourceFileId,
        cellId: location.refId,
      });
    } else {
      await navigateTarget(
        { kind: 'file', fileId: location.sourceFileId },
        true,
        undefined,
        {
          targetFrameId: location.targetFileId,
          occurrence: location.occurrence,
          revision: location.revision,
        },
      );
    }
  };
  restoreOriginHandler.current = () => {
    const origin = pendingReturn.current;
    if (!origin || restoringEmbeddedOrigin.current === origin) return;
    const state = session.getState();
    const openCanonicalSource = () => {
      if (origin.kind !== 'canvas' || !origin.sourceFileId) return;
      if (!state.files.has(origin.sourceFileId)) {
        pendingReturn.current = null;
        void returnToNavigationOrigin();
        return;
      }
      pendingReturn.current = {
        ...origin,
        fileId: origin.sourceFileId,
        occurrenceId: undefined,
        appearancePath: undefined,
      };
      openFile(origin.sourceFileId, true, true);
      queueMicrotask(() => restoreOriginHandler.current());
    };
    if (
      origin.kind === 'canvas' &&
      origin.sourceFileId &&
      (!state.files.has(origin.sourceFileId) || !state.files.has(origin.fileId))
    ) {
      openCanonicalSource();
      return;
    }
    if (
      activeTabId !== origin.fileId ||
      state.session.activeTabId !== origin.fileId
    )
      return;
    const active = document.querySelector<HTMLElement>(
      `.workspace-pane.is-active`,
    );
    if (origin.kind === 'canvas') {
      const rootController = frameControllers.current.get(origin.fileId);
      if (!rootController) return;
      // Parent render refs can advance before React commits the pane/child
      // activation. Restore only against the canvas actually in that pane.
      const mounted = active?.querySelector<SVGElement>(
        'svg[aria-label="Frame canvas"][data-surface="root"]',
      );
      const instanceId = rootController.getActionContext().occurrenceId;
      if (
        !mounted ||
        (instanceId && mounted.dataset['instanceId'] !== instanceId)
      )
        return;
      const occurrence = origin.occurrenceId
        ? rootController.findOccurrence(origin.occurrenceId)
        : null;
      if (origin.occurrenceId && !occurrence && origin.sourceFileId) {
        openCanonicalSource();
        return;
      }
      const controller = occurrence ?? rootController;
      controller.clearRevealOverrides();
      try {
        const selection = {
          ids: origin.selection.ids.filter(
            (id) => !!controller.runtime.store.cells[id],
          ),
          focus: origin.selection.focus.filter(
            (id) => !!controller.runtime.store.cells[id],
          ),
        };
        controller.runtime.select({
          ...selection,
          focus: selection.focus.length
            ? selection.focus
            : [controller.runtime.store.rootId],
        });
      } catch {
        controller.runtime.select({
          focus: [controller.runtime.store.rootId],
          ids: [],
        });
      }
      controller.restoreCamera(origin.camera);
      if (origin.embeddedDocument) {
        const requestId = navigationSequence.current;
        restoringEmbeddedOrigin.current = origin;
        const complete = () => {
          if (restoringEmbeddedOrigin.current === origin)
            restoringEmbeddedOrigin.current = null;
          if (
            requestId === navigationSequence.current &&
            pendingReturn.current === origin
          )
            pendingReturn.current = null;
          navigationFeedback.refresh();
        };
        void controller
          .restoreDocumentEditingView(
            origin.embeddedDocument,
            navigationAbort.current?.signal,
          )
          .then(complete, complete);
        return;
      }
    } else {
      const controller = documentControllers.current.get(origin.fileId);
      if (!controller) return;
      if (
        JSON.stringify(controller.getDocument().content) === origin.revision &&
        origin.selection
      )
        controller.restoreSelection(origin.selection);
      const content = active?.querySelector<HTMLElement>(
        '.document-page__content',
      );
      if (content) {
        content.scrollTop = origin.scroll.top;
        content.scrollLeft = origin.scroll.left;
      }
    }
    pendingReturn.current = null;
    navigationFeedback.refresh();
  };
  const openPreview = (fileId: string, anchor: string | null = null) => {
    const target = anchor?.startsWith('cell:')
      ? { kind: 'cell' as const, fileId, cellId: anchor.slice(5) }
      : anchor
        ? { kind: 'heading' as const, fileId, slug: anchor }
        : { kind: 'file' as const, fileId };
    void navigateTarget(target);
  };
  const openPreviewLink = (href: string, sourceId: string) => {
    const target = parseWorkspaceLink(href, sourceId);
    if (target) {
      void navigateTarget(target);
      return;
    }
    const external = parseExternalLink(href);
    if (external) {
      window.open(external, '_blank', 'noopener,noreferrer');
      return;
    }
    notify(
      locale === 'zh' ? '链接地址不受支持。' : 'Unsupported link.',
      'error',
    );
  };

  const previewOptions = (fileId: string): PreviewOptions => ({
    snapshot,
    locale,
    retry: () => session.syncFromHost(),
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
      return applyWorkspaceAction({
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
      void applyWorkspaceAction({ type: 'rename-document', fileId: id, title });
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
  const paneReady = () => {
    if (pendingReturn.current || restoringEmbeddedOrigin.current) return false;
    const root = workspaceContent.current;
    const pane = root?.querySelector<HTMLElement>('.workspace-pane.is-active');
    if (pane?.querySelector('[data-testid="workspace-file-error"]'))
      return true;
    if (!activeTabId) return !!root?.querySelector('.workspace-empty');
    if (!pane) return false;
    if (
      !frameControllers.current.has(activeTabId) &&
      !documentControllers.current.has(activeTabId)
    )
      return false;
    if (documents.has(activeTabId) && !pane.querySelector('.ProseMirror'))
      return false;
    const rect = pane.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  workspaceSurfaceState.current = {
    allowWorkspaceSwitching,
    isDefaultWorkspace,
    workspaceHistory: host.listWorkspaceHistory
      ? new Set(history.map((entry) => entry.id))
      : undefined,
    currentHistoryId,
    hasOrigin: navigationOrigins.length > 0,
    returnSources: new Map(
      [...entryOrigins.current].map(([id, origin]) => [
        id,
        snapshot?.files.has(origin.fileId) ||
        snapshot?.documents.has(origin.fileId)
          ? origin.fileId
          : origin.kind === 'canvas'
            ? (origin.sourceFileId ?? origin.fileId)
            : origin.fileId,
      ]),
    ),
  };
  workspaceDialogs.current = {
    'command-palette': () =>
      workspaceScope.current?.openPalette({
        returnFocus: () => settingsButtonRef.current,
      }),
    'open-folder': () =>
      openWorkspaceRequest({ pick: true }).finally(() =>
        setMenuFocusRequest((current) => current + 1),
      ),
    'open-history': (args) =>
      openWorkspaceRequest({
        historyId: String(workspaceActionArgument(args, 'historyId')),
      }).finally(() => setMenuFocusRequest((current) => current + 1)),
    'open-builtin': () =>
      openWorkspaceRequest({ default: true }).finally(() =>
        setMenuFocusRequest((current) => current + 1),
      ),
    'file.open': (args) =>
      openFile(String(workspaceActionArgument(args, 'fileId'))),
    'file.return': (args) =>
      returnToFileOrigin(String(workspaceActionArgument(args, 'fileId'))),
    'reference.locate': (args) =>
      locateReference(
        workspaceActionArgument(args, 'location') as ReferenceLocation,
      ),
    'file.reveal': (args) =>
      revealFileInTree(String(workspaceActionArgument(args, 'fileId'))),
    'file.export': (args) =>
      exportFrame(
        String(workspaceActionArgument(args, 'fileId')),
        workspaceActionArgument(args, 'format') === 'markdown'
          ? 'markdown'
          : 'json',
      ),
    'directory.toggle': (args) => {
      const path = String(workspaceActionArgument(args, 'path'));
      const dirs = session.getState().session.expandedDirs;
      return persistNav({
        expandedDirs: dirs.includes(path)
          ? dirs.filter((dir) => dir !== path)
          : [...dirs, path],
      });
    },
    'owner.toggle': (args) => {
      const id = String(workspaceActionArgument(args, 'fileId'));
      setExpandedOwners((current) =>
        current.includes(id)
          ? current.filter((value) => value !== id)
          : [...current, id],
      );
    },
    'tab.activate': (args) => {
      setFailedPath(null);
      setLibraryOpen(false);
      setPickerFileId(null);
      return persistNav({
        activeTabId: String(workspaceActionArgument(args, 'fileId')),
      });
    },
    'tab.close': (args) =>
      closeTabs(
        String(workspaceActionArgument(args, 'fileId')),
        workspaceActionArgument(args, 'scope') as TabCloseScope,
      ),
    'tab.reorder': (args) =>
      reorderTab(
        String(workspaceActionArgument(args, 'fileId')),
        String(workspaceActionArgument(args, 'targetFileId')),
        workspaceActionArgument(args, 'position') as 'before' | 'after',
      ),
    'group.switch': (args) => {
      setFailedPath(null);
      setLibraryOpen(false);
      setPickerFileId(null);
      return persistNav({
        activeGroupId: String(workspaceActionArgument(args, 'groupId')),
      });
    },
    'group.create': (args) => {
      const group = {
        id: uuid(),
        name: String(workspaceActionArgument(args, 'name')),
        tabs: [],
        activeTabId: null,
      };
      setFailedPath(null);
      setLibraryOpen(false);
      setPickerFileId(null);
      return persistNav({
        groups: [...workspaceTabGroups(session.getState().session), group],
        activeGroupId: group.id,
      });
    },
    'group.rename': (args) =>
      persistNav({
        groups: workspaceTabGroups(session.getState().session).map((group) =>
          group.id === workspaceActionArgument(args, 'groupId')
            ? { ...group, name: String(workspaceActionArgument(args, 'name')) }
            : group,
        ),
      }),
    'group.delete': (args) => {
      const next = deleteWorkspaceTabGroup(
        session.getState().session,
        String(workspaceActionArgument(args, 'groupId')),
      );
      setFailedPath(null);
      setLibraryOpen(false);
      setPickerFileId(null);
      return persistNav({
        groups: next.groups,
        activeGroupId: next.activeGroupId,
      });
    },
    'create-canvas': (args) =>
      createCanvas(
        args && typeof args === 'object' && 'dirPath' in args
          ? String(args.dirPath)
          : '',
      ),
    'directory.create-canvas': (args) =>
      createCanvas(String(workspaceActionArgument(args, 'dirPath') ?? '')),
    'directory.create-document': (args) =>
      createDocument(String(workspaceActionArgument(args, 'dirPath') ?? '')),
    'create-document': (args) =>
      createDocument(
        args && typeof args === 'object' && 'dirPath' in args
          ? String(args.dirPath)
          : '',
      ),
    import: () => importInput.current?.click(),
    library: () => setLibraryOpen(true),
    settings: () => setSettingsView('workspace'),
    my: (args) => {
      const opener = workspaceActionArgument(args, 'returnFocus');
      openMy(opener instanceof HTMLElement ? opener : undefined);
    },
    return: returnToNavigationOrigin,
  };
  const fileNavigation = (fileId: string) => {
    const entry = entryForTab(fileId);
    if (!entry) return null;
    const label = (id: string) => {
      const item = entryForTab(id);
      return item?.file.format === 'verd-document'
        ? item.file.title || documentDisplayName(item.path)
        : item?.file.frame.name || canvasDisplayName(item?.path ?? id);
    };
    const action = (id: string, args: unknown) =>
      bindWorkspaceAction(workspaceActions, `workspace.${id}`, args)!;
    const origin = entryOrigins.current.get(fileId);
    const sourceId =
      origin &&
      (entryForTab(origin.fileId)
        ? origin.fileId
        : origin.kind === 'canvas'
          ? (origin.sourceFileId ?? origin.fileId)
          : origin.fileId);
    const placement = snapshot.organization.byFile.get(fileId)?.placement;
    const ownerId =
      placement?.kind === 'owned' ? placement.ownerFrameId : undefined;
    const grouped = new Map<string, WorkspaceReferenceLocationGroup>();
    for (const location of referenceLocations.get(fileId) ?? []) {
      const source = entryForTab(location.sourceFileId);
      if (!source) continue;
      let group = grouped.get(location.sourceFileId);
      if (!group) {
        group = {
          fileId: location.sourceFileId,
          title: label(location.sourceFileId),
          kind: source.file.format === 'verd-document' ? 'document' : 'canvas',
          items: [],
        };
        grouped.set(location.sourceFileId, group);
      }
      const ordinal =
        locale === 'zh'
          ? `第 ${location.ordinal} 处`
          : `Occurrence ${location.ordinal}`;
      group.items.push({
        id: referenceLocationKey(location),
        label: location.name ? `${location.name} · ${ordinal}` : ordinal,
        action: action('reference.locate', {
          fileId: location.sourceFileId,
          fromFileId: fileId,
          location,
        }),
      });
    }
    return (
      <WorkspaceFileNavigation
        title={label(fileId)}
        path={entry.path}
        active={fileId === activeTabId && !libraryOpen && !settingsView}
        locale={locale}
        source={
          sourceId && entryForTab(sourceId)
            ? {
                title: label(sourceId),
                action: action('file.return', { fileId }),
              }
            : undefined
        }
        owner={
          ownerId && files.has(ownerId)
            ? {
                title: label(ownerId),
                action: action('file.open', { fileId: ownerId }),
              }
            : undefined
        }
        revealAction={action('file.reveal', { fileId })}
        references={[...grouped.values()].sort(
          (a, b) =>
            a.title.localeCompare(b.title, locale) ||
            a.fileId.localeCompare(b.fileId),
        )}
        onError={(message) => notify(message, 'error')}
      />
    );
  };
  return (
    <FrameAutoCalculationProvider session={autoCalculationSession}>
      <ActionScope
        registry={workspaceActions}
        language={locale}
        enabled={!switchingWorkspace}
        paletteFallback
        onReady={(value) => {
          workspaceScope.current = value;
        }}
      >
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
                borderRadius: 12,
                padding: 20,
                overflow: 'auto',
              }}
            >
              <h2>
                {documentPickerEditable
                  ? '文档 Frame'
                  : locale === 'zh'
                    ? '引用文档（只读）'
                    : 'Reference document (read-only)'}
              </h2>
              <button
                type="button"
                onClick={() => setDocumentPickerFileId(null)}
              >
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
                      kind: documentPickerEditable
                        ? 'document-frame'
                        : 'document',
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
              history={allowWorkspaceSwitching && !readonly ? history : []}
              currentHistoryId={currentHistoryId}
              onRefreshHistory={() => void refreshHistory()}
              locale={locale}
              switching={switchingWorkspace}
              isDefault={isDefaultWorkspace}
              triggerRef={settingsButtonRef}
              actionSource={workspaceActions}
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
              actionSource={workspaceActions}
              entries={snapshot.entries}
              canvases={canvases}
              documents={docs}
              failedFiles={[...snapshot.failedFiles.values()]}
              activeFailedPath={
                failedPath ??
                [...snapshot.failedFiles.values()].find(
                  (failure) => failure.fileId === activeTabId,
                )?.path
              }
              onOpenFailedFile={(path) => {
                navigationFeedback.cancel();
                const failure = snapshot.failedFiles.get(path);
                const sameIdentity = [...snapshot.failedFiles.values()].filter(
                  (item) => item.fileId === failure?.fileId,
                );
                const local = failure?.fileId
                  ? entryForTab(failure.fileId)
                  : undefined;
                if (
                  failure?.fileId &&
                  sameIdentity.length === 1 &&
                  (!local || local.path === path)
                )
                  openFile(failure.fileId);
                else {
                  setLibraryOpen(false);
                  setFailedPath(path);
                }
              }}
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
                    name:
                      entry.file.frame.name || canvasDisplayName(entry.path),
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
              onCreateCanvas={(dirPath) => {
                void workspaceActions.executeAction('workspace.create-canvas', {
                  dirPath,
                });
              }}
              onCreateDocument={(dirPath) => {
                void workspaceActions.executeAction(
                  'workspace.create-document',
                  {
                    dirPath,
                  },
                );
              }}
              onCreateFolder={(dirPath, name) => {
                const trimmed = name.trim();
                if (trimmed)
                  void workspaceActions.executeAction('workspace.mkdir', {
                    path: dirPath ? `${dirPath}/${trimmed}` : trimmed,
                  });
              }}
              onTrash={(frameId) =>
                void applyWorkspaceAction({ type: 'trash-file', frameId })
              }
              onTrashDirectory={async (path) => {
                const result = await applyWorkspaceAction({
                  type: 'trash-directory',
                  path,
                });
                if (!result.ok)
                  throw new Error(
                    result.diagnostics.map((item) => item.message).join('; '),
                  );
              }}
              onMove={(frameId, toPath) =>
                void applyWorkspaceAction({
                  type: 'move-file',
                  frameId,
                  toPath,
                })
              }
              onDuplicate={(frameId) =>
                void applyWorkspaceAction({ type: 'duplicate-file', frameId })
              }
              onExport={exportFrame}
              onImport={() => importInput.current?.click()}
            />
            <div className="workspace-sidebar-footer">
              <button
                type="button"
                data-testid="workspace-my"
                data-action-id="workspace.my"
                disabled={!workspaceActionState('workspace.my').enabled}
                onClick={(event) =>
                  void workspaceActions.executeAction('workspace.my', {
                    returnFocus: event.currentTarget,
                  })
                }
              >
                <UserRound size={16} aria-hidden />{' '}
                {workspaceActionName('workspace.my')}
              </button>
            </div>
          </aside>
          <main className="workspace-main">
            <WorkspaceTabs
              actionSource={workspaceActions}
              tabs={tabs.map((tab) => {
                const entry = entryForTab(tab.fileId);
                if (!entry)
                  return {
                    id: tab.fileId,
                    title:
                      [...snapshot.failedFiles.values()]
                        .find((failure) => failure.fileId === tab.fileId)
                        ?.path.split('/')
                        .pop() ?? tab.fileId,
                  };
                const file = entry.file;
                return {
                  id: tab.fileId,
                  title:
                    file.format === 'verd-document'
                      ? file.title || documentDisplayName(entry.path)
                      : file.frame.name || canvasDisplayName(entry.path),
                };
              })}
              activeTabId={libraryOpen || failedPath ? null : activeTabId}
              locale={locale}
              onActivate={(frameId) => {
                setFailedPath(null);
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
                setFailedPath(null);
                setLibraryOpen(false);
                setPickerFileId(null);
                persistNav({ activeGroupId: groupId });
              }}
              onCreateGroup={(name) => {
                const group = { id: uuid(), name, tabs: [], activeTabId: null };
                setFailedPath(null);
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
                    (group) =>
                      group.id === groupId ? { ...group, name } : group,
                  ),
                })
              }
              onDeleteGroup={(groupId) => {
                const next = deleteWorkspaceTabGroup(
                  session.getState().session,
                  groupId,
                );
                setFailedPath(null);
                setLibraryOpen(false);
                setPickerFileId(null);
                persistNav({
                  groups: next.groups,
                  activeGroupId: next.activeGroupId,
                });
              }}
              onClose={closeTabs}
              onCloseMany={closeTabs}
              onAdd={() =>
                void workspaceActions.executeAction('workspace.create-canvas', {
                  dirPath: '',
                })
              }
              onReorder={reorderTab}
            />
            <div
              className="workspace-content"
              ref={workspaceContent}
              key={activeWorkspace.current?.handle.key}
            >
              <WorkspaceNavigationProgress
                feedback={navigationFeedback}
                content={workspaceContent}
                locale={locale}
                ready={paneReady}
              />
              <WorkspacePaneEntrance
                feedback={navigationFeedback}
                content={workspaceContent}
                activeFileId={activeTabId}
                visible={!libraryOpen && !failedPath && !settingsView}
                ready={paneReady}
              />
              {failedPath && !libraryOpen ? (
                <WorkspaceFileError
                  path={failedPath}
                  locale={locale}
                  message={
                    snapshot.failedFiles
                      .get(failedPath)
                      ?.diagnostics.map((issue) => issue.message)
                      .join('\n') ??
                    (locale === 'zh' ? '文件已不存在' : 'File no longer exists')
                  }
                  onClose={() => setFailedPath(null)}
                  onRetry={async () => {
                    await session.syncFromHost();
                    const state = session.getState();
                    const id = state.fileIdByPath.get(failedPath);
                    if (id && !state.failedFiles.has(failedPath)) openFile(id);
                  }}
                />
              ) : null}
              {libraryOpen ? (
                <ChartLibrary
                  actionSource={workspaceActions}
                  locale={locale}
                  readonly={
                    readonly || switchingWorkspace || snapshot.mutationsPaused
                  }
                  owners={[...files.values()]
                    .filter((entry) => isRegularCanvas(entry.file))
                    .map((entry) => ({
                      frameId: entry.file.frame.id,
                      name:
                        entry.file.frame.name || canvasDisplayName(entry.path),
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
                      name:
                        entry.file.frame.name || canvasDisplayName(entry.path),
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
                    setFailedPath(null);
                    setLibraryOpen(false);
                  }}
                  onChangeOrganization={async (fileId, organization) => {
                    const result = workspaceActionCommandResult(
                      await workspaceActions.executeAction(
                        'workspace.library.organization',
                        { fileId, organization },
                      ),
                    );
                    if (!result.ok)
                      throw new Error(
                        result.diagnostics
                          .map((item) => item.message)
                          .join('; '),
                      );
                  }}
                  onOpen={openFile}
                  onBack={() => {
                    setPickerFileId(null);
                    setFailedPath(null);
                    setLibraryOpen(false);
                  }}
                  onOrganize={() => {
                    const frames = [...files.values()].map(
                      (entry) => entry.file,
                    );
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
                            file.file.frame.name ||
                            canvasDisplayName(file.path),
                          path: file.path,
                          diagram: diagramKindOf(file.file),
                          sources: sources
                            .map(
                              (source) =>
                                files.get(source.fileId)?.file.frame.name ||
                                canvasDisplayName(
                                  files.get(source.fileId)?.path ??
                                    source.fileId,
                                ),
                            )
                            .join(', '),
                          recommendedOwnerName: ownerId
                            ? files.get(ownerId)?.file.frame.name ||
                              canvasDisplayName(
                                files.get(ownerId)?.path ?? ownerId,
                              )
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
              <div
                className="workspace-panes"
                hidden={libraryOpen || !!failedPath}
              >
                {tabs.length === 0 ? (
                  <WorkspaceEmpty
                    locale={locale}
                    onCreate={() => void createCanvas('')}
                    onCreateDocument={() => void createDocument('')}
                  />
                ) : null}
                {mountedTabs.map((tab) => {
                  const entry = entryForTab(tab.fileId);
                  const failure = [...snapshot.failedFiles.values()].find(
                    (item) => item.fileId === tab.fileId,
                  );
                  if (failure && !entry?.dirty)
                    return (
                      <div
                        key={tab.fileId}
                        className={`workspace-pane${tab.fileId === activeTabId ? ' is-active' : ''}`}
                      >
                        <WorkspaceFileError
                          path={failure.path}
                          locale={locale}
                          message={failure.diagnostics
                            .map((issue) => issue.message)
                            .join('\n')}
                          onRetry={() => session.syncFromHost()}
                          onClose={() => closeTabs(tab.fileId)}
                        />
                      </div>
                    );
                  if (!entry) return null;
                  if (entry.file.format === 'verd-document') {
                    const restore = documentRestoreRef.current.get(tab.fileId);
                    return (
                      <WorkspaceContentBoundary
                        pane
                        active={tab.fileId === activeTabId}
                        key={tab.fileId}
                        resetKeys={[session, entry.file, snapshot.store]}
                        path={entry.path}
                        locale={locale}
                        onRetry={() => session.syncFromHost()}
                        onClose={() => closeTabs(tab.fileId)}
                      >
                        <div
                          className={`workspace-pane${tab.fileId === activeTabId ? ' is-active' : ''}`}
                        >
                          {fileNavigation(tab.fileId)}
                          <div className="workspace-pane-body">
                            <WorkspaceDocumentPage
                              preview={previewOptions(tab.fileId)}
                              canUndo={snapshot.canUndo}
                              canRedo={snapshot.canRedo}
                              page={{
                                frameChoices: documentFrameChoices,
                                value: entry.file.text,
                                title:
                                  entry.file.title ||
                                  documentDisplayName(entry.path),
                                readonly:
                                  readonly ||
                                  switchingWorkspace ||
                                  snapshot.mutationsPaused,
                                locale,
                                saveState: saveStateFor(entry),
                                history: historyAdapter,
                                restore: restore
                                  ? {
                                      revision: restore.revision,
                                      selection: restore.selection,
                                    }
                                  : undefined,
                                autoFocusTitle:
                                  createdDocumentRef.current === tab.fileId,
                                onChange: onDocumentChange(tab.fileId),
                                onReady: documentReady(tab.fileId),
                                navigation:
                                  tab.fileId === activeTabId &&
                                  navigationRequest?.target.fileId ===
                                    tab.fileId
                                    ? navigationRequest
                                    : undefined,
                                onNavigationResult,
                                onOpenLink: (href) =>
                                  openPreviewLink(href, tab.fileId),
                                onTitleCommit: (title) =>
                                  void applyWorkspaceAction({
                                    type: 'rename-document',
                                    fileId: tab.fileId,
                                    title,
                                    label: 'rename-document',
                                  }),
                                onExport: (format) =>
                                  void workspaceActions.executeAction(
                                    'workspace.file.export',
                                    { fileId: tab.fileId, format },
                                  ),
                              }}
                            />
                          </div>
                        </div>
                      </WorkspaceContentBoundary>
                    );
                  }
                  const scene = frameScene(
                    canvasValue(snapshot).store,
                    tab.fileId,
                    registry,
                  );
                  const pane =
                    scene === 'mind-root'
                      ? 'mind'
                      : scene === 'workflow-start'
                        ? 'workflow'
                        : scene === 'architecture-layer'
                          ? 'architecture'
                          : 'board';
                  return (
                    <WorkspaceContentBoundary
                      pane
                      active={tab.fileId === activeTabId}
                      key={tab.fileId}
                      resetKeys={[session, entry.file, snapshot.store]}
                      path={entry.path}
                      locale={locale}
                      onRetry={() => session.syncFromHost()}
                      onClose={() => closeTabs(tab.fileId)}
                    >
                      <div
                        data-workspace-pane={
                          tab.fileId === activeTabId ? pane : undefined
                        }
                        className={`workspace-pane${tab.fileId === activeTabId ? ' is-active' : ''}`}
                      >
                        {fileNavigation(tab.fileId)}
                        <div className="workspace-pane-body">
                          <VerdFrame
                            onOpenMy={() => {
                              openMy();
                              myFocus.current =
                                document.querySelector<HTMLElement>(
                                  '.workspace-pane.is-active [data-testid="app-menu-trigger"]',
                                );
                            }}
                            value={canvasValue(snapshot)}
                            documentReferences={documentPreviews(
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
                              documentDependents.has(tab.fileId)
                                ? () => {
                                    void workspaceActions.executeAction(
                                      'workspace.file.export',
                                      { fileId: tab.fileId },
                                    );
                                  }
                                : undefined
                            }
                            frameId={tab.fileId}
                            onChange={onChange(tab.fileId)}
                            onOpenFrame={(fileId, source) => {
                              void navigateTarget(
                                { kind: 'file', fileId },
                                true,
                                source,
                              );
                            }}
                            onDuplicateReference={onDuplicateReference(
                              tab.fileId,
                            )}
                            instanceHost={instanceHost}
                            suspended={
                              libraryOpen ||
                              snapshot.mutationsPaused ||
                              settingsView !== null ||
                              tab.fileId !== activeTabId
                            }
                            placing={placeTarget?.fileId === tab.fileId}
                            onPlace={(point) =>
                              placeReference(tab.fileId, point)
                            }
                            onCancelPlace={() => setPlaceTarget(null)}
                            onReferenceExisting={() => {
                              setPickerFileId(tab.fileId);
                              setLibraryOpen(true);
                            }}
                            onReady={frameReady(tab.fileId)}
                            linkHost={{
                              createLink: (target) =>
                                createWorkspaceLink({
                                  kind: 'cell',
                                  fileId: target.frameId,
                                  cellId: target.cellId,
                                }),
                              openLink: (href) =>
                                openPreviewLink(href, tab.fileId),
                            }}
                            navigation={
                              tab.fileId === activeTabId &&
                              navigationRequest?.target.fileId === tab.fileId
                                ? navigationRequest
                                : undefined
                            }
                            onNavigationResult={onNavigationResult}
                            mindDefaultWidth={
                              typeof snapshot.config.value[
                                'mindDefaultWidth'
                              ] === 'number'
                                ? (snapshot.config.value[
                                    'mindDefaultWidth'
                                  ] as number)
                                : undefined
                            }
                            saveStatus={persistenceForPage(tab.fileId).status}
                            lastSavedAt={
                              persistenceForPage(tab.fileId).lastSavedAt
                            }
                            onRetrySave={
                              workspaceActionState('workspace.save-retry')
                                .enabled
                                ? () => {
                                    void workspaceActions.executeAction(
                                      'workspace.save-retry',
                                    );
                                  }
                                : undefined
                            }
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
                    </WorkspaceContentBoundary>
                  );
                })}
              </div>
              {organizeRows ? (
                <OrganizePreview
                  actionSource={workspaceActions}
                  locale={locale}
                  owners={[...files.values()]
                    .filter((entry) => isRegularCanvas(entry.file))
                    .map((entry) => ({
                      frameId: entry.file.frame.id,
                      name:
                        entry.file.frame.name || canvasDisplayName(entry.path),
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
                    const frames = [...files.values()].map(
                      (entry) => entry.file,
                    );
                    const stale = (organizeRows ?? []).filter((row) => {
                      const file = files.get(row.fileId)?.file;
                      const sources = referenceSourcesOf(
                        frames,
                        row.fileId,
                      ).map((source) => source.fileId);
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
                            if (
                              !stale.some((item) => item.fileId === row.fileId)
                            )
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
                    void workspaceActions
                      .executeAction('workspace.organize', {
                        changes: organizeRows.map((row) => ({
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
                          basisSources: referenceSourcesOf(
                            frames,
                            row.fileId,
                          ).map((source) => source.fileId),
                        })),
                      })
                      .then(workspaceActionCommandResult)
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
                {snapshot.saveStatus === 'error' ||
                [...snapshot.filePersistence.values()].some(
                  (file) => file.status === 'error',
                ) ? (
                  <div
                    className="workspace-notice-banner is-error"
                    role="alert"
                    data-testid="workspace-save-error"
                  >
                    <span>
                      {locale === 'zh'
                        ? '工作区保存未完成，请重试、处理文件冲突，或修正内容后重新保存。'
                        : 'Workspace changes could not be saved. Retry, resolve conflicts, or correct the content and save again.'}
                    </span>
                    <button
                      type="button"
                      data-action-id="workspace.save-retry"
                      disabled={
                        !workspaceActionState('workspace.save-retry').enabled
                      }
                      onClick={() =>
                        void workspaceActions.executeAction(
                          'workspace.save-retry',
                        )
                      }
                    >
                      {workspaceActionName('workspace.save-retry')}
                    </button>
                  </div>
                ) : null}
                {snapshot.trashUnconfirmed && (
                  <div
                    className="workspace-notice-banner is-error"
                    role="alert"
                  >
                    <span>
                      {locale === 'zh'
                        ? '回收站操作结果尚未确认，请重试后继续编辑。'
                        : 'The trash operation is unconfirmed. Retry before continuing to edit.'}
                    </span>
                    <button
                      type="button"
                      data-testid="workspace-trash-retry"
                      data-action-id="workspace.trash.retry"
                      disabled={
                        !workspaceActionState('workspace.trash.retry').enabled
                      }
                      onClick={async () => {
                        const result = workspaceActionCommandResult(
                          await workspaceActions.executeAction(
                            'workspace.trash.retry',
                          ),
                        );
                        if (!result.ok)
                          notify(
                            result.diagnostics
                              .map((item) => item.message)
                              .join('; '),
                            'error',
                          );
                      }}
                    >
                      {workspaceActionName('workspace.trash.retry')}
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
                      data-action-id="workspace.conflict.keep-local"
                      disabled={
                        !workspaceActionState('workspace.conflict.keep-local', {
                          fileId: activeTab?.fileId,
                        }).enabled
                      }
                      onClick={() =>
                        activeTab &&
                        void workspaceActions.executeAction(
                          'workspace.conflict.keep-local',
                          { fileId: activeTab.fileId },
                        )
                      }
                    >
                      {workspaceActionName('workspace.conflict.keep-local')}
                    </button>
                    <button
                      type="button"
                      data-action-id="workspace.conflict.load-disk"
                      disabled={
                        !workspaceActionState('workspace.conflict.load-disk', {
                          fileId: activeTab?.fileId,
                        }).enabled
                      }
                      onClick={() =>
                        activeTab &&
                        void workspaceActions.executeAction(
                          'workspace.conflict.load-disk',
                          { fileId: activeTab.fileId },
                        )
                      }
                    >
                      {workspaceActionName('workspace.conflict.load-disk')}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </main>
          {settingsView === 'workspace' ? (
            <WorkspaceSettings
              actionSource={workspaceActions}
              trash={{
                actionSource: workspaceActions,
                entries: snapshot.trash,
                workspaceName,
                unconfirmed: snapshot.trashUnconfirmed,
                onRestore: async (entryId) => {
                  const result = await applyWorkspaceAction({
                    type: 'restore-file',
                    entryId,
                  });
                  if (!result.ok)
                    throw new Error(
                      result.diagnostics.map((item) => item.message).join('; '),
                    );
                },
                onPurge: async (entryIds) => {
                  const result = await applyWorkspaceAction({
                    type: 'purge-trash',
                    entryIds,
                  });
                  if (!result.ok)
                    throw new Error(
                      result.diagnostics.map((item) => item.message).join('; '),
                    );
                },
                onRetry: async () => {
                  const result = workspaceActionCommandResult(
                    await workspaceActions.executeAction(
                      'workspace.trash.retry',
                    ),
                  );
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
                void workspaceActions.executeAction(
                  'workspace.settings.patch',
                  patch,
                )
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
      </ActionScope>
    </FrameAutoCalculationProvider>
  );
}
