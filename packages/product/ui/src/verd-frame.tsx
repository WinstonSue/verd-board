import { UmlPalette, UmlProperties } from './frame-uml';
import { createUmlFrameExtensions } from '@sue/board-react-uml';
import { measureBoardText } from '@sue/board-react';
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import {
  FrameCanvas,
  FrameRichTextField,
  existingTextDocument,
  type FrameCanvasController,
  type FrameHistoryAdapter,
  type FrameInstanceHost,
  type FrameOpenSource,
} from '@sue/board-react';
export type { FrameInstanceHost, FrameOpenSource };
import { createArchitectureFrameExtensions } from '@sue/board-react-architecture';
import { createMindFrameExtensions } from '@sue/board-react-mind';
import { createWorkflowFrameExtensions } from '@sue/board-react-workflow';
import {
  stripFrameViewports,
  normalizeCellPositionOperations,
  roundNodeGeometry,
  roundNodeDimensions,
  createCellRegistry,
  deleteCells,
  selectionAllows,
  appearanceCells,
  lockedByAncestor,
  frameScene,
  createFrameCell,
  isFrameCell,
  isFrameReferenceCell,
  isNodeCell,
  isEdgeCell,
  isGroupCell,
  reorderCells,
  clearFrameCells,
  copyCellFragment,
  indexCells,
  ThemeColorMode,
  type CellOperation,
  type CellSelection,
  type CellChange,
  type FrameSnapshot,
  type NodeCell,
  type VectorLineData,
  setVectorLineShape,
  type WorkflowStartData,
  type ArchitectureLayerData,
} from '@sue/board-core';
import { registerDrawCells } from '@sue/board-draw';
import {
  createMindRootCell,
  createMindChildCell,
  addMindChild,
  createMindSummaries,
  mindChildIds,
} from '@sue/board-mind';
import {
  materializeWorkflowPositions,
  createWorkflowStartCell,
  createWorkflowTaskCell,
  addWorkflowTask,
} from '@sue/board-workflow';
import {
  materializeArchitecturePositions,
  createArchitectureLayerCell,
  createArchitectureModuleCell,
  addArchitectureModule,
  moveArchitectureModuleToLayer,
  reorderArchitectureLayers,
} from '@sue/board-architecture';
import { createInlineText } from '@sue/board-common';
import { useI18n } from './i18n';
import { FrameSaveStatus } from './frame-save-status';
import { FrameImportDialog } from './frame-import-dialog';
import { FrameImageExportDialog } from './frame-image-export-dialog';
import { FrameMindProperties, MindSchemeField } from './frame-mind-properties';
import { FrameSelectionAppearance } from './frame-selection-appearance';
import { FramePropertyPanel, FramePropertyGroup } from './frame-property-panel';
import { FramePropertyNumber } from './frame-property-number';
import { hasSelectionText, FrameSelectionText } from './frame-selection-text';
import { FrameClearDialog } from './frame-clear-dialog';
import { Tutorial } from './components/tutorial';
import { FrameArrangement } from './frame-arrangement';
import { FrameActionsPopover } from './frame-actions-popover';
import {
  createFrameViewStateStore,
  FrameRecenterControl,
  FrameZoomControls,
  useFrameStructuralViewState,
} from './frame-view-state';
import { FrameIconButton } from './frame-icon-button';
import { FrameShapePicker } from './frame-shape-picker';
import { FrameToolMenu } from './frame-tool-menu';
import { FrameAppMenu, type FrameAppMenuItem } from './frame-app-menu';
import { MyPage } from './my-page';
import { ShortcutHelp } from './shortcut-help';
import { shortcutLabels } from './shortcut-catalog';
import { useInteractionPreferences } from './interaction-preferences';
import { useAppearancePreference } from './appearance-preferences';
import { useMindMaxWidth } from './mind-preferences';
import {
  ArrowRight,
  Keyboard,
  BringToFront,
  SendToBack,
  ArrowUp,
  ArrowDown,
  ArrowLeftRight,
  Boxes,
  Columns3,
  Download,
  Eraser,
  FileImage,
  FileInput,
  FileText,
  FolderOpen,
  Frame,
  Hand,
  Image as ImageIcon,
  Minus,
  MousePointer2,
  Network,
  PanelRight,
  Presentation,
  Pencil,
  Redo2,
  UserRound,
  Spline,
  Square,
  Table2,
  Trash2,
  Type,
  Undo2,
  Workflow,
} from 'lucide-react';
import { openFrameOperations } from './frame-open';
import { PresentationMode } from './presentation/presentation-mode';
import { hasVisibleContent } from './presentation/presentation-targets';
import {
  requestPresentationFullscreen,
  exitPresentationFullscreen,
} from './presentation/fullscreen-owner';
import './presentation/presentation.scss';
import { isFrameSnapshot } from './frame-open';
import { frameDrawExtensions } from './frame-draw-extension';
import { createFrameDrawingTool } from './frame-drawing-tool';
import './styles/frame.scss';

export interface VerdFrameProps {
  documentReferences?: import('@sue/board-react').FrameDocumentReferences;
  onReferenceDocument?(): void;
  onCreateDocumentFrame?(): void;
  onExportNative?(): void;
  onOpenMy?(): void;
  value: FrameSnapshot;
  frameId: string;
  initialFocusCellId?: string;
  onChange(change: CellChange): void;
  onOpenFrame(frameId: string, source?: FrameOpenSource): void;
  instanceHost?: FrameInstanceHost;
  suspended?: boolean;
  placing?: boolean;
  onPlace?(point: [number, number]): void;
  onCancelPlace?(): void;
  onReferenceExisting?(): void;
  /** Re-run locate on an already mounted tab. */
  revealCellId?: string | null;
  revealNonce?: number;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt?: number;
  onRetrySave?(): void;
  detachedFrameIds?: string[];
  /** Legacy VerdBoard and Drawnix files. Parsing must not write storage. */
  parseLegacy?(definition: string, filename: string): Promise<FrameSnapshot>;
  /**
   * Workspace hook: duplicates each selected frame-reference's target
   * closure, breaking future sharing. Absent in single-file hosts.
   */
  onDuplicateReference?(refIds: string[]): void;
  /** Workspace-scoped mind default; explicit node widths always win. */
  mindDefaultWidth?: number;
  /**
   * Workspace history source. When provided, undo/redo shortcuts and buttons
   * delegate to the shared chronological history instead of the frame-local
   * runtime stack.
   */
  history?: FrameHistoryAdapter;
  readonly?: boolean;
}
const id = () => crypto.randomUUID();
const shapes = [
  'rectangle',
  'roundRectangle',
  'ellipse',
  'diamond',
  'triangle',
  'parallelogram',
  'trapezoid',
  'leftArrow',
  'rightArrow',
  'cross',
  'star',
  'pentagon',
  'hexagon',
  'octagon',
  'pentagonArrow',
  'processArrow',
  'twoWayArrow',
  'comment',
  'roundComment',
  'cloud',
  'process',
  'decision',
  'data',
  'connector',
  'terminal',
  'manualInput',
  'preparation',
  'manualLoop',
  'merge',
  'delay',
  'storedData',
  'or',
  'summingJunction',
  'predefinedProcess',
  'offPage',
  'document',
  'multiDocument',
  'database',
  'hardDisk',
  'internalStorage',
  'noteCurlyRight',
  'noteCurlyLeft',
  'noteSquare',
  'display',
  'actor',
  'useCase',
  'container',
  'note',
  'simpleClass',
  'activityClass',
  'branchMerge',
  'port',
  'package',
  'combinedFragment',
  'class',
  'interface',
  'object',
  'component',
  'componentBox',
  'template',
  'activation',
  'deletion',
  'assembly',
  'providedInterface',
  'requiredInterface',
];

export function VerdFrame({
  value,
  frameId,
  initialFocusCellId,
  onChange,
  onOpenFrame,
  saveStatus,
  lastSavedAt,
  onRetrySave,
  detachedFrameIds = [],
  parseLegacy,
  onDuplicateReference,
  mindDefaultWidth,
  history,
  readonly = false,
  instanceHost,
  suspended = false,
  placing = false,
  onPlace,
  onCancelPlace,
  onReferenceExisting,
  onReferenceDocument,
  onCreateDocumentFrame,
  documentReferences,
  onExportNative,
  onOpenMy,
  revealCellId,
  revealNonce = 0,
}: VerdFrameProps) {
  useAppearancePreference();
  const controller = useRef<FrameCanvasController>(null);
  const { t, language } = useI18n();
  const interactionSettings = useInteractionPreferences();
  const mindPreference = useMindMaxWidth();
  const mindMaxWidth = mindDefaultWidth ?? mindPreference;
  const [fontVersion, setFontVersion] = useState(0);
  useEffect(() => {
    const changed = () => setFontVersion((value) => value + 1);
    document.addEventListener('board-text-fonts-changed', changed);
    return () =>
      document.removeEventListener('board-text-fonts-changed', changed);
  }, []);
  const [myOpen, setMyOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<CellSelection>({
    focus: [frameId],
    ids: [],
  });
  const [instanceSelection, setInstanceSelection] =
    useState<CellSelection | null>(null);
  const activeInstanceId = useRef<string | null>(null);
  const [pointer, setPointer] = useState('select');
  const [shape, setShape] = useState('rectangle');
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const imageRequest = useRef(0);
  useEffect(() => {
    imageRequest.current++;
  }, [pointer, readonly]);
  const [pen, setPen] = useState<
    'nibPen' | 'feltTipPen' | 'artisticBrush' | 'markerHighlight'
  >('feltTipPen');
  const [textImport, setTextImport] = useState(false);
  const [imageExport, setImageExport] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [stylusMode, setStylusMode] = useState(false);
  const [tutorialSkipped, setTutorialSkipped] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [actions, setActions] = useState<{
    point: [number, number];
    selection: CellSelection;
  } | null>(null);
  const setActionsPoint = useCallback(
    (point: [number, number] | null) =>
      setActions(
        point && {
          point: [...point],
          selection: structuredClone(
            controller.current?.runtime.selection ?? {
              focus: [frameId],
              ids: [],
            },
          ),
        },
      ),
    [frameId],
  );
  useEffect(() => {
    if (
      actions &&
      (readonly ||
        JSON.stringify(actions.selection) !== JSON.stringify(selection) ||
        actions.selection.ids.some((id) => !value.store.cells[id]))
    )
      setActions(null);
  }, [actions, selection, readonly, value.store]);
  const viewStateStore = useMemo(createFrameViewStateStore, []);
  const viewState = useFrameStructuralViewState(viewStateStore);
  useEffect(() => {
    if (viewState?.readonly) setActions(null);
  }, [viewState?.readonly]);
  const [busy, setBusy] = useState(false);
  const shapeFloating = useFloating({
    open: shapePickerOpen,
    onOpenChange: setShapePickerOpen,
    placement: 'right-start',
    strategy: 'fixed',
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableWidth, availableHeight, elements }) {
          elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });
  const shapeDismiss = useDismiss(shapeFloating.context);
  const shapeRole = useRole(shapeFloating.context, { role: 'dialog' });
  const shapeInteractions = useInteractions([shapeDismiss, shapeRole]);
  useEffect(() => {
    if (readonly) setShapePickerOpen(false);
  }, [pointer, readonly]);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const [presenting, setPresenting] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const exitPresentation = useCallback(() => {
    setPresenting(false);
    exitPresentationFullscreen(rootRef.current);
    const focus = previousFocus.current;
    requestAnimationFrame(() => {
      if (focus?.isConnected) focus.focus();
    });
  }, []);
  const startPresentation = () => {
    controller.current?.finishEditing();
    previousFocus.current = document.activeElement as HTMLElement | null;
    setPresenting(true);
    const root = rootRef.current;
    // Keep the fullscreen request inside the original user gesture.
    if (root) requestPresentationFullscreen(root);
  };
  useEffect(() => {
    if (suspended) exitPresentation();
  }, [suspended, exitPresentation]);
  useEffect(() => {
    const root = rootRef.current;
    return () => {
      exitPresentationFullscreen(root);
    };
  }, []);
  const bottomControls = useRef<HTMLDivElement>(null);
  const appToolbar = useRef<HTMLDivElement>(null);
  const [chromeHeight, setChromeHeight] = useState({
    bottom: 40,
    toolbar: 42,
  });
  useLayoutEffect(() => {
    const measure = () => {
      const bottom = bottomControls.current?.getBoundingClientRect().height,
        toolbar = appToolbar.current?.getBoundingClientRect().height;
      setChromeHeight((current) => {
        const next = {
          bottom: bottom ? Math.ceil(bottom) : current.bottom,
          toolbar: toolbar ? Math.ceil(toolbar) : current.toolbar,
        };
        return next.bottom === current.bottom &&
          next.toolbar === current.toolbar
          ? current
          : next;
      });
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(measure);
    if (bottomControls.current) observer?.observe(bottomControls.current);
    if (appToolbar.current) observer?.observe(appToolbar.current);
    return () => observer?.disconnect();
  }, [inspectorOpen]);
  const [markdownPreview, setMarkdownPreview] = useState<string | null>(null);
  const [markdownName, setMarkdownName] = useState('verd-frame.md');
  const [noteRequest, setNoteRequest] = useState<{
    id: string;
    sequence: number;
  } | null>(null);
  const noteRequestSequence = useRef(0);
  useEffect(() => {
    setSelection({ focus: [frameId], ids: [] });
    setPointer('select');
    setShapePickerOpen(false);
    imageRequest.current++;
    setActionsPoint(null);
    setClearConfirm(false);
    setTransferTarget('');
  }, [frameId, setActionsPoint]);
  const imageInput = useRef<HTMLInputElement>(null),
    importInput = useRef<HTMLInputElement>(null),
    openInput = useRef<HTMLInputElement>(null);
  const registry = useMemo(() => {
    const registry = createCellRegistry();
    registerDrawCells(registry);
    return registry;
  }, []);
  const extensions = useMemo(() => {
    // Font changes invalidate the extension's immutable-store layout cache.
    void fontVersion;
    return [
      ...createMindFrameExtensions(registry, {
        maxNodeWidth: mindMaxWidth,
        measureText: (text, width, fontSize) =>
          measureBoardText(text, width, fontSize, 'system-ui, sans-serif'),
      }),
      ...createWorkflowFrameExtensions(registry),
      ...createArchitectureFrameExtensions(registry),
      ...createUmlFrameExtensions(registry),
      ...frameDrawExtensions,
    ];
  }, [registry, mindMaxWidth, fontVersion]);
  const store = value.store,
    frame = store.cells[frameId];
  const canPresent = useMemo(
    () => hasVisibleContent(store, frameId),
    [store, frameId],
  );
  useEffect(() => {
    if (isFrameCell(frame) && frameId === store.rootId && frame.children.length)
      setTutorialSkipped(true);
  }, [frame, frameId, store.rootId]);
  useEffect(() => {
    if (revealCellId) controller.current?.revealCell(revealCellId);
  }, [revealCellId, revealNonce]);
  const scene = frameScene(store, frameId);
  const selectionFrameId =
    [...selection.focus].reverse().find((id) => isFrameCell(store.cells[id])) ??
    frameId;
  const uiSelection = instanceSelection ?? selection;
  const selected = uiSelection.ids.map((id) => store.cells[id]).filter(Boolean);
  const cell = selected.length === 1 ? selected[0] : undefined;
  const inspectorTitle = cell
    ? ((
        {
          'mind-root': language === 'zh' ? '中心主题' : 'Central topic',
          'mind-child': language === 'zh' ? '主题' : 'Topic',
          'mind-summary': language === 'zh' ? '概要' : 'Summary',
          'mind-branch': language === 'zh' ? '分支' : 'Branch',
          geometry: language === 'zh' ? '形状' : 'Shape',
          arrow: language === 'zh' ? '连线' : 'Connector',
          image: language === 'zh' ? '图片' : 'Image',
          frame: language === 'zh' ? '容器' : 'Frame',
          'frame-reference': language === 'zh' ? '容器' : 'Frame',
          'document-frame': language === 'zh' ? '文档 Frame' : 'Document Frame',
          'document-reference':
            language === 'zh' ? '文档 Frame' : 'Document frame',
          group: language === 'zh' ? '组合' : 'Group',
          text: language === 'zh' ? '文本' : 'Text',
          'workflow-start': language === 'zh' ? '工作流' : 'Workflow',
          'workflow-task': language === 'zh' ? '任务' : 'Task',
          'workflow-decision': language === 'zh' ? '判断' : 'Decision',
          'architecture-layer':
            language === 'zh' ? '架构层' : 'Architecture layer',
          'architecture-module':
            language === 'zh' ? '架构模块' : 'Architecture module',
          'uml-class': language === 'zh' ? 'UML 分类器' : 'UML classifier',
          'uml-relation': language === 'zh' ? 'UML 关系' : 'UML relation',
          'uml-participant': language === 'zh' ? '参与者' : 'Participant',
          'uml-message': language === 'zh' ? '消息' : 'Message',
          'uml-note': language === 'zh' ? '注释' : 'Note',
          'uml-fragment':
            language === 'zh' ? '交互片段' : 'Interaction fragment',
          'vector-line': language === 'zh' ? '路径' : 'Path',
          table: language === 'zh' ? '表格' : 'Table',
          swimlane: language === 'zh' ? '泳道' : 'Swimlane',
        } as Record<string, string>
      )[cell.kind] ?? (language === 'zh' ? '对象' : 'Object'))
    : selected.length > 1
      ? language === 'zh'
        ? `已选择 ${selected.length} 个对象`
        : `${selected.length} objects selected`
      : language === 'zh'
        ? '画布设置'
        : 'Canvas settings';
  const nameText =
    cell && isNodeCell(cell)
      ? (existingTextDocument(cell.content?.text) ??
        createInlineText(cell.content?.label ?? ''))
      : undefined;
  const displayedGeometry = useMemo(
    () =>
      cell && isNodeCell(cell)
        ? extensions.reduce(
            (geometry, extension) =>
              (() => {
                const layout = extension
                  .layout?.(store, selectionFrameId)
                  ?.get(cell.id);
                return layout ? roundNodeGeometry(layout) : geometry;
              })(),
            cell.geometry,
          )
        : undefined,
    [cell, extensions, store, selectionFrameId],
  );
  const transferTargets = useMemo(() => {
    if (!selection.ids.length || frameScene(store, selectionFrameId)) return [];
    const closure = copyCellFragment(store, selection.ids);
    const parents = indexCells(store).parentOf;
    const top = (id: string) => {
      while (parents.has(id)) id = parents.get(id)!;
      return id;
    };
    return Object.values(store.cells)
      .filter(isFrameCell)
      .filter(
        (target) =>
          target.id !== selectionFrameId &&
          !frameScene(store, target.id) &&
          !closure.cells[target.id] &&
          !target.locked &&
          top(target.id) === top(selectionFrameId),
      );
  }, [store, selection.ids, selectionFrameId]);
  const labels =
    language === 'zh'
      ? {
          select: '选择',
          hand: '手型',
          shape: '形状',
          connectors: '连线',
          diagrams: '图表',
          text: '文本',
          pen: '画笔',
          erase: '橡皮擦',
          arrow: '箭头',
          line: '直线',
          curve: '曲线',
          'vector-line': '折线',
          table: '表格',
          swimlane: '泳道',
          image: '图片',
          frame: '容器',
          open: '打开详情',
          group: '分组',
          ungroup: '取消分组',
          undo: '撤销',
          redo: '重做',
          fit: '适配画布',
          delete: '删除',
          save: '保存',
          export: '导出',
          import: '导入',
          layers: '图层',
        }
      : {
          select: 'Select',
          hand: 'Hand',
          shape: 'Shape',
          connectors: 'Connectors',
          diagrams: 'Diagrams',
          text: 'Text',
          pen: 'Pen',
          erase: 'Eraser',
          arrow: 'Arrow',
          line: 'Line',
          curve: 'Curve',
          'vector-line': 'Polyline',
          table: 'Table',
          swimlane: 'Swimlane',
          image: 'Image',
          frame: 'Frame',
          open: 'Open details',
          group: 'Group',
          ungroup: 'Ungroup',
          undo: 'Undo',
          redo: 'Redo',
          fit: 'Fit canvas',
          delete: 'Delete',
          save: 'Save',
          export: 'Export',
          import: 'Import',
          layers: 'Layers',
        };
  const dispatch = (
    operations: CellOperation[],
    restoreView = false,
    roundPositions = true,
  ) => {
    if (roundPositions)
      operations = normalizeCellPositionOperations(
        controller.current?.runtime.store ?? store,
        operations,
      );
    if (!operations.length)
      return Promise.resolve({ status: 'accepted' as const });
    setBusy(true);
    const transaction = {
      id: id(),
      operations,
      restoreView,
    };
    const committed =
      activeInstanceId.current && instanceHost
        ? instanceHost.commit(activeInstanceId.current, transaction)
        : controller.current?.dispatch(transaction);
    return (
      committed ??
      Promise.resolve({
        status: 'rejected' as const,
        message: 'Canvas is unavailable',
      })
    )
      .then((result) => {
        setFailure(
          result.status === 'rejected'
            ? (result.message ?? 'Edit rejected')
            : null,
        );
        return result;
      })
      .finally(() => setBusy(false));
  };
  const replace = (
    next: import('@sue/board-core').Cell | undefined,
    restoreView = false,
  ) => {
    if (!next) return;
    const current = store.cells[next.id];
    if (current && (current.locked || lockedByAncestor(store, next.id))) {
      const unlocking =
        current.locked &&
        !next.locked &&
        !lockedByAncestor(store, next.id) &&
        JSON.stringify({ ...current, locked: false }) ===
          JSON.stringify({ ...next, locked: false });
      if (!unlocking) return;
    }
    dispatch([{ type: 'replace_cell', cell: next }], restoreView);
  };
  const inspectorDisabled = busy || readonly || !!viewState?.readonly;
  const inspectorIdentity = JSON.stringify([
    frameId,
    uiSelection,
    activeInstanceId.current,
  ]);
  const getInspectorStore = () => {
    const runtime = controller.current?.runtime;
    if (
      !runtime ||
      readonly ||
      viewStateStore.getSnapshot()?.readonly ||
      (!activeInstanceId.current &&
        JSON.stringify(runtime.selection) !== JSON.stringify(uiSelection))
    )
      return undefined;
    if (
      uiSelection.ids.some(
        (id) =>
          !runtime.store.cells[id] ||
          runtime.store.cells[id].locked ||
          lockedByAncestor(runtime.store, id),
      )
    )
      return undefined;
    return runtime.store;
  };
  const getInspectorNode = (
    cellId: string,
    capability: 'edit' | 'move' | 'resize' = 'edit',
  ) => {
    const latestStore = getInspectorStore();
    const latest = latestStore?.cells[cellId];
    return latestStore &&
      isNodeCell(latest) &&
      selectionAllows(latestStore, [cellId], registry, capability, frameId)
      ? latest
      : undefined;
  };
  const getInspectorEditStore = () => {
    const latest = getInspectorStore();
    return latest &&
      selectionAllows(latest, uiSelection.ids, registry, 'edit', frameId)
      ? latest
      : undefined;
  };
  const inspectorEditable =
    !inspectorDisabled &&
    selectionAllows(store, uiSelection.ids, registry, 'edit', frameId);
  const activeAnchor = (kind: string) => {
    if (!isFrameCell(frame)) return undefined;
    const owner =
      cell && controller.current?.runtime.index.domainOwnerOf.get(cell.id);
    const candidate = owner ? store.cells[owner] : undefined;
    if (candidate?.kind === kind) return candidate;
    return frame.children
      .map((id) => store.cells[id])
      .find((cell) => cell.kind === kind);
  };
  const addDomainNode = (kind: string) => {
    if (scene === 'workflow-start') {
      const start = activeAnchor('workflow-start');
      if (start)
        dispatch(
          addWorkflowTask(
            store,
            start.id,
            createWorkflowTaskCell(id(), kind === 'decision'),
          ),
        );
    } else if (scene === 'architecture-layer') {
      const layer =
        cell?.kind === 'architecture-layer'
          ? cell
          : activeAnchor('architecture-layer');
      if (layer)
        dispatch(
          addArchitectureModule(
            store,
            layer.id,
            createArchitectureModuleCell(
              id(),
              kind as 'box' | 'decision' | 'store',
            ),
          ),
        );
    } else if (scene === 'mind-root') {
      const parent =
        cell && ['mind-root', 'mind-child'].includes(cell.kind)
          ? cell
          : activeAnchor('mind-root');
      if (parent)
        dispatch(
          addMindChild(store, parent.id, createMindChildCell(id()), id()),
        );
    }
  };
  const summaryParent =
    selected.length && selected.every((node) => node.kind === 'mind-child')
      ? Object.values(store.cells).find(
          (edge) =>
            isEdgeCell(edge) &&
            edge.kind === 'mind-branch' &&
            'cellId' in edge.target &&
            edge.target.cellId === selected[0].id,
        )
      : undefined;
  const summarySiblings =
    isEdgeCell(summaryParent) && 'cellId' in summaryParent.source
      ? mindChildIds(store, summaryParent.source.cellId)
      : [];
  const canSummarize =
    !!summaryParent &&
    selected.every((node) => summarySiblings.includes(node.id));
  const addSummary = () => {
    if (
      !canSummarize ||
      !isEdgeCell(summaryParent) ||
      !('cellId' in summaryParent.source)
    )
      return;
    dispatch(
      createMindSummaries(
        store,
        summaryParent.source.cellId,
        selection.ids,
        () => id(),
      ),
    );
  };
  const drawing = useMemo(
    () =>
      createFrameDrawingTool({
        pointer,
        shape,
        pen,
        onComplete: () => {
          setPointer('select');
          setShapePickerOpen(false);
        },
      }),
    [pointer, shape, pen],
  );
  const commitText = (
    cellId: string,
    text: import('@sue/board-common').BoardTextDocument,
    labelIndex?: number,
  ) => {
    const latest = controller.current?.runtime.store.cells[cellId];
    if (
      !latest ||
      !controller.current ||
      !selectionAllows(
        controller.current.runtime.store,
        [cellId],
        controller.current.runtime.registry,
        'edit',
        controller.current.runtime.mountedRootId,
      )
    )
      return Promise.resolve({ status: 'rejected' as const });
    if (isNodeCell(latest))
      return dispatch([
        {
          type: 'replace_cell',
          cell: {
            ...latest,
            content: { ...latest.content, label: text.plainText, text },
          },
        },
      ]);
    if (!isEdgeCell(latest) || labelIndex === undefined)
      return Promise.resolve({ status: 'rejected' as const });
    const labels = [...(latest.labels ?? [])];
    const current = labels[labelIndex] ?? { text: '', position: 0.5 };
    labels[labelIndex] = {
      ...current,
      text: text.plainText,
      richText: text,
    };
    return dispatch([{ type: 'replace_cell', cell: { ...latest, labels } }]);
  };
  const setTheme = (mode: ThemeColorMode) => {
    if (isFrameCell(frame))
      dispatch(
        [
          {
            type: 'replace_cell',
            cell: {
              ...frame,
              view: {
                ...frame.view,
                theme: {
                  ...frame.view?.theme,
                  themeColorMode: mode,
                  boardBackground:
                    mode === ThemeColorMode.dark
                      ? '#141414'
                      : mode === ThemeColorMode.starry
                        ? '#0d2537'
                        : '#f8fafc',
                },
              },
            },
          },
        ],
        true,
      );
  };
  const addImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    const request = ++imageRequest.current;
    const runtime = controller.current?.runtime;
    const previousSelection = runtime?.selection;
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const image = new Image();
      image.src = url;
      await image.decode();
      if (
        request !== imageRequest.current ||
        !runtime ||
        runtime !== controller.current?.runtime ||
        runtime.selection.focus[0] !== frameId ||
        runtime.selection !== previousSelection ||
        readonly
      )
        return;
      const scale = Math.min(1, 600 / image.width, 400 / image.height);
      const imageId = id();
      const result = await dispatch([
        {
          type: 'insert_cell',
          parentId: frameId,
          cell: {
            id: imageId,
            kind: 'image',
            cellType: 'node',
            geometry: {
              x: 80,
              y: 80,
              width: image.width * scale,
              height: image.height * scale,
            },
            data: { url },
          },
        },
      ]);
      if (
        result.status === 'accepted' &&
        request === imageRequest.current &&
        controller.current?.runtime === runtime &&
        runtime.store.cells[imageId]
      ) {
        runtime.select({ focus: [frameId], ids: [imageId] });
        setSelection(runtime.selection);
        setPointer('select');
        setShapePickerOpen(false);
      }
    } catch (error) {
      if (request === imageRequest.current)
        setFailure(
          error instanceof Error ? error.message : 'Image could not be loaded',
        );
    } finally {
      input.value = '';
    }
  };
  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const mountedSnapshot = async (
    targetId = frameId,
  ): Promise<FrameSnapshot> => {
    const { copyCellFragment } = await import('@sue/board-core');
    return {
      store: {
        rootId: targetId,
        cells: copyCellFragment(store, [targetId]).cells,
      },
    };
  };
  const exportFile = async (
    format: 'json' | 'markdown' | 'mermaid' = 'json',
    targetId = frameId,
  ) => {
    try {
      if (format === 'json' && onExportNative) {
        onExportNative();
        return;
      }
      const snapshot = await mountedSnapshot(targetId);
      if (
        format !== 'json' &&
        Object.values(snapshot.store.cells).some((cell) =>
          ['document-reference', 'document-frame'].includes(cell.kind),
        )
      )
        throw new Error(
          '文档引用无法导出为 Markdown/Mermaid，请使用原生或图片导出。',
        );
      if (format === 'markdown') {
        const { serializeFrameToMarkdown } =
          await import('@sue/board-markdown-to-board');
        const markdown = serializeFrameToMarkdown(snapshot);
        const target = snapshot.store.cells[targetId];
        // Preview first — the user picks copy or download, never both.
        setMarkdownPreview(markdown);
        setMarkdownName(
          `${
            (isNodeCell(target) ? target.name : undefined)?.trim() ||
            targetId ||
            'verd-frame'
          }.md`,
        );
      } else if (format === 'mermaid') {
        const { serializeFrameToMermaid } =
          await import('@sue/board-mermaid-to-board');
        download(
          new Blob([serializeFrameToMermaid(snapshot)], { type: 'text/plain' }),
          'verd-frame.mmd',
        );
      } else
        download(
          new Blob([JSON.stringify(snapshot, null, 2)], {
            type: 'application/json',
          }),
          'verd-frame.json',
        );
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };
  const importSnapshot = async (snapshot: FrameSnapshot) => {
    snapshot = {
      store: materializeArchitecturePositions(
        materializeWorkflowPositions(snapshot.store),
      ),
    };
    const root = snapshot?.store?.cells[snapshot.store.rootId];
    if (!isFrameCell(root)) throw new Error('Invalid imported FrameSnapshot');
    const { copyCellFragment, planCellPaste, validateCellStore } =
      await import('@sue/board-core');
    const issues = validateCellStore(snapshot.store, registry);
    if (issues.length)
      throw new Error(issues.map((issue) => issue.message).join('; '));
    const importedScene = frameScene(snapshot.store, root.id);
    // Mind-to-mind imports park the whole block right of existing content;
    // only root coordinates move — children re-derive their positions.
    if (importedScene === 'mind-root' && scene === 'mind-root') {
      const { mindLayoutBounds, offsetMindTreeRoots } =
        await import('@sue/board-mind');
      const existing = mindLayoutBounds(store, frameId);
      const incoming = mindLayoutBounds(snapshot.store, root.id);
      if (existing && incoming)
        snapshot = {
          store: offsetMindTreeRoots(
            snapshot.store,
            root.id,
            existing.x + existing.width + 80 - incoming.x,
            existing.y - incoming.y,
          ),
        };
    }
    const result = await controller.current?.dispatch({
      id: id(),
      operations: planCellPaste({
        store,
        frameId,
        selectionIds: selection.ids,
        fragment: copyCellFragment(
          snapshot.store,
          importedScene !== scene
            ? [root.id]
            : [...root.children, ...root.groups],
        ),
        allocateId: () => id(),
        offset: [0, 0],
        registry,
        intent: 'import',
      }).operations,
    });
    if (!result || result.status === 'rejected')
      throw new Error(result?.message ?? 'Import rejected');
    setFailure(null);
    controller.current?.fit();
  };
  const readDocument = async (file: File): Promise<FrameSnapshot> => {
    const definition = await file.text();
    if (/\.(?:md|markdown)$/i.test(file.name)) {
      if (!definition.trim()) throw new Error('Empty Markdown file');
      const { parseMarkdownToFrameSnapshot } =
        await import('@sue/board-markdown-to-board');
      return parseMarkdownToFrameSnapshot(definition, undefined, {
        fallbackTitle: file.name.replace(/\.(?:md|markdown)$/i, ''),
      });
    }
    if (/\.(?:mmd|mermaid)$/i.test(file.name))
      return (
        await import('@sue/board-mermaid-to-board')
      ).parseMermaidToFrameSnapshot(definition, {
        scene:
          scene === 'workflow-start'
            ? 'workflow'
            : scene === 'architecture-layer'
              ? 'architecture'
              : scene === 'uml-class-root'
                ? 'uml-class'
                : scene === 'uml-sequence-root'
                  ? 'uml-sequence'
                  : 'whiteboard',
      });
    let parsed: unknown;
    try {
      parsed = JSON.parse(definition);
    } catch {
      throw new Error('Invalid file');
    }
    if (isFrameSnapshot(parsed)) {
      const issues = (await import('@sue/board-core')).validateCellStore(
        parsed.store,
        registry,
      );
      if (issues.length)
        throw new Error(issues.map((issue) => issue.message).join('; '));
      return { store: stripFrameViewports(parsed.store) };
    }
    if (!parseLegacy) throw new Error('Unsupported file');
    return parseLegacy(definition, file.name);
  };
  const openDocument = async (file: File) => {
    const loaded = await readDocument(file);
    const snapshot = {
      store: materializeArchitecturePositions(
        materializeWorkflowPositions(loaded.store),
      ),
    };
    const operations = openFrameOperations(
      store,
      frameId,
      snapshot,
      () => id(),
      registry,
    );
    const result = await dispatch(operations, true, false);
    if (!result || result.status === 'rejected')
      throw new Error(result?.message ?? 'Open rejected');
    controller.current?.fit();
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await importSnapshot(await readDocument(file));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
    event.target.value = '';
  };
  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await openDocument(file);
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
    event.target.value = '';
  };
  const editDisabled = busy || readonly || !!viewState?.readonly;
  const appMenuItems: FrameAppMenuItem[] = [
    {
      id: 'open',
      label: t('menu.open'),
      icon: FolderOpen,
      group: 'import',
      disabled: editDisabled,
      onSelect: () => openInput.current?.click(),
    },
    {
      id: 'import',
      label: t('menu.import'),
      icon: FileInput,
      group: 'import',
      disabled: editDisabled,
      onSelect: () => importInput.current?.click(),
    },
    {
      id: 'import-text',
      label: t('menu.importText'),
      icon: FileText,
      group: 'import',
      disabled: editDisabled,
      onSelect: () => setTextImport(true),
    },
    {
      id: 'export',
      label: t('menu.export'),
      icon: Download,
      group: 'export',
      disabled: busy,
      onSelect: () => void exportFile(),
    },
    {
      id: 'export-image',
      label: t('menu.exportImage'),
      icon: FileImage,
      group: 'export',
      disabled: busy,
      shortcut: '⇧⌘E',
      onSelect: () => setImageExport(true),
    },
  ];
  const mindReferenceTarget =
    cell && isFrameReferenceCell(cell) ? cell.data.targetFrameId : undefined;
  const mindExportTarget =
    cell && isFrameCell(cell) && frameScene(store, cell.id) === 'mind-root'
      ? cell.id
      : mindReferenceTarget &&
          store.cells[mindReferenceTarget] &&
          frameScene(store, mindReferenceTarget) === 'mind-root'
        ? mindReferenceTarget
        : undefined;
  if (
    scene === 'mind-root' ||
    mindExportTarget ||
    (cell && isFrameReferenceCell(cell))
  ) {
    appMenuItems.push({
      id: 'export-markdown',
      label: t('menu.exportMarkdown'),
      icon: FileText,
      group: 'export',
      disabled: busy,
      onSelect: () => {
        // A selected frame-reference exports its source mind file; a
        // missing target is reported instead of dumping the board.
        const target =
          mindExportTarget ?? (scene === 'mind-root' ? frameId : undefined);
        if (!target) {
          setFailure(
            cell && isFrameReferenceCell(cell)
              ? '引用的 Mind 文件不存在，无法导出'
              : '没有可导出的 Mind 内容',
          );
          return;
        }
        void exportFile('markdown', target);
      },
    });
  }
  if (
    scene === 'workflow-start' ||
    scene === 'architecture-layer' ||
    scene === 'uml-class-root' ||
    scene === 'uml-sequence-root'
  ) {
    appMenuItems.push({
      id: 'export-mermaid',
      label: t('menu.exportMermaid'),
      icon: FileText,
      group: 'export',
      disabled: busy,
      onSelect: () => void exportFile('mermaid'),
    });
  }
  if (onReferenceExisting)
    appMenuItems.push({
      id: 'reference-existing',
      label: language === 'zh' ? '引用已有…' : 'Reference existing…',
      icon: FolderOpen,
      group: 'import',
      disabled: editDisabled || placing,
      onSelect: onReferenceExisting,
    });
  if (onCreateDocumentFrame && !frameScene(store, frameId))
    appMenuItems.push({
      id: 'document-frame',
      label: language === 'zh' ? '文档 Frame…' : 'Document Frame…',
      icon: FileText,
      group: 'import',
      disabled: editDisabled || placing,
      onSelect: onCreateDocumentFrame,
    });
  if (onReferenceDocument)
    appMenuItems.push({
      id: 'reference-document',
      label:
        language === 'zh'
          ? '引用文档（只读）…'
          : 'Reference document (read-only)…',
      icon: FileText,
      group: 'import',
      disabled: editDisabled || placing,
      onSelect: onReferenceDocument,
    });
  appMenuItems.push(
    {
      id: 'clear',
      label: t('menu.clear'),
      icon: Trash2,
      group: 'clear',
      disabled: editDisabled,
      onSelect: () => setClearConfirm(true),
    },
    {
      id: 'shortcuts',
      label: shortcutLabels[language].title,
      icon: Keyboard,
      group: 'settings',
      onSelect: () => setShortcutsOpen(true),
    },
    {
      id: 'my',
      label: language === 'zh' ? '我的' : 'My',
      icon: UserRound,
      group: 'settings',
      onSelect: () => (onOpenMy ? onOpenMy() : setMyOpen(true)),
    },
  );
  return (
    <div
      ref={rootRef}
      className={`verd-frame verd-board${inspectorOpen ? ' sidebar-open' : ''}`}
      style={
        {
          '--frame-bottom-controls-height': `${chromeHeight.bottom}px`,
          '--frame-app-toolbar-height': `${chromeHeight.toolbar}px`,
        } as CSSProperties
      }
      data-testid={
        scene === 'mind-root'
          ? 'verd-mind'
          : scene === 'workflow-start'
            ? 'verd-workflow'
            : scene === 'architecture-layer'
              ? 'verd-architecture'
              : scene === 'uml-class-root'
                ? 'verd-uml-class'
                : scene === 'uml-sequence-root'
                  ? 'verd-uml-sequence'
                  : 'verd-board'
      }
      data-runtime="cells"
      onPointerDownCapture={(event) => {
        if (presenting) return;
        if (
          !(event.target as Element).closest('svg[aria-label="Frame canvas"]')
        )
          return;
        if (event.pointerType === 'pen') setStylusMode(true);
        else if (stylusMode) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onContextMenu={(event) => {
        if (
          (event.target as Element).closest(
            '[contenteditable="true"], input, textarea',
          )
        )
          return;
        if ((event.target as Element).closest('svg[aria-label="Frame canvas"]'))
          event.preventDefault();
      }}
      onKeyDownCapture={(event) => {
        if (presenting) return;
        if (
          myOpen ||
          shortcutsOpen ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          event.key === 'Process' ||
          (event.target as Element).closest(
            '[contenteditable="true"], input, textarea, select, dialog, [role="dialog"], [role="menu"], [aria-label="Mind note"], [data-frame-text-toolbar]',
          )
        )
          return;
        const key = event.key.toLowerCase(),
          modified = event.ctrlKey || event.metaKey;
        if (modified && ['backspace', 'delete'].includes(key)) {
          event.preventDefault();
          setClearConfirm(true);
          return;
        }
        if (
          modified &&
          event.shiftKey &&
          key === 'n' &&
          cell &&
          isNodeCell(cell) &&
          ['mind-root', 'mind-child', 'mind-summary'].includes(cell.kind)
        ) {
          event.preventDefault();
          setNoteRequest({
            id: cell.id,
            sequence: ++noteRequestSequence.current,
          });
          return;
        }
        if (modified && key === 's') {
          event.preventDefault();
          void exportFile();
          return;
        }
        if (modified && key === 'u') {
          event.preventDefault();
          imageInput.current?.click();
          return;
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === 'e'
        ) {
          event.preventDefault();
          setImageExport(true);
          return;
        }
        if (modified || event.altKey) return;
        if (scene && !['h', 'v'].includes(key)) return;
        const shortcuts: Record<string, string> = {
          h: 'hand',
          v: 'select',
          m: 'mind',
          e: 'erase',
          p: 'pen',
          a: 'arrow',
          r: 'shape',
          o: 'shape',
          t: 'text',
        };
        const tool = shortcuts[key];
        if (tool && (key !== 'a' || !selection.ids.length)) {
          event.preventDefault();
          event.stopPropagation();
          if (key === 'r') setShape('rectangle');
          if (key === 'o') setShape('ellipse');
          setPointer(tool);
          setShapePickerOpen(false);
          imageRequest.current++;
        }
      }}
    >
      <div className="frame-canvas-area">
        <div className="frame-canvas-fill">
          <FrameCanvas
            documentReferences={documentReferences}
            ref={controller}
            value={value}
            frameId={frameId}
            initialFocusCellId={initialFocusCellId}
            readonly={readonly}
            history={history}
            interactionSettings={interactionSettings}
            registry={registry}
            extensions={extensions}
            style={{ position: 'absolute', inset: 0 }}
            viewportInsets={{
              top: 112 + Math.max(0, chromeHeight.toolbar - 42),
              right: 16,
              bottom: Math.max(64, chromeHeight.bottom + 32),
              left: 64,
            }}
            tool={
              pointer === 'hand'
                ? { mode: 'hand' }
                : scene
                  ? { mode: 'select' }
                  : drawing
            }
            onViewStateChange={viewStateStore.publish}
            onCanvasContextMenu={setActionsPoint}
            onChange={onChange}
            onSelectionChange={setSelection}
            onOpenFrame={onOpenFrame}
            instanceHost={instanceHost}
            suspended={suspended || myOpen || shortcutsOpen || presenting}
            placing={placing}
            onPlace={onPlace}
            onCancelPlace={onCancelPlace}
            onActiveInstance={(occurrenceId) => {
              activeInstanceId.current = occurrenceId;
              if (!occurrenceId) setInstanceSelection(null);
            }}
            onInstanceSelection={(next) => {
              if (activeInstanceId.current) setInstanceSelection(next);
            }}
            onReject={(result) => setFailure(result.message ?? 'Edit rejected')}
          />
        </div>
        {!tutorialSkipped &&
          frameId === store.rootId &&
          isFrameCell(frame) &&
          !frame.children.length && (
            <Tutorial onSkip={() => setTutorialSkipped(true)} />
          )}
        {actions && !readonly && controller.current && (
          <FrameActionsPopover
            point={actions.point}
            store={store}
            selection={actions.selection}
            controller={controller.current}
            dispatch={dispatch}
            onClose={() => {
              setActionsPoint(null);
            }}
            onFailure={setFailure}
            onDuplicateReference={onDuplicateReference}
          />
        )}
        <div
          className="frame-app-toolbar"
          ref={appToolbar}
          role="toolbar"
          aria-label="App actions"
        >
          <FrameAppMenu
            items={appMenuItems}
            buttonRef={menuButton}
            onOpen={() => {
              setShapePickerOpen(false);
              setActionsPoint(null);
            }}
          />
          <FrameIconButton
            label={labels.undo}
            title={`${labels.undo} (⌘Z)`}
            icon={Undo2}
            disabled={!viewState?.canUndo || busy || viewState?.readonly}
            onClick={() => controller.current?.undo()}
          />
          <FrameIconButton
            label={labels.redo}
            title={`${labels.redo} (⇧⌘Z)`}
            icon={Redo2}
            disabled={!viewState?.canRedo || busy || viewState?.readonly}
            onClick={() => controller.current?.redo()}
          />
          {stylusMode && (
            <button
              aria-label="Exit stylus mode"
              onClick={() => setStylusMode(false)}
            >
              退出手写模式
            </button>
          )}
          <FrameIconButton
            label={t('presentation.open')}
            icon={Presentation}
            disabled={!canPresent}
            onClick={startPresentation}
          />
          <FrameIconButton
            label={language === 'zh' ? '属性' : 'Properties'}
            icon={PanelRight}
            pressed={inspectorOpen}
            onClick={() => setInspectorOpen((open) => !open)}
          />
          <FrameSaveStatus
            status={saveStatus}
            lastSavedAt={lastSavedAt}
            onRetrySave={onRetrySave}
          />
        </div>
        <div className="frame-tools" role="toolbar" aria-label="Drawing tools">
          <div className="frame-tool-group">
            {(
              [
                ['select', MousePointer2, 'V'],
                ['hand', Hand, 'H'],
              ] as const
            ).map(([tool, icon, shortcut]) => (
              <FrameIconButton
                tooltipPlacement="right"
                key={tool}
                label={labels[tool]}
                title={`${labels[tool]} — ${shortcut}`}
                icon={icon}
                pressed={pointer === tool}
                disabled={tool !== 'hand' && (busy || viewState?.readonly)}
                onClick={() => setPointer(tool)}
              />
            ))}
          </div>
          {!scene ? (
            <>
              <div className="frame-tool-group">
                {(
                  [
                    ['shape', Square, 'R'],
                    ['text', Type, 'T'],
                    ['pen', Pencil, 'P'],
                    ['erase', Eraser, 'E'],
                    ['table', Table2, ''],
                    ['swimlane', Columns3, ''],
                    ['frame', Frame, ''],
                  ] as const
                ).map(([tool, icon, shortcut]) => (
                  <FrameIconButton
                    tooltipPlacement="right"
                    key={tool}
                    label={labels[tool]}
                    title={
                      shortcut ? `${labels[tool]} — ${shortcut}` : labels[tool]
                    }
                    icon={icon}
                    pressed={
                      pointer === tool ||
                      (tool === 'shape' && pointer === 'vector-line')
                    }
                    disabled={busy || viewState?.readonly}
                    buttonRef={
                      tool === 'shape'
                        ? shapeFloating.refs.setReference
                        : undefined
                    }
                    buttonProps={
                      tool === 'shape'
                        ? shapeInteractions.getReferenceProps({
                            'aria-expanded': shapePickerOpen,
                          })
                        : undefined
                    }
                    hasPopup={tool === 'shape'}
                    tooltipDisabled={tool === 'shape' && shapePickerOpen}
                    onClick={() => {
                      imageRequest.current++;
                      setPointer(tool === 'shape' ? 'select' : tool);
                      setShapePickerOpen(
                        tool === 'shape' ? !shapePickerOpen : false,
                      );
                    }}
                  />
                ))}
              </div>
              <div className="frame-tool-group">
                <FrameToolMenu
                  label={labels.connectors}
                  icon={Spline}
                  value={pointer}
                  disabled={busy || viewState?.readonly}
                  onChange={setPointer}
                  items={[
                    {
                      id: 'arrow',
                      label: labels.arrow,
                      icon: ArrowRight,
                      shortcut: 'A',
                    },
                    {
                      id: 'bidirectional',
                      label:
                        language === 'zh' ? '双向箭头' : 'Bidirectional arrow',
                      icon: ArrowLeftRight,
                    },
                    { id: 'line', label: labels.line, icon: Minus },
                    { id: 'curve', label: labels.curve, icon: Spline },
                  ]}
                />
                <FrameToolMenu
                  label={labels.diagrams}
                  icon={Network}
                  value={pointer}
                  disabled={busy || viewState?.readonly}
                  onChange={setPointer}
                  items={[
                    {
                      id: 'mind',
                      label: t('toolbar.mind'),
                      icon: Network,
                      shortcut: 'M',
                    },
                    {
                      id: 'workflow',
                      label: t('toolbar.workflow'),
                      icon: Workflow,
                    },
                    {
                      id: 'architecture',
                      label: t('toolbar.architecture'),
                      icon: Boxes,
                    },
                    {
                      id: 'uml-class',
                      label:
                        language === 'zh' ? 'UML 类图' : 'UML Class Diagram',
                      icon: Boxes,
                    },
                    {
                      id: 'uml-sequence',
                      label:
                        language === 'zh'
                          ? 'UML 时序图'
                          : 'UML Sequence Diagram',
                      icon: Workflow,
                    },
                  ]}
                />
                <FrameIconButton
                  tooltipPlacement="right"
                  label={labels.image}
                  title={`${labels.image} — ⌘U`}
                  icon={ImageIcon}
                  disabled={busy || viewState?.readonly}
                  onClick={() => imageInput.current?.click()}
                />
              </div>
              {shapePickerOpen && (
                <FloatingPortal>
                  <FloatingFocusManager
                    context={shapeFloating.context}
                    modal={false}
                    initialFocus={-1}
                    returnFocus={false}
                  >
                    <FrameShapePicker
                      floatingRef={shapeFloating.refs.setFloating}
                      containerProps={shapeInteractions.getFloatingProps({
                        style: shapeFloating.floatingStyles,
                        'aria-label': labels.shape,
                      })}
                      shapes={shapes}
                      value=""
                      onChange={(next) => {
                        setShape(next);
                        setPointer('shape');
                        setShapePickerOpen(false);
                      }}
                      pathLabel={labels['vector-line']}
                      onSelectPath={() => {
                        setPointer('vector-line');
                        setShapePickerOpen(false);
                      }}
                    />
                  </FloatingFocusManager>
                </FloatingPortal>
              )}
              {pointer === 'pen' && (
                <select
                  aria-label="Pen"
                  value={pen}
                  onChange={(event) => setPen(event.target.value as typeof pen)}
                >
                  {[
                    'nibPen',
                    'feltTipPen',
                    'artisticBrush',
                    'markerHighlight',
                  ].map((pen) => (
                    <option key={pen}>{pen}</option>
                  ))}
                </select>
              )}
            </>
          ) : scene === 'uml-class-root' || scene === 'uml-sequence-root' ? (
            <UmlPalette
              store={store}
              frameId={frameId}
              zh={language === 'zh'}
              disabled={editDisabled}
              dispatch={dispatch}
            />
          ) : scene === 'workflow-start' ? (
            <>
              <button
                data-testid="palette-task"
                onClick={() => addDomainNode('task')}
              >
                任务
              </button>
              <button
                data-testid="palette-decision"
                onClick={() => addDomainNode('decision')}
              >
                判断
              </button>
              <button
                onClick={() =>
                  dispatch([
                    {
                      type: 'insert_cell',
                      parentId: frameId,
                      cell: createWorkflowStartCell(id(), [400, 80]),
                    },
                  ])
                }
              >
                添加流程图
              </button>
            </>
          ) : scene === 'architecture-layer' ? (
            <>
              <button onClick={() => addDomainNode('box')}>模块</button>
              <button onClick={() => addDomainNode('decision')}>判断</button>
              <button onClick={() => addDomainNode('store')}>存储</button>
              <button
                onClick={() =>
                  dispatch([
                    {
                      type: 'insert_cell',
                      parentId: frameId,
                      cell: createArchitectureLayerCell(
                        id(),
                        String(
                          (frame as import('@sue/board-core').FrameCell)
                            .children.length,
                        ).padStart(4, '0'),
                      ),
                      index: 0,
                    },
                  ])
                }
              >
                添加层
              </button>
            </>
          ) : (
            <>
              <button onClick={() => addDomainNode('child')}>子主题</button>
              <button
                onClick={() =>
                  dispatch([
                    {
                      type: 'insert_cell',
                      parentId: frameId,
                      cell: createMindRootCell(id(), [400, 80]),
                    },
                  ])
                }
              >
                中心主题
              </button>
            </>
          )}
          {canSummarize && (
            <button onClick={addSummary}>
              {language === 'zh' ? '概要' : 'Summary'}
            </button>
          )}
        </div>
        <div className="frame-bottom-controls" ref={bottomControls}>
          <FrameRecenterControl
            viewStateStore={viewStateStore}
            controller={controller}
            label={t('canvasStatus.recenter')}
          />
          <div className="frame-status-bar" data-testid="canvas-status-bar">
            {scene === 'workflow-start' &&
              (() => {
                const command = {
                  type: 'layout' as const,
                  style: 'flow' as const,
                };
                const state =
                  controller.current?.selectionCommandState(command);
                return (
                  <button
                    data-testid="workflow-auto-layout"
                    disabled={!state?.enabled}
                    title={state?.reason ? t('arrange.cycle') : undefined}
                    onClick={() =>
                      void controller.current?.executeSelectionCommand(command)
                    }
                  >
                    {t('arrange.flow')}
                  </button>
                );
              })()}
            <button
              data-testid="canvas-status-fit"
              onClick={() => controller.current?.fit()}
            >
              {labels.fit}
            </button>
            <FrameZoomControls
              viewStateStore={viewStateStore}
              controller={controller}
            />
          </div>
        </div>
      </div>
      <FramePropertyPanel
        key={frameId}
        open={inspectorOpen}
        cellId={cell?.id}
        identity={inspectorIdentity}
        disabled={inspectorDisabled}
        title={
          <>
            {cell && isNodeCell(cell) ? (
              <>
                <span className="frame-inspector__type">{inspectorTitle}</span>
                <input
                  key={cell.id}
                  type="text"
                  aria-label={language === 'zh' ? '名称' : 'Name'}
                  data-testid="inspector-name"
                  value={
                    cell.name ??
                    nameText?.plainText.replace(/[\r\n]+/g, ' ') ??
                    ''
                  }
                  placeholder={inspectorTitle}
                  title={cell.name ?? nameText?.plainText ?? ''}
                  disabled={
                    busy ||
                    readonly ||
                    viewState?.readonly ||
                    !selectionAllows(
                      store,
                      [cell.id],
                      registry,
                      'edit',
                      frameId,
                    )
                  }
                  onChange={(event) =>
                    replace({ ...cell, name: event.target.value })
                  }
                />
              </>
            ) : (
              inspectorTitle
            )}
          </>
        }
      >
        {cell && isNodeCell(cell) && (
          <FramePropertyGroup
            id="geometry"
            label="Geometry"
            title={language === 'zh' ? '位置与尺寸' : 'Position and size'}
          >
            <div className="frame-property-grid">
              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                <label key={key}>
                  <span>
                    {key === 'width'
                      ? language === 'zh'
                        ? '宽度'
                        : 'Width'
                      : key === 'height'
                        ? language === 'zh'
                          ? '高度'
                          : 'Height'
                        : key.toUpperCase()}
                  </span>
                  <FramePropertyNumber
                    aria-label={key}
                    step={1}
                    precision={0}
                    disabled={
                      inspectorDisabled ||
                      (scene === 'uml-sequence-root' &&
                        cell.kind.startsWith('uml-')) ||
                      !selectionAllows(
                        store,
                        [cell.id],
                        registry,
                        key === 'x' || key === 'y' ? 'move' : 'resize',
                        frameId,
                      )
                    }
                    min={key === 'width' || key === 'height' ? 0 : undefined}
                    value={displayedGeometry![key]}
                    onCommit={(value) => {
                      const capability =
                        key === 'x' || key === 'y' ? 'move' : 'resize';
                      const latest = getInspectorNode(cell.id, capability);
                      const latestStore = getInspectorStore();
                      if (!latest || !latestStore) return;
                      const layout = extensions.reduce(
                        (geometry, extension) =>
                          extension
                            .layout?.(latestStore, selectionFrameId)
                            ?.get(latest.id) ?? geometry,
                        latest.geometry,
                      );
                      const geometry = {
                        ...layout,
                        [key]: value,
                        derived: false,
                      };
                      if (geometry[key] === layout[key]) return;
                      const util = controller.current?.runtime.registry.get(
                        latest.kind,
                      );
                      if (util && 'move' in util) {
                        const nodeUtil =
                          util as import('@sue/board-core').BaseCellUtil;
                        dispatch(
                          capability === 'move'
                            ? nodeUtil.move(latestStore, latest, geometry)
                            : nodeUtil.resize(latestStore, latest, geometry),
                        );
                      } else replace({ ...latest, geometry });
                    }}
                  />
                </label>
              ))}
              {!isFrameCell(cell) && (
                <label>
                  <span>{language === 'zh' ? '旋转' : 'Rotation'}</span>
                  <FramePropertyNumber
                    aria-label="Rotation"
                    value={Math.round(
                      ((cell.geometry.rotation ?? 0) * 180) / Math.PI,
                    )}
                    disabled={!inspectorEditable}
                    onCommit={(value) => {
                      const latest = getInspectorNode(cell.id);
                      if (latest)
                        replace({
                          ...latest,
                          geometry: {
                            ...latest.geometry,
                            rotation: (value * Math.PI) / 180,
                          },
                        });
                    }}
                  />
                </label>
              )}
            </div>
          </FramePropertyGroup>
        )}
        {(scene === 'uml-class-root' || scene === 'uml-sequence-root') && (
          <UmlProperties
            key={cell?.id ?? frameId}
            store={store}
            frameId={frameId}
            cell={cell}
            zh={language === 'zh'}
            disabled={cell ? !inspectorEditable : inspectorDisabled}
            dispatch={dispatch}
          />
        )}
        {appearanceCells(store, uiSelection.ids).length > 0 && (
          <FramePropertyGroup
            id="appearance"
            label="Appearance"
            title={language === 'zh' ? '外观' : 'Appearance'}
          >
            <fieldset disabled={!inspectorEditable}>
              <FrameSelectionAppearance
                store={store}
                ids={uiSelection.ids}
                dispatch={dispatch}
                getStore={getInspectorEditStore}
                disabled={!inspectorEditable}
                single={!!cell && !isGroupCell(cell)}
              />
            </fieldset>
          </FramePropertyGroup>
        )}
        {hasSelectionText(store, uiSelection.ids) && (
          <FramePropertyGroup
            id="text"
            label="Text"
            title={language === 'zh' ? '文本' : 'Text'}
          >
            <fieldset disabled={!inspectorEditable}>
              <FrameSelectionText
                store={store}
                ids={uiSelection.ids}
                dispatch={dispatch}
                getStore={getInspectorEditStore}
                disabled={!inspectorEditable}
              />
            </fieldset>
          </FramePropertyGroup>
        )}
        {cell &&
          ((isNodeCell(cell) &&
            (cell.kind === 'geometry' ||
              cell.kind === 'vector-line' ||
              cell.kind.startsWith('mind-') ||
              cell.kind === 'workflow-start' ||
              cell.kind === 'architecture-module' ||
              isFrameCell(cell) ||
              isFrameReferenceCell(cell))) ||
            (isEdgeCell(cell) && !cell.kind.startsWith('uml-'))) && (
            <FramePropertyGroup
              id="specific"
              reveal={noteRequest?.id === cell.id ? noteRequest.sequence : 0}
              title={language === 'zh' ? '专属设置' : 'Specific settings'}
            >
              <fieldset disabled={!inspectorEditable}>
                {cell && isNodeCell(cell) && (
                  <>
                    {cell.kind === 'geometry' && (
                      <label>
                        {language === 'zh' ? '手绘程度' : 'Roughness'}
                        <input
                          aria-label="Roughness"
                          type="range"
                          min="0"
                          max="3"
                          step="0.25"
                          value={
                            (cell.data as { roughness?: number } | undefined)
                              ?.roughness ?? 0
                          }
                          onChange={(event) =>
                            replace({
                              ...cell,
                              data: {
                                ...(cell.data as object),
                                roughness: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    )}
                    {cell.kind === 'workflow-start' && (
                      <select
                        aria-label={language === 'zh' ? '图模式' : 'Graph mode'}
                        data-testid="workflow-graph-mode"
                        value={(cell.data as WorkflowStartData).graphMode}
                        onChange={(event) =>
                          replace({
                            ...cell,
                            data: {
                              ...(cell.data as WorkflowStartData),
                              graphMode: event.target.value as
                                'dag' | 'process',
                            },
                          })
                        }
                      >
                        <option value="dag">DAG</option>
                        <option value="process">Process</option>
                      </select>
                    )}
                    {cell.kind === 'architecture-module' &&
                      isFrameCell(frame) &&
                      (() => {
                        const layers = frame.children
                          .map((id) => store.cells[id])
                          .filter(
                            (item): item is NodeCell<ArchitectureLayerData> =>
                              isNodeCell(item) &&
                              item.kind === 'architecture-layer',
                          )
                          .sort((a, b) =>
                            a.data!.order.localeCompare(b.data!.order),
                          );
                        return (
                          <label>
                            {language === 'zh' ? '所属层' : 'Layer'}
                            <select
                              aria-label="Architecture layer"
                              disabled={
                                busy ||
                                readonly ||
                                !selectionAllows(
                                  store,
                                  [cell.id],
                                  registry,
                                  'move',
                                  frameId,
                                )
                              }
                              value={
                                controller.current?.runtime.index.domainOwnerOf.get(
                                  cell.id,
                                ) ?? ''
                              }
                              onChange={(event) =>
                                dispatch(
                                  moveArchitectureModuleToLayer(
                                    store,
                                    cell.id,
                                    event.target.value,
                                    { position: 'inside-layer' },
                                  ),
                                )
                              }
                            >
                              {layers.map((layer, index) => (
                                <option
                                  key={layer.id}
                                  value={layer.id}
                                  disabled={
                                    layer.locked ||
                                    lockedByAncestor(store, layer.id)
                                  }
                                >
                                  {layer.content?.label || `层 ${index + 1}`}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      })()}
                    {['mind-root', 'mind-child', 'mind-summary'].includes(
                      cell.kind,
                    ) && (
                      <FrameMindProperties
                        key={cell.id}
                        cell={cell}
                        store={store}
                        dispatch={(operations) => void dispatch(operations)}
                        frame={isFrameCell(frame) ? frame : undefined}
                        readonly={!inspectorEditable}
                        defaultMaxWidth={mindMaxWidth}
                        disabled={!inspectorEditable}
                        openNoteRequest={
                          noteRequest?.id === cell.id ? noteRequest.sequence : 0
                        }
                        onNoteOpened={() => setNoteRequest(null)}
                        replace={replace}
                        getCell={() => {
                          return getInspectorNode(cell.id);
                        }}
                      />
                    )}
                  </>
                )}
                {cell && isNodeCell(cell) && cell.kind === 'vector-line' && (
                  <label>
                    {language === 'zh' ? '路径' : 'Path'}
                    <select
                      aria-label="Vector line shape"
                      value={
                        (cell.data as { shape?: string })?.shape ?? 'straight'
                      }
                      onChange={(event) =>
                        replace(
                          setVectorLineShape(
                            cell as NodeCell<VectorLineData>,
                            event.target.value as VectorLineData['shape'],
                          ),
                        )
                      }
                    >
                      <option value="straight">
                        {language === 'zh' ? '直线' : 'Straight'}
                      </option>
                      <option value="curve">
                        {language === 'zh' ? '曲线' : 'Curve'}
                      </option>
                    </select>
                  </label>
                )}
                {cell && (isFrameCell(cell) || isFrameReferenceCell(cell)) && (
                  <label>
                    {language === 'zh' ? '比例' : 'Aspect'}
                    <select
                      aria-label={
                        language === 'zh' ? '比例' : 'Frame aspect ratio'
                      }
                      value={cell.aspectRatio ?? 'custom'}
                      onChange={(event) => {
                        const aspectRatio = event.target
                          .value as import('@sue/board-core').FrameAspectRatio;
                        const ratios: Record<string, number> = {
                          a4: 210 / 297,
                          '1:1': 1,
                          '4:3': 4 / 3,
                          '16:10': 1.6,
                          '16:9': 16 / 9,
                          browser: window.innerWidth / window.innerHeight,
                          tablet: 4 / 3,
                          phone: 9 / 16,
                        };
                        replace({
                          ...cell,
                          aspectRatio,
                          geometry: {
                            ...cell.geometry,
                            ...(ratios[aspectRatio]
                              ? roundNodeDimensions({
                                  ...cell.geometry,
                                  height:
                                    Math.round(cell.geometry.width) /
                                    ratios[aspectRatio],
                                })
                              : {}),
                          },
                        });
                      }}
                    >
                      {[
                        'custom',
                        'a4',
                        '1:1',
                        '4:3',
                        '16:10',
                        '16:9',
                        'browser',
                        'tablet',
                        'phone',
                      ].map((ratio) => (
                        <option key={ratio} value={ratio}>
                          {(
                            {
                              custom: t('frame.aspect.custom'),
                              a4: t('frame.aspect.a4'),
                              browser: t('frame.aspect.browser'),
                              tablet: t('frame.aspect.tablet'),
                              phone: t('frame.aspect.phone'),
                            } as Record<string, string>
                          )[ratio] ?? ratio}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {cell && isEdgeCell(cell) && (
                  <>
                    {(cell.labels?.length
                      ? cell.labels
                      : [{ text: '', position: 0.5 }]
                    ).map((label, index) => (
                      <div key={index}>
                        <div className="frame-field">
                          <span>
                            {language === 'zh' ? '标签' : 'Label'} {index + 1}
                          </span>
                          <FrameRichTextField
                            text={
                              existingTextDocument(label.richText) ??
                              createInlineText(label.text)
                            }
                            label={`Edge label ${index + 1}`}
                            readonly={!inspectorEditable}
                            onChange={(text) =>
                              commitText(cell.id, text, index)
                            }
                          />
                        </div>
                        <label>
                          {language === 'zh' ? '位置' : 'Position'}
                          <input
                            aria-label={`Edge label position ${index + 1}`}
                            type="range"
                            min="0"
                            max="1"
                            step=".01"
                            value={label.position ?? 0.5}
                            onChange={(event) => {
                              const next = [
                                ...(cell.labels?.length
                                  ? cell.labels
                                  : [label]),
                              ];
                              next[index] = {
                                ...label,
                                position: Number(event.target.value),
                              };
                              replace({ ...cell, labels: next });
                            }}
                          />
                        </label>
                        {!!cell.labels?.length && (
                          <button
                            aria-label={`Remove edge label ${index + 1}`}
                            onClick={() =>
                              replace({
                                ...cell,
                                labels: cell.labels!.filter(
                                  (_, at) => at !== index,
                                ),
                              })
                            }
                          >
                            {language === 'zh' ? '移除标签' : 'Remove label'}
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() =>
                        replace({
                          ...cell,
                          labels: [
                            ...(cell.labels ?? []),
                            { text: 'Label', position: 0.5 },
                          ],
                        })
                      }
                    >
                      {language === 'zh' ? '添加标签' : 'Add label'}
                    </button>
                    {!['mind-branch', 'mind-summary-edge'].includes(
                      cell.kind,
                    ) && (
                      <>
                        <label>
                          {language === 'zh' ? '路由' : 'Route'}
                          <select
                            aria-label="Edge route"
                            value={cell.route.mode}
                            onChange={(event) => {
                              const mode = event.target.value as
                                'auto' | 'straight' | 'orthogonal' | 'curve';
                              replace({ ...cell, route: { mode } });
                            }}
                          >
                            <option value="auto">
                              {language === 'zh' ? '自动' : 'Auto'}
                            </option>
                            <option value="straight">
                              {language === 'zh' ? '直线' : 'Straight'}
                            </option>
                            <option value="orthogonal">
                              {language === 'zh' ? '正交' : 'Orthogonal'}
                            </option>
                            <option value="curve">
                              {language === 'zh' ? '曲线' : 'Curve'}
                            </option>
                            {cell.route.mode === 'fixed' && (
                              <option value="fixed">
                                {language === 'zh'
                                  ? '固定折线'
                                  : 'Fixed polyline'}
                              </option>
                            )}
                          </select>
                        </label>
                        {(['sourceMarker', 'targetMarker'] as const).map(
                          (end) => (
                            <label key={end}>
                              {end === 'sourceMarker'
                                ? language === 'zh'
                                  ? '起点箭头'
                                  : 'Start marker'
                                : language === 'zh'
                                  ? '终点箭头'
                                  : 'End marker'}
                              <select
                                aria-label={end}
                                value={
                                  (
                                    cell.data as
                                      Record<string, string> | undefined
                                  )?.[end] ??
                                  (end === 'sourceMarker' ? 'none' : 'arrow')
                                }
                                onChange={(event) =>
                                  replace({
                                    ...cell,
                                    data: {
                                      ...(cell.data as object),
                                      [end]: event.target.value,
                                    },
                                  })
                                }
                              >
                                {[
                                  'none',
                                  'arrow',
                                  'solid-triangle',
                                  'hollow-triangle',
                                  'diamond',
                                  'diamond_outline',
                                  'circle',
                                  'cross',
                                  'one-side-up',
                                  'one-side-down',
                                  'single-slash',
                                ].map((marker) => (
                                  <option key={marker} value={marker}>
                                    {
                                      (
                                        {
                                          none:
                                            language === 'zh' ? '无' : 'None',
                                          arrow:
                                            language === 'zh'
                                              ? '箭头'
                                              : 'Arrow',
                                          'solid-triangle':
                                            language === 'zh'
                                              ? '实心三角'
                                              : 'Solid triangle',
                                          'hollow-triangle':
                                            language === 'zh'
                                              ? '空心三角'
                                              : 'Hollow triangle',
                                          diamond:
                                            language === 'zh'
                                              ? '实心菱形'
                                              : 'Solid diamond',
                                          diamond_outline:
                                            language === 'zh'
                                              ? '空心菱形'
                                              : 'Hollow diamond',
                                          circle:
                                            language === 'zh'
                                              ? '圆形'
                                              : 'Circle',
                                          cross:
                                            language === 'zh'
                                              ? '交叉'
                                              : 'Cross',
                                          'one-side-up':
                                            language === 'zh'
                                              ? '上侧箭头'
                                              : 'Upper arrow',
                                          'one-side-down':
                                            language === 'zh'
                                              ? '下侧箭头'
                                              : 'Lower arrow',
                                          'single-slash':
                                            language === 'zh'
                                              ? '斜线'
                                              : 'Slash',
                                        } as Record<string, string>
                                      )[marker]
                                    }
                                  </option>
                                ))}
                              </select>
                            </label>
                          ),
                        )}
                      </>
                    )}
                  </>
                )}
              </fieldset>
            </FramePropertyGroup>
          )}
        {!selected.length && (
          <FramePropertyGroup
            id="canvas"
            label="Canvas settings"
            title={language === 'zh' ? '画布设置' : 'Canvas settings'}
          >
            <fieldset disabled={inspectorDisabled}>
              <label>
                {language === 'zh' ? '主题' : 'Theme'}
                <select
                  aria-label="Theme"
                  value={
                    isFrameCell(frame)
                      ? (frame.view?.theme?.themeColorMode ??
                        ThemeColorMode.default)
                      : ThemeColorMode.default
                  }
                  onChange={(event) =>
                    setTheme(event.target.value as ThemeColorMode)
                  }
                >
                  {Object.values(ThemeColorMode).map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`theme.${mode}`)}
                    </option>
                  ))}
                </select>
              </label>
              {scene === 'mind-root' && isFrameCell(frame) && (
                <MindSchemeField
                  frame={frame}
                  readonly={inspectorDisabled}
                  apply={(next) => replace(next)}
                />
              )}
              <label>
                {language === 'zh' ? '背景' : 'Background'}
                <input
                  type="color"
                  value={
                    isFrameCell(frame)
                      ? (frame.view?.theme?.boardBackground ?? '#f8fafc')
                      : '#f8fafc'
                  }
                  onChange={(event) => {
                    if (isFrameCell(frame))
                      dispatch(
                        [
                          {
                            type: 'replace_cell',
                            cell: {
                              ...frame,
                              view: {
                                ...frame.view,
                                theme: {
                                  themeColorMode: ThemeColorMode.default,
                                  ...frame.view?.theme,
                                  boardBackground: event.target.value,
                                },
                              },
                            },
                          },
                        ],
                        true,
                      );
                  }}
                />
              </label>
              {isFrameCell(frame) && (
                <>
                  <label>
                    {language === 'zh' ? '网格' : 'Grid'}
                    <input
                      aria-label="Canvas grid"
                      type="checkbox"
                      checked={!!frame.view?.theme?.gridEnabled}
                      onChange={(event) =>
                        replace(
                          {
                            ...frame,
                            view: {
                              ...frame.view,
                              theme: {
                                themeColorMode: ThemeColorMode.default,
                                ...frame.view?.theme,
                                gridEnabled: event.target.checked,
                              },
                            },
                          },
                          true,
                        )
                      }
                    />
                  </label>
                  <label>
                    {language === 'zh' ? '网格间距' : 'Grid spacing'}
                    <FramePropertyNumber
                      aria-label="Canvas grid size"
                      min={4}
                      max={200}
                      value={frame.view?.theme?.gridSize ?? 20}
                      onCommit={(gridSize) => {
                        const latestStore = getInspectorStore();
                        const latest = latestStore?.cells[frameId];
                        if (isFrameCell(latest))
                          replace(
                            {
                              ...latest,
                              view: {
                                ...latest.view,
                                theme: {
                                  themeColorMode: ThemeColorMode.default,
                                  ...latest.view?.theme,
                                  gridSize,
                                },
                              },
                            },
                            true,
                          );
                      }}
                    />
                  </label>
                </>
              )}
            </fieldset>
          </FramePropertyGroup>
        )}
        {(selected.length > 0 ||
          frameScene(store, selectionFrameId) !== 'mind-root') && (
          <FramePropertyGroup
            id="arrangement"
            defaultCollapsed
            title={
              selected.length
                ? language === 'zh'
                  ? '排列与图层'
                  : 'Arrange and layers'
                : language === 'zh'
                  ? '排列'
                  : 'Arrange'
            }
          >
            <fieldset disabled={inspectorDisabled}>
              <FrameArrangement
                store={store}
                selection={selection}
                controller={controller.current}
              />
              {cell?.kind === 'architecture-layer' &&
                isFrameCell(frame) &&
                (() => {
                  const layers = frame.children
                    .map((id) => store.cells[id])
                    .filter(
                      (item): item is NodeCell<ArchitectureLayerData> =>
                        isNodeCell(item) && item.kind === 'architecture-layer',
                    )
                    .sort((a, b) => a.data!.order.localeCompare(b.data!.order));
                  const index = layers.findIndex(
                    (layer) => layer.id === cell.id,
                  );
                  return (
                    <div className="frame-property-icons">
                      {[-1, 1].map((direction) => (
                        <button
                          key={direction}
                          aria-label={
                            direction < 0 ? 'Move layer up' : 'Move layer down'
                          }
                          disabled={
                            !inspectorEditable ||
                            index + direction < 0 ||
                            index + direction >= layers.length
                          }
                          onClick={() => {
                            const ids = layers.map((layer) => layer.id);
                            [ids[index], ids[index + direction]] = [
                              ids[index + direction],
                              ids[index],
                            ];
                            dispatch(
                              reorderArchitectureLayers(store, frameId, ids),
                            );
                          }}
                        >
                          {direction < 0 ? (
                            <ArrowUp size={16} aria-hidden="true" />
                          ) : (
                            <ArrowDown size={16} aria-hidden="true" />
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              {cell && isNodeCell(cell) && (
                <>
                  <label>
                    {language === 'zh' ? '锁定' : 'Locked'}
                    <input
                      type="checkbox"
                      disabled={
                        inspectorDisabled || lockedByAncestor(store, cell.id)
                      }
                      checked={!!cell.locked}
                      onChange={(event) =>
                        replace({ ...cell, locked: event.target.checked })
                      }
                    />
                  </label>
                </>
              )}
              {!!transferTargets.length && (
                <label>
                  {language === 'zh' ? '移入容器' : 'Move to frame'}
                  <select
                    aria-label="Move to frame"
                    value={
                      transferTargets.some(
                        (target) => target.id === transferTarget,
                      )
                        ? transferTarget
                        : ''
                    }
                    onChange={(event) => setTransferTarget(event.target.value)}
                  >
                    <option value="">
                      {language === 'zh' ? '选择容器' : 'Choose frame'}
                    </option>
                    {transferTargets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.content?.label ||
                          (target.id === store.rootId ? '白板' : target.id)}
                      </option>
                    ))}
                  </select>
                  <button
                    aria-label="Move selection to frame"
                    disabled={
                      !transferTargets.some(
                        (target) => target.id === transferTarget,
                      )
                    }
                    onClick={() => {
                      void controller.current
                        ?.moveSelection(transferTarget)
                        .then((result) =>
                          setFailure(
                            result.status === 'rejected'
                              ? (result.message ?? 'Edit rejected')
                              : null,
                          ),
                        );
                    }}
                  >
                    {language === 'zh' ? '移动' : 'Move'}
                  </button>
                </label>
              )}
              {selected.length > 0 && (
                <div className="frame-property-icons">
                  {!frameScene(store, selectionFrameId) &&
                    (['front', 'forward', 'backward', 'back'] as const).map(
                      (direction, index) => (
                        <button
                          key={direction}
                          disabled={!inspectorEditable}
                          aria-label={
                            [
                              t('layer.toTop'),
                              t('layer.moveUp'),
                              t('layer.moveDown'),
                              t('layer.toBottom'),
                            ][index]
                          }
                          onClick={() =>
                            dispatch(
                              reorderCells(
                                store,
                                selectionFrameId,
                                selection.ids,
                                direction,
                              ),
                            )
                          }
                        >
                          {(() => {
                            const Icon = [
                              BringToFront,
                              ArrowUp,
                              ArrowDown,
                              SendToBack,
                            ][index];
                            return <Icon size={16} aria-hidden="true" />;
                          })()}
                        </button>
                      ),
                    )}
                </div>
              )}
            </fieldset>
          </FramePropertyGroup>
        )}
        {selected.length > 0 && (
          <FramePropertyGroup
            id="actions"
            title={language === 'zh' ? '操作' : 'Actions'}
          >
            {cell &&
              (isFrameCell(cell) ||
                isFrameReferenceCell(cell) ||
                ['mind-root', 'workflow-start', 'architecture-layer'].includes(
                  cell.kind,
                )) && (
                <button
                  data-testid="frame-open"
                  onClick={() =>
                    onOpenFrame(
                      isFrameCell(cell)
                        ? cell.id
                        : isFrameReferenceCell(cell)
                          ? cell.data.targetFrameId
                          : controller.current!.runtime.index.parentOf.get(
                              cell.id,
                            )!,
                    )
                  }
                >
                  {labels.open}
                </button>
              )}{' '}
            <button
              className="frame-property-delete"
              disabled={
                inspectorDisabled ||
                !selectionAllows(
                  store,
                  selection.ids,
                  registry,
                  'delete',
                  frameId,
                )
              }
              onClick={() => dispatch(deleteCells(store, uiSelection.ids))}
            >
              {labels.delete}
            </button>
          </FramePropertyGroup>
        )}
        {detachedFrameIds.map((id) => (
          <button key={id} onClick={() => onOpenFrame(id)}>
            {store.cells[id]?.kind}: {id}
          </button>
        ))}
      </FramePropertyPanel>
      {shortcutsOpen && (
        <ShortcutHelp
          scene={
            scene === 'mind-root'
              ? 'mind'
              : scene === 'workflow-start'
                ? 'workflow'
                : scene === 'architecture-layer'
                  ? 'architecture'
                  : scene === 'uml-class-root'
                    ? 'uml-class'
                    : scene === 'uml-sequence-root'
                      ? 'uml-sequence'
                      : 'whiteboard'
          }
          locale={language}
          returnFocusRef={menuButton}
          onClose={() => setShortcutsOpen(false)}
        />
      )}
      {myOpen && (
        <MyPage
          onBack={() => {
            setMyOpen(false);
            requestAnimationFrame(() => menuButton.current?.focus());
          }}
        />
      )}
      {imageExport && (
        <FrameImageExportDialog
          hasSelection={selection.ids.length > 0}
          themeBackground={
            (isFrameCell(frame) && frame.view?.theme?.boardBackground) ||
            '#f8fafc'
          }
          onClose={() => setImageExport(false)}
          onExport={async (options) => {
            if (!controller.current) throw new Error('Canvas is unavailable');
            const blob = await controller.current.exportImage({
              ...options,
              ids: options.ids ?? selection.ids,
            });
            download(
              blob,
              `verd-frame.${options.format === 'jpeg' ? 'jpg' : (options.format ?? 'svg')}`,
            );
          }}
        />
      )}
      {clearConfirm && (
        <FrameClearDialog
          domain={!!scene}
          language={language}
          onClose={() => setClearConfirm(false)}
          onClear={() => {
            dispatch(clearFrameCells(store, frameId));
            setClearConfirm(false);
          }}
        />
      )}
      {textImport && (
        <FrameImportDialog
          registry={registry}
          extensions={extensions}
          scene={
            scene === 'mind-root'
              ? 'mind'
              : scene === 'workflow-start'
                ? 'workflow'
                : scene === 'architecture-layer'
                  ? 'architecture'
                  : scene === 'uml-class-root'
                    ? 'uml-class'
                    : scene === 'uml-sequence-root'
                      ? 'uml-sequence'
                      : 'whiteboard'
          }
          onImport={importSnapshot}
          onClose={() => setTextImport(false)}
        />
      )}
      {failure && (
        <div className="frame-error" role="alert">
          {failure}
          <button onClick={() => setFailure(null)}>关闭</button>
        </div>
      )}
      <input
        hidden
        ref={imageInput}
        type="file"
        accept="image/*"
        onChange={(event) => void addImage(event)}
      />
      <input
        hidden
        ref={importInput}
        type="file"
        accept="application/json,.md,.markdown,.mmd,.mermaid"
        onChange={(event) => void importFile(event)}
      />
      <input
        hidden
        ref={openInput}
        type="file"
        accept="application/json,.md,.markdown,.mmd,.mermaid"
        onChange={(event) => void openFile(event)}
      />
      {markdownPreview !== null && (
        <div
          className="frame-markdown-preview"
          role="dialog"
          aria-label="Markdown preview"
        >
          <textarea
            readOnly
            value={markdownPreview}
            aria-label="Markdown result"
          />
          <button
            onClick={() => void navigator.clipboard.writeText(markdownPreview)}
          >
            {language === 'zh' ? '复制' : 'Copy'}
          </button>
          <button
            onClick={() =>
              download(
                new Blob([markdownPreview], { type: 'text/markdown' }),
                markdownName,
              )
            }
          >
            {language === 'zh' ? '下载' : 'Download'}
          </button>
          <button onClick={() => setMarkdownPreview(null)}>
            {language === 'zh' ? '关闭' : 'Close'}
          </button>
        </div>
      )}
      {presenting && (
        <PresentationMode
          documentReferences={documentReferences}
          value={value}
          frameId={frameId}
          registry={registry}
          extensions={extensions}
          instanceHost={instanceHost}
          interactionSettings={interactionSettings}
          fullscreenRoot={rootRef.current}
          onExit={exitPresentation}
        />
      )}
    </div>
  );
}
