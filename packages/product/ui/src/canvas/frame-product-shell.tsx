import { Bot } from 'lucide-react';
import { WorkspaceButton } from '../shared/workspace-design';
import { agentLaunchLabel } from '../shared/preferences/agent-preferences';
import {
  frameLanes,
  resolveBoardTheme,
  type ResolvedBoardTheme,
} from '@sue/board-core';
import { FrameThemeContext } from '@sue/board-react';
import { frameSelectionActionId } from '@sue/board-react';
import {
  useActionSource,
  formatActionShortcut,
  ActionScope,
  type ActionSource,
  type ActionScopeValue,
} from '@sue/board-react-actions';
import {
  canonicalFrameProjection,
  combineFrameActionSources,
  type FrameActionDefinition,
} from '@sue/board-react';
import { actionLabel } from '@sue/board-common';
import type { FramePluginContext } from '@sue/board-react';
import { mergeSettingsPatch } from '@sue/board-react';
import { FrameGeometryControls } from '@sue/board-react';
import { FrameSettingsControl } from '@sue/board-react';
import { ProductPropertyPanel } from './properties/product-property-panel';
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { materializeArchitecturePositions } from '@sue/board-architecture';
import { createInlineText } from '@sue/board-common';
import {
  appearanceCells,
  clearFrameCells,
  copyCellFragment,
  frameScene,
  indexCells,
  isEdgeCell,
  isFrameCell,
  isFrameReferenceCell,
  isGroupCell,
  isNodeCell,
  lockedByAncestor,
  normalizeCellPositionOperations,
  roundNodeDimensions,
  roundNodeGeometry,
  selectionAllows,
  stripFrameViewports,
  ThemeColorMode,
  type CellOperation,
  type CellSelection,
  type FrameSnapshot,
  type NodeCell,
} from '@sue/board-core';
import { setVectorLineShape, type VectorLineData } from '@sue/board-draw';

import type { FramePluginSet } from '@sue/board-react';
import {
  existingTextDocument,
  FrameCanvas,
  FrameRichTextField,
  type FrameCanvasController,
  type FrameInstanceHost,
  type FrameOpenSource,
} from '@sue/board-react';
import { materializeWorkflowPositions } from '@sue/board-workflow';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Boxes,
  Braces,
  BringToFront,
  Brush,
  CircleDot,
  Columns3,
  Search,
  Database,
  Diamond,
  Download,
  Eraser,
  FileImage,
  FileInput,
  FileText,
  FolderOpen,
  Frame,
  Hand,
  Image as ImageIcon,
  Keyboard,
  Layers3,
  ListTree,
  Minus,
  MousePointer2,
  Network,
  PanelRightOpen,
  PanelRightClose,
  Pencil,
  Presentation,
  Redo2,
  SendToBack,
  Spline,
  Square,
  Table2,
  Trash2,
  Type,
  Undo2,
  UserRound,
  Workflow,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import { useAppearancePreference } from '../shared/preferences/appearance-preferences';
import { Tutorial } from './toolbar/tutorial';
import { FrameActionsPopover } from './toolbar/frame-actions-popover';
import { FrameAppMenu, type FrameAppMenuItem } from './toolbar/frame-app-menu';
import { FrameTooltip, frameDisabledReason } from './toolbar/frame-tooltip';
import { FrameArrangement } from './properties/frame-arrangement';
import { FrameClearDialog } from './dialogs/frame-clear-dialog';
import { createFrameDrawingTool } from './toolbar/frame-drawing-tool';
import { FrameIconButton } from './toolbar/frame-icon-button';
import { FrameImageExportDialog } from './dialogs/frame-image-export-dialog';
import { FrameImportDialog } from './dialogs/frame-import-dialog';
import { FrameMindProperties, MindSchemeField } from '@sue/board-react-mind';
import { isFrameSnapshot, openFrameOperations } from './frame-open';
import { FramePropertyNumber } from '@sue/board-react';
import { FramePropertyGroup } from '@sue/board-react';
import { FrameSaveStatus } from '../shared/save-status';
import { FrameFindBar } from './toolbar/frame-find-bar';
import { FrameSelectionAppearance } from './properties/frame-selection-appearance';
import {
  FrameSelectionText,
  hasSelectionText,
} from './properties/frame-selection-text';
import { FrameShapePicker } from './toolbar/frame-shape-picker';
import { FrameToolMenu } from './toolbar/frame-tool-menu';
import { UmlProperties } from '@sue/board-react-uml';
import { FrameUmlToolPalette } from './toolbar/frame-uml-tool-palette';
import {
  createFrameViewStateStore,
  FrameRecenterControl,
  FrameZoomControls,
  useFrameStructuralViewState,
} from './frame-view-state';
import { useI18n } from '../i18n';
import { useInteractionPreferences } from '../shared/preferences/interaction-preferences';
import { MyPage } from '../settings/my-page';
import {
  exitPresentationFullscreen,
  requestPresentationFullscreen,
} from './presentation/fullscreen-owner';
import { PresentationMode } from './presentation/presentation-mode';
import { hasVisibleContent } from './presentation/presentation-targets';
import './presentation/presentation.scss';
import { shortcutLabels } from '../shared/shortcut-labels';
import { enTranslations, zhTranslations } from '../i18n/translations';
import '../styles/index.scss';
import type { VerdFrameProps } from './verd-frame';
export type { FrameInstanceHost, FrameOpenSource };

const id = () => crypto.randomUUID();
const productMenuLabels: Record<string, { zh: string; en: string }> = {
  ...Object.fromEntries(
    [
      ['open', 'menu.open'],
      ['import', 'menu.import'],
      ['import-text', 'menu.importText'],
      ['export', 'menu.export'],
      ['export-image', 'menu.exportImage'],
      ['export-markdown', 'menu.exportMarkdown'],
      ['export-mermaid', 'menu.exportMermaid'],
      ['clear', 'menu.clear'],
    ].map(([id, key]) => [
      id,
      {
        zh: zhTranslations[key as keyof typeof zhTranslations],
        en: enTranslations[key as keyof typeof enTranslations],
      },
    ]),
  ),
  'reference-existing': { zh: '引用已有…', en: 'Reference existing…' },
  'document-frame': { zh: '文档 Frame…', en: 'Document Frame…' },
  'reference-document': {
    zh: '引用文档（只读）…',
    en: 'Reference document (read-only)…',
  },
  shortcuts: { zh: shortcutLabels.zh.title, en: shortcutLabels.en.title },
  my: { zh: '设置', en: 'Settings' },
  'command-palette': { zh: '命令面板', en: 'Command palette' },
};
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

function ThemedActionScope({
  theme,
  ...props
}: ComponentProps<typeof ActionScope> & { theme: ResolvedBoardTheme }) {
  return (
    <FrameThemeContext.Provider value={theme}>
      <ActionScope {...props} />
    </FrameThemeContext.Provider>
  );
}

export function FrameProductShell({
  onAgentSelection,
  onStartAgent,
  pluginSet,
  presentation,
  mindMaxWidth,
  value,
  frameId,
  initialFocusCellId,
  onChange,
  onOpenFrame,
  saveStatus,
  showSaveStatus = true,
  lastSavedAt,
  onRetrySave,
  detachedFrameIds = [],
  parseLegacy,
  onDuplicateReference,
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
  onImportNative,
  onOpenMy,
  navigation,
  onNavigationResult,
  onReady,
  linkHost,
}: VerdFrameProps & { pluginSet: FramePluginSet; mindMaxWidth: number }) {
  const { appearance } = useAppearancePreference();
  const controller = useRef<FrameCanvasController>(null);
  const actionScope = useRef<ActionScopeValue | null>(null);
  const activeController = () =>
    controller.current?.getActiveController() ?? controller.current;
  useActionSource(controller.current?.actionSource);
  useActionSource(activeController()?.actionSource);
  const [actionTool, setActionTool] = useState<
    import('@sue/board-react').FrameCanvasTool | null
  >(null);
  useEffect(() => {
    onReady?.(controller.current);
    return () => onReady?.(null);
  }, [onReady, frameId]);
  const { t, language } = useI18n();
  const interactionSettings = useInteractionPreferences();
  const [myOpen, setMyOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  useEffect(() => {
    if (suspended) setFindOpen(false);
  }, [suspended, frameId]);
  const [selection, setSelection] = useState<CellSelection>({
    focus: [frameId],
    ids: [],
  });
  const [instanceSelection, setInstanceSelection] =
    useState<CellSelection | null>(null);
  const activeInstanceId = useRef<string | null>(null);
  const [pointer, setPointerState] = useState('select');
  const setPointer = (next: string) => {
    setActionTool(null);
    setPointerState(next);
  };
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
    controller: FrameCanvasController;
  } | null>(null);
  const setActionsPoint = useCallback((point: [number, number] | null) => {
    const target =
      controller.current?.getActiveController() ?? controller.current;
    setActions(
      point && target
        ? {
            point: [...point],
            controller: target,
            selection: structuredClone(target.runtime.selection),
          }
        : null,
    );
  }, []);
  useEffect(() => {
    if (
      actions &&
      (readonly ||
        JSON.stringify(actions.selection) !==
          JSON.stringify(actions.controller.runtime.selection) ||
        actions.selection.ids.some(
          (id) => !actions.controller.runtime.store.cells[id],
        ))
    )
      setActions(null);
  }, [actions, selection, instanceSelection, readonly, value.store]);
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
  const shapeRole = useRole(shapeFloating.context, { role: 'dialog' });
  const shapeInteractions = useInteractions([shapeRole]);
  useEffect(() => {
    if (!shapePickerOpen) return;
    // The popup owns dismissal before canvas gestures and scoped shortcuts.
    // Keep the outside pointer event available to the canvas selection gesture.
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (
        !path.includes(shapeFloating.elements.reference as EventTarget) &&
        !path.includes(shapeFloating.elements.floating as EventTarget)
      )
        setShapePickerOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229)
        return;
      event.preventDefault();
      event.stopPropagation();
      setShapePickerOpen(false);
      rootRef.current
        ?.querySelector<SVGSVGElement>('svg[data-surface="root"]')
        ?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [
    shapePickerOpen,
    shapeFloating.elements.reference,
    shapeFloating.elements.floating,
  ]);
  useEffect(() => {
    if (readonly) setShapePickerOpen(false);
  }, [pointer, readonly]);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const inspectorCollapse = useRef<HTMLButtonElement>(null);
  const inspectorExpand = useRef<HTMLButtonElement>(null);
  const inspectorFocusRequested = useRef(false);
  useLayoutEffect(() => {
    if (!inspectorFocusRequested.current) return;
    inspectorFocusRequested.current = false;
    (inspectorOpen
      ? inspectorCollapse.current
      : inspectorExpand.current
    )?.focus();
  }, [inspectorOpen]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [localPresenting, setLocalPresenting] = useState(false);
  const presenting = presentation?.active ?? localPresenting;
  const previousFocus = useRef<HTMLElement | null>(null);
  const exitPresentation = useCallback(() => {
    if (presentation) {
      presentation.onChange(false);
      return;
    }
    setLocalPresenting(false);
    exitPresentationFullscreen(rootRef.current);
    const focus = previousFocus.current;
    requestAnimationFrame(() => {
      if (focus?.isConnected) focus.focus();
    });
  }, [presentation]);
  const startPresentation = () => {
    controller.current?.flushEditing();
    previousFocus.current = document.activeElement as HTMLElement | null;
    if (presentation) {
      presentation.onChange(true);
      return;
    }
    setLocalPresenting(true);
    const root = rootRef.current;
    // Keep the fullscreen request inside the original user gesture.
    if (root) requestPresentationFullscreen(root);
  };
  useEffect(() => {
    if (suspended && !presentation) exitPresentation();
  }, [suspended, exitPresentation, presentation]);
  const ownsFullscreen = !presentation;
  useEffect(() => {
    const root = rootRef.current;
    return () => {
      if (ownsFullscreen) exitPresentationFullscreen(root);
    };
  }, [ownsFullscreen]);
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
  const requestProperties = (
    pluginId: string,
    cellId: string,
    section: string,
  ) => {
    if (pluginId !== 'mind' || section !== 'note') return;
    setInspectorOpen(true);
    setNoteRequest({ id: cellId, sequence: ++noteRequestSequence.current });
  };
  const propertyRequests = noteRequest
    ? { [`mind:${noteRequest.id}:note`]: noteRequest.sequence }
    : {};

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
  const { registry, extensions } = pluginSet;
  const store = value.store,
    frame = store.cells[frameId];
  const theme = useMemo(
    () =>
      resolveBoardTheme(
        isFrameCell(frame) ? frame.view?.theme : undefined,
        appearance,
      ),
    [frame, appearance],
  );
  const canPresent = useMemo(
    () => hasVisibleContent(store, frameId),
    [store, frameId],
  );
  useEffect(() => {
    if (isFrameCell(frame) && frameId === store.rootId && frame.children.length)
      setTutorialSkipped(true);
  }, [frame, frameId, store.rootId]);
  useEffect(() => {
    if (!navigation || suspended || presenting || !controller.current) return;
    const request = navigation;
    let cancelled = false;
    if (request.target.kind === 'cell')
      void controller.current
        .revealTarget({
          cellId: request.target.cellId,
          requestId: request.requestId,
          signal: request.signal,
        })
        .then((result) => {
          if (!cancelled) onNavigationResult?.(request.requestId, result);
        });
    else
      onNavigationResult?.(request.requestId, {
        status: request.target.kind === 'file' ? 'revealed' : 'unavailable',
        code: request.target.kind === 'heading' ? 'wrong-file-type' : undefined,
      });
    return () => {
      cancelled = true;
    };
  }, [navigation, suspended, presenting, onNavigationResult]);

  const scene = frameScene(store, frameId, registry);
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
    if (!selection.ids.length || frameScene(store, selectionFrameId, registry))
      return [];
    const closure = copyCellFragment(store, selection.ids, registry);
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
          !frameScene(store, target.id, registry) &&
          !closure.cells[target.id] &&
          !target.locked &&
          top(target.id) === top(selectionFrameId),
      );
  }, [store, selection.ids, selectionFrameId, registry]);
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
    const target = activeController();
    const committed = target
      ?.executeAction('canvas.apply-operations', {
        operations,
        restoreView,
        normalizePositions: roundPositions,
      })
      .then((result) =>
        result.status === 'completed' || result.status === 'noop'
          ? { status: 'accepted' as const }
          : {
              status: 'rejected' as const,
              message:
                'message' in result
                  ? result.message
                  : 'code' in result
                    ? result.code
                    : 'Rejected',
            },
      );
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
    const latestStore = controller.current?.runtime.store ?? store;
    const current = latestStore.cells[next.id];
    if (!current) return;
    next = mergeSettingsPatch(store.cells[next.id] ?? current, next, current);
    const lockOnly =
      JSON.stringify({ ...current, locked: false }) ===
      JSON.stringify({ ...next, locked: false });
    if (lockOnly && !!current.locked !== !!next.locked) {
      const target = activeController();
      if (
        target?.runtime.selection.ids.length === 1 &&
        target.runtime.selection.ids[0] === next.id
      )
        void target.executeAction(
          next.locked ? 'canvas.selection.lock' : 'canvas.selection.unlock',
        );
      return;
    }
    if (current.locked || lockedByAncestor(latestStore, next.id)) {
      const unlocking =
        current.locked &&
        !next.locked &&
        !lockedByAncestor(latestStore, next.id) &&
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
  const settingsContext: FramePluginContext = {
    surface: 'product',
    propertyRequests,
    requestProperties,
    store,
    frameId: selectionFrameId,
    selectionIds: uiSelection.ids,
    cell,
    language,
    disabled: cell ? !inspectorEditable : inspectorDisabled,
    controller: activeController(),
    registry,
    readonly: readonly || !!viewState?.readonly,
    pending: busy || !!viewState?.pending,
    locked: !!cell?.locked,
    viewProjection:
      activeController()?.getViewProjection() ?? canonicalFrameProjection,
    clearRevealOverrides: (ids) =>
      activeController()?.clearRevealOverrides(ids),
    runOperations: async (operations, after) =>
      activeController()
        ?.getActionContext()
        .runOperations(operations, after) ?? {
        status: 'rejected',
        code: 'not-ready',
      },
    executeAction: (actionId, args, invocation) =>
      activeController()?.executeAction(actionId, args, invocation) ??
      Promise.resolve({ status: 'rejected', code: 'not-ready' }),
    getActionState: (actionId, args) =>
      activeController()?.getActionState(actionId, args) ?? {
        visible: false,
        enabled: false,
      },
    dispatch,
    allocateId: id,
  };
  const resetWaypointsControl =
    cell && isEdgeCell(cell) ? (
      <button
        type="button"
        data-testid="edge-reset-waypoints"
        disabled={
          !settingsContext.getActionState('canvas.edge.reset-waypoints', {
            edgeId: cell.id,
          }).enabled
        }
        onClick={() =>
          void settingsContext.executeAction('canvas.edge.reset-waypoints', {
            edgeId: cell.id,
          })
        }
      >
        {language === 'zh' ? '清除所有锚点' : 'Reset all waypoints'}
      </button>
    ) : null;
  const contributedProperties = pluginSet.plugins.flatMap((plugin) =>
    (plugin.propertyPanels ?? []).flatMap((panel) => {
      const node = panel.render(settingsContext);
      return node == null ? [] : [{ id: panel.id, pluginId: plugin.id, node }];
    }),
  );
  const contributedSettings = pluginSet.plugins.flatMap((plugin) =>
    (plugin.settingsPanels ?? []).flatMap((panel) => {
      const node = panel.render(settingsContext);
      return node == null ? [] : [{ id: panel.id, node }];
    }),
  );
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
                  backgroundMode: 'theme',
                  boardBackground: resolveBoardTheme(
                    { themeColorMode: mode },
                    mode === ThemeColorMode.dark ? 'dark' : 'light',
                  ).background,
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
        cells: copyCellFragment(store, [targetId], registry).cells,
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
    const importedScene = frameScene(snapshot.store, root.id, registry);
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
          registry,
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
    controller.current?.executeAction('canvas.view.fit');
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
    controller.current?.executeAction('canvas.view.fit');
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (onImportNative && /\.verd(?:\.json)?$/i.test(file.name))
        await onImportNative(file);
      else await importSnapshot(await readDocument(file));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
    event.target.value = '';
  };
  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (onImportNative && /\.verd(?:\.json)?$/i.test(file.name))
        await onImportNative(file);
      else await openDocument(file);
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
      onSelect: () => exportFile(),
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
    cell &&
    isFrameCell(cell) &&
    frameScene(store, cell.id, registry) === 'mind-root'
      ? cell.id
      : mindReferenceTarget &&
          store.cells[mindReferenceTarget] &&
          frameScene(store, mindReferenceTarget, registry) === 'mind-root'
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
        return exportFile('markdown', target);
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
      onSelect: () => exportFile('mermaid'),
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
  if (onCreateDocumentFrame && !frameScene(store, frameId, registry))
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
      onSelect: () =>
        actionScope.current?.openHelp({
          returnFocus: () => menuButton.current,
        }),
    },
    {
      id: 'my',
      label: language === 'zh' ? '设置' : 'Settings',
      icon: UserRound,
      group: 'settings',
      onSelect: () => (onOpenMy ? onOpenMy() : setMyOpen(true)),
    },
  );
  appMenuItems.push({
    id: 'command-palette',
    label: language === 'zh' ? '命令面板' : 'Command palette',
    icon: Keyboard,
    group: 'settings',
    onSelect: () =>
      actionScope.current?.openPalette({
        returnFocus: () => menuButton.current,
      }),
  });
  const productDefinitions: FrameActionDefinition[] = appMenuItems.map(
    (item) => ({
      id: `product.${item.id}`,
      label: productMenuLabels[item.id] ?? item.label,
      category: 'product',
      effect: item.id.startsWith('export') ? 'external' : 'dialog',
      palette: item.id !== 'command-palette',
      shortcuts: (
        {
          export: [{ key: 's', mod: true }],
          'export-image': [{ key: 'e', mod: true, shift: true }],
          clear: [
            { key: 'Backspace', mod: true },
            { key: 'Delete', mod: true },
          ],
          'command-palette': [{ key: 'p', mod: true, shift: true }],
        } as Record<string, import('@sue/board-common').ActionShortcut[]>
      )[item.id],
      getState: () => ({ enabled: !item.disabled }),
      execute: (_context, _args, invocation) => {
        if (item.id === 'command-palette') {
          actionScope.current?.openPalette(
            invocation.source === 'shortcut'
              ? undefined
              : {
                  returnFocus: () => menuButton.current,
                },
          );
          return { status: 'completed' };
        }
        const result = item.onSelect();
        return result && typeof result === 'object' && 'then' in result
          ? result.then(() => ({ status: 'completed' as const }))
          : { status: 'completed' };
      },
    }),
  );
  productDefinitions.push({
    id: 'product.import-image',
    label: { zh: '插入图片', en: 'Insert image' },
    category: 'product',
    effect: 'dialog',
    shortcuts: [{ key: 'u', mod: true }],
    getState: (context) => ({
      enabled: !context.disabled && !busy && !placing,
    }),
    execute: () => {
      imageInput.current?.click();
      return { status: 'completed' };
    },
  });
  if (onDuplicateReference)
    productDefinitions.push({
      id: 'product.reference.duplicate',
      label: { zh: '创建引用副本', en: 'Duplicate referenced diagram' },
      category: 'product',
      effect: 'content',
      getState: (context) => ({
        visible:
          context.selectionIds.length > 0 &&
          context.selectionIds.every((id) =>
            isFrameReferenceCell(context.store.cells[id]),
          ),
        enabled: !context.disabled,
      }),
      execute: (context) => {
        onDuplicateReference([...context.selectionIds]);
        return { status: 'completed' };
      },
    });
  productDefinitions.push(
    {
      id: 'product.find',
      label: { zh: '查找', en: 'Find' },
      category: 'product',
      effect: 'view',
      flushEditing: true,
      shortcuts: [{ key: 'f', mod: true }],
      execute: () => {
        setFindOpen(true);
        findInput.current?.focus();
        findInput.current?.select();
        return { status: 'completed' };
      },
    },
    {
      id: 'product.choose-shape',
      label: { zh: '选择形状', en: 'Choose shape' },
      category: 'draw',
      effect: 'dialog',
      getState: (c) => c.getActionState('draw.shape'),
      validateArgs: (args: unknown): args is { open?: boolean } | undefined =>
        args === undefined ||
        (!!args &&
          typeof args === 'object' &&
          ((args as { open?: unknown }).open === undefined ||
            typeof (args as { open?: unknown }).open === 'boolean')),
      execute: (_c, args?: { open?: boolean }) => {
        imageRequest.current++;
        setPointer('select');
        setShapePickerOpen((open) => args?.open ?? !open);
        return { status: 'completed' };
      },
    },
    {
      id: 'product.inspector.toggle',
      label: { zh: '属性', en: 'Properties' },
      category: 'product',
      effect: 'view',
      getState: () => ({ checked: inspectorOpen }),
      execute: (_context, _args, invocation) => {
        inspectorFocusRequested.current = invocation.source === 'toolbar';
        setInspectorOpen((open) => !open);
        return { status: 'completed' };
      },
    },
    {
      id: 'product.presentation',
      label: { zh: '演示', en: 'Present' },
      category: 'product',
      effect: 'view',
      getState: () => ({ enabled: canPresent }),
      execute: () => {
        startPresentation();
        return { status: 'completed' };
      },
    },
    {
      id: 'product.stylus.exit',
      label: { zh: '退出手写模式', en: 'Exit stylus mode' },
      category: 'product',
      effect: 'view',
      getState: () => ({ visible: stylusMode }),
      execute: () => {
        setStylusMode(false);
        return { status: 'completed' };
      },
    },
    ...(
      ['mind', 'workflow', 'architecture', 'uml-class', 'uml-sequence'] as const
    ).map((kind) => ({
      id: `product.diagram.${kind}`,
      label: {
        zh: {
          mind: '思维导图',
          workflow: '流程图',
          architecture: '架构图',
          'uml-class': 'UML 类图',
          'uml-sequence': 'UML 时序图',
        }[kind],
        en: {
          mind: 'Mind Map',
          workflow: 'Flowchart',
          architecture: 'Architecture',
          'uml-class': 'UML Class Diagram',
          'uml-sequence': 'UML Sequence Diagram',
        }[kind],
      },
      category: 'draw',
      effect: 'view' as const,
      shortcuts: kind === 'mind' ? [{ key: 'm' }] : undefined,
      getState: (c: FramePluginContext) => ({
        checked: pointer === kind,
        visible: !frameScene(c.store, c.frameId, c.registry),
        enabled: !c.disabled,
      }),
      execute: () => {
        setPointer(kind);
        return { status: 'completed' as const };
      },
    })),
  );
  // Global chrome owns the outer viewport/tool; content commands use the
  // deepest active occurrence. The action definition stays the same.
  const targetFor = (id: string) =>
    id.startsWith('product.') ||
    id.startsWith('draw.') ||
    id.startsWith('canvas.tool.') ||
    id.startsWith('canvas.view.')
      ? controller.current
      : activeController();
  const stateFor = (id: string, args?: unknown) => {
    const state = targetFor(id)?.getActionState(id, args) ?? {
      visible: true,
      enabled: false,
    };
    return { ...state, enabled: state.visible && state.enabled };
  };
  const definitionFor = (id: string) =>
    targetFor(id)
      ?.actions()
      .find((action) => action.id === id) ??
    productDefinitions.find((action) => action.id === id) ??
    pluginSet.plugins
      .flatMap((plugin) => plugin.actions ?? [])
      .find((action) => action.id === id);
  const labelFor = (id: string, fallback = id) => {
    const definition = definitionFor(id);
    return definition ? actionLabel(definition.label, language) : fallback;
  };
  const shortcutFor = (id: string) => {
    const shortcut = definitionFor(id)?.shortcuts?.[0];
    return shortcut ? formatActionShortcut(shortcut) : undefined;
  };
  const actionTitle = (id: string) => {
    const label = labelFor(id),
      shortcut = shortcutFor(id);
    const title = shortcut ? `${label} — ${shortcut}` : label;
    const state = stateFor(id);
    return !state.enabled
      ? `${title} — ${frameDisabledReason(state.reason, language)}`
      : title;
  };
  const runAction = (id: string, args?: unknown) =>
    void targetFor(id)?.executeAction(id, args, { source: 'toolbar' });
  const domainButton = (id: string, icon: typeof Square, testId?: string) => {
    const state = stateFor(id);
    return state.visible ? (
      <FrameIconButton
        actionId={id}
        testId={testId}
        label={labelFor(id)}
        title={actionTitle(id)}
        icon={icon}
        disabled={!state.enabled}
        pressed={state.checked}
        tooltipPlacement="right"
        onClick={() => runAction(id)}
      />
    ) : null;
  };
  const detailTargetId = cell
    ? isFrameCell(cell)
      ? cell.id
      : isFrameReferenceCell(cell)
        ? cell.data.targetFrameId
        : activeController()?.runtime.index.parentOf.get(cell.id)
    : undefined;
  productDefinitions.push({
    id: 'product.frame.open',
    label: { zh: '打开详情', en: 'Open details' },
    category: 'product',
    effect: 'view',
    palette: false,
    validateArgs: (args: unknown): args is { frameId: string } =>
      !!args &&
      typeof args === 'object' &&
      typeof (args as { frameId?: unknown }).frameId === 'string',
    getState: (c, args: { frameId: string }) => ({
      enabled: isFrameCell(c.store.cells[args.frameId]),
    }),
    execute: (c, args: { frameId: string }) => {
      const selected =
        c.selectionIds.length === 1
          ? c.store.cells[c.selectionIds[0]]
          : undefined;
      const reference =
        selected &&
        isFrameReferenceCell(selected) &&
        selected.data.targetFrameId === args.frameId
          ? selected
          : undefined;
      onOpenFrame(
        args.frameId,
        reference
          ? {
              sourceFileId: c.fileId ?? c.frameId,
              refId: reference.id,
              occurrenceId: `${c.occurrenceId ?? c.frameId}/${reference.id}`,
            }
          : undefined,
      );
      return { status: 'completed' };
    },
  });
  const routedMenu: FrameAppMenuItem[] = [
    ...(['undo', 'redo'] as const).map((direction) => ({
      id: direction,
      actionId: `canvas.history.${direction}`,
      label: labelFor(`canvas.history.${direction}`),
      icon: direction === 'undo' ? Undo2 : Redo2,
      group: 'history',
      disabled: !stateFor(`canvas.history.${direction}`).enabled,
      shortcut: shortcutFor(`canvas.history.${direction}`),
      onSelect: () => {
        void controller.current?.executeAction(
          `canvas.history.${direction}`,
          undefined,
          { source: 'menu' },
        );
      },
    })),
    ...appMenuItems.map((item) => ({
      ...item,
      actionId: `product.${item.id}`,
      onSelect: () => {
        void controller.current?.executeAction(`product.${item.id}`);
      },
    })),
  ];
  return (
    <ThemedActionScope
      theme={theme}
      registry={combineFrameActionSources(
        [
          activeController()?.actionSource,
          controller.current?.actionSource,
        ].filter((source): source is ActionSource => !!source),
      )}
      language={language}
      enabled={!suspended && !presenting}
      onReady={(value) => {
        actionScope.current = value;
      }}
    >
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
          if (
            (event.target as Element).closest('svg[aria-label="Frame canvas"]')
          )
            event.preventDefault();
        }}
      >
        <div
          className={`frame-canvas-area${findOpen ? ' frame-canvas-area--finding' : ''}`}
        >
          {!inspectorOpen && (
            <div className="frame-inspector-reopen">
              <FrameIconButton
                label={language === 'zh' ? '展开属性面板' : 'Expand properties'}
                icon={PanelRightOpen}
                actionId="product.inspector.toggle"
                testId="inspector-expand"
                buttonRef={inspectorExpand}
                buttonProps={{ 'aria-expanded': false }}
                onClick={() => runAction('product.inspector.toggle')}
              />
            </div>
          )}
          <div className="frame-canvas-fill">
            <FrameCanvas
              appearance={appearance}
              referenceInteraction={scene ? 'direct' : 'activate'}
              documentReferences={documentReferences}
              ref={controller}
              linkHost={linkHost}
              actionHost={{
                language,
                propertyRequests,
                requestProperties,
                actions: productDefinitions,
                setTool: (tool) => {
                  setActionTool(tool);
                  const [pointerKey, variant] = tool.key?.split(':') ?? [];
                  setPointerState(
                    pointerKey ??
                      (['select', 'hand', 'erase'].includes(tool.mode)
                        ? tool.mode
                        : 'custom'),
                  );
                  if (pointerKey === 'shape' && variant) setShape(variant);
                  if (
                    pointerKey === 'pen' &&
                    [
                      'nibPen',
                      'feltTipPen',
                      'artisticBrush',
                      'markerHighlight',
                    ].includes(variant)
                  )
                    setPen(variant as typeof pen);
                },
              }}
              value={value}
              frameId={frameId}
              initialFocusCellId={initialFocusCellId}
              readonly={readonly}
              history={history}
              interactionSettings={interactionSettings}
              pluginSet={pluginSet}
              extensions={extensions}
              style={{ position: 'absolute', inset: 0 }}
              viewportInsets={{
                top: 112 + Math.max(0, chromeHeight.toolbar - 42),
                right: 16,
                bottom: Math.max(64, chromeHeight.bottom + 32),
                left: 64,
              }}
              tool={
                actionTool ??
                (pointer === 'hand'
                  ? { mode: 'hand' }
                  : scene
                    ? { mode: 'select' }
                    : drawing)
              }
              onViewStateChange={viewStateStore.publish}
              onCanvasContextMenu={setActionsPoint}
              onChange={onChange}
              onSelectionChange={setSelection}
              onOpenFrame={onOpenFrame}
              instanceHost={instanceHost}
              suspended={suspended || myOpen || presenting}
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
              onReject={(result) =>
                setFailure(result.message ?? 'Edit rejected')
              }
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
              onAgentSelection={onAgentSelection}
              point={actions.point}
              store={actions.controller.runtime.store}
              selection={actions.selection}
              controller={actions.controller}
              onClose={() => {
                setActionsPoint(null);
              }}
              onFailure={setFailure}
            />
          )}
          <div
            className={`frame-top-actions${findOpen ? ' frame-top-actions--finding' : ''}`}
            ref={appToolbar}
          >
            <div
              className="frame-app-toolbar"
              role="toolbar"
              aria-label="App actions"
            >
              {showSaveStatus && (
                <FrameSaveStatus
                  status={saveStatus}
                  lastSavedAt={lastSavedAt}
                  onRetrySave={onRetrySave}
                />
              )}
              {stylusMode && (
                <button
                  aria-label="Exit stylus mode"
                  onClick={() => runAction('product.stylus.exit')}
                >
                  退出手写模式
                </button>
              )}
              {controller.current && (
                <FrameFindBar
                  key={frameId}
                  store={value.store}
                  frameId={frameId}
                  controller={controller.current}
                  inputRef={findInput}
                  open={findOpen && !presenting && !suspended}
                  onClose={() => {
                    setFindOpen(false);
                    rootRef.current
                      ?.querySelector<SVGSVGElement>(
                        'svg[aria-label="Frame canvas"]',
                      )
                      ?.focus();
                  }}
                />
              )}
              {!findOpen && (
                <FrameIconButton
                  label={labelFor('product.find')}
                  title={actionTitle('product.find')}
                  icon={Search}
                  disabled={!stateFor('product.find').enabled}
                  onClick={() => runAction('product.find')}
                />
              )}
              {onStartAgent && !presenting && (
                <WorkspaceButton
                  type="button"
                  size="small"
                  intent="ghost"
                  data-testid="canvas-agent-launch"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onStartAgent}
                >
                  <Bot size={16} aria-hidden />
                  {agentLaunchLabel(language)}
                </WorkspaceButton>
              )}
              <FrameIconButton
                label={labelFor('product.presentation')}
                icon={Presentation}
                disabled={!stateFor('product.presentation').enabled}
                onClick={() => runAction('product.presentation')}
              />
              <FrameAppMenu
                items={routedMenu}
                source={controller.current?.actionSource}
                buttonRef={menuButton}
                onOpen={() => {
                  setShapePickerOpen(false);
                  setActionsPoint(null);
                }}
              />
            </div>
          </div>
          <div
            className="frame-tools"
            role="toolbar"
            aria-label="Drawing tools"
          >
            <div className="frame-tool-group">
              {(
                [
                  ['select', MousePointer2],
                  ['hand', Hand],
                ] as const
              ).map(([tool, icon]) => (
                <FrameIconButton
                  tooltipPlacement="right"
                  key={tool}
                  label={labelFor(`canvas.tool.${tool}`, labels[tool])}
                  title={actionTitle(`canvas.tool.${tool}`)}
                  icon={icon}
                  pressed={!!stateFor(`canvas.tool.${tool}`).checked}
                  disabled={!stateFor(`canvas.tool.${tool}`).enabled}
                  onClick={() =>
                    void controller.current?.executeAction(
                      `canvas.tool.${tool}`,
                    )
                  }
                />
              ))}
            </div>
            {!scene ? (
              <>
                <div className="frame-tool-group">
                  {(
                    [
                      ['shape', Square],
                      ['text', Type],
                      ['pen', Pencil],
                      ['erase', Eraser],
                      ['table', Table2],
                      ['frame', Frame],
                    ] as const
                  ).map(([tool, icon]) => (
                    <FrameIconButton
                      tooltipPlacement="right"
                      key={tool}
                      label={labelFor(`draw.${tool}`, labels[tool])}
                      title={actionTitle(`draw.${tool}`)}
                      icon={icon}
                      pressed={
                        !!stateFor(`draw.${tool}`).checked ||
                        (tool === 'shape' &&
                          !!stateFor('draw.vector-line').checked)
                      }
                      disabled={
                        !stateFor(
                          tool === 'shape'
                            ? 'product.choose-shape'
                            : `draw.${tool}`,
                        ).enabled
                      }
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
                      onClick={() =>
                        runAction(
                          tool === 'shape'
                            ? 'product.choose-shape'
                            : `draw.${tool}`,
                          tool === 'shape'
                            ? { open: !shapePickerOpen }
                            : tool === 'pen'
                              ? { pen }
                              : undefined,
                        )
                      }
                    />
                  ))}
                </div>
                <div className="frame-tool-group">
                  <FrameToolMenu
                    label={labels.connectors}
                    icon={Spline}
                    value={pointer}
                    disabled={!stateFor('draw.arrow').enabled}
                    onChange={(value) => runAction(`draw.${value}`)}
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
                          language === 'zh'
                            ? '双向箭头'
                            : 'Bidirectional arrow',
                        icon: ArrowLeftRight,
                      },
                      { id: 'line', label: labels.line, icon: Minus },
                      { id: 'curve', label: labels.curve, icon: Spline },
                    ].map((item) => ({
                      ...item,
                      label: labelFor(`draw.${item.id}`, item.label),
                      shortcut: shortcutFor(`draw.${item.id}`),
                      checked: stateFor(`draw.${item.id}`).checked,
                      disabled: !stateFor(`draw.${item.id}`).enabled,
                    }))}
                  />
                  <FrameToolMenu
                    label={labels.diagrams}
                    icon={Network}
                    value={pointer}
                    disabled={!stateFor('product.diagram.mind').enabled}
                    onChange={(value) => runAction(`product.diagram.${value}`)}
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
                    ].map((item) => ({
                      ...item,
                      label: labelFor(`product.diagram.${item.id}`, item.label),
                      shortcut: shortcutFor(`product.diagram.${item.id}`),
                      checked: stateFor(`product.diagram.${item.id}`).checked,
                      disabled: !stateFor(`product.diagram.${item.id}`).enabled,
                    }))}
                  />
                  <FrameIconButton
                    tooltipPlacement="right"
                    label={labels.image}
                    title={actionTitle('product.import-image')}
                    icon={ImageIcon}
                    disabled={!stateFor('product.import-image').enabled}
                    onClick={() => runAction('product.import-image')}
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
                        cardLabel={language === 'zh' ? '卡片' : 'Card'}
                        onSelectCard={() => {
                          runAction('draw.card');
                          setShapePickerOpen(false);
                        }}
                        onChange={(next) => {
                          runAction('draw.shape', { shape: next });
                          setShapePickerOpen(false);
                        }}
                        pathLabel={labels['vector-line']}
                        onSelectPath={() => {
                          runAction('draw.vector-line');
                          setShapePickerOpen(false);
                        }}
                      />
                    </FloatingFocusManager>
                  </FloatingPortal>
                )}
                {pointer === 'pen' && (
                  <div className="frame-tool-group">
                    <FrameToolMenu
                      label={language === 'zh' ? '笔型' : 'Pen style'}
                      icon={Brush}
                      value={pen}
                      disabled={!stateFor('draw.pen').enabled}
                      onChange={(value) =>
                        runAction('draw.pen', { pen: value })
                      }
                      items={(
                        [
                          ['nibPen', '钢笔', 'Nib pen'],
                          ['feltTipPen', '毡头笔', 'Felt-tip pen'],
                          ['artisticBrush', '艺术画笔', 'Artistic brush'],
                          ['markerHighlight', '荧光笔', 'Highlighter'],
                        ] as const
                      ).map(([id, zh, en]) => ({
                        id,
                        label: language === 'zh' ? zh : en,
                        icon: Brush,
                        checked: id === pen,
                      }))}
                    />
                  </div>
                )}
              </>
            ) : scene === 'uml-class-root' || scene === 'uml-sequence-root' ? (
              <FrameUmlToolPalette
                key={`${frameId}:${scene}`}
                store={store}
                frameId={frameId}
                language={language}
                labelFor={labelFor}
                titleFor={actionTitle}
                stateFor={stateFor}
                executeAction={(id, args) =>
                  targetFor(id)?.executeAction(id, args, {
                    source: 'toolbar',
                  }) ??
                  Promise.resolve({ status: 'rejected', code: 'not-ready' })
                }
              />
            ) : scene === 'workflow-start' ? (
              <div className="frame-tool-group">
                {domainButton('workflow.task', Square, 'palette-task')}
                {domainButton('workflow.decision', Diamond, 'palette-decision')}
                {domainButton('workflow.start', Workflow)}
              </div>
            ) : scene === 'architecture-layer' ? (
              <div className="frame-tool-group">
                {domainButton('architecture.box', Square)}
                {domainButton('architecture.store', Database)}
                {domainButton('architecture.layer', Layers3)}
              </div>
            ) : (
              <div className="frame-tool-group">
                {domainButton('mind.add-child', ListTree)}
                {domainButton('mind.root', CircleDot)}
              </div>
            )}
            {stateFor('draw.swimlane').visible && (
              <div className="frame-tool-group">
                {domainButton('draw.swimlane', Columns3)}
              </div>
            )}
            {scene && (
              <div className="frame-tool-group">
                {domainButton('draw.card', FileText)}
              </div>
            )}
            {stateFor('mind.summary').visible && (
              <div className="frame-tool-group">
                {domainButton('mind.summary', Braces)}
              </div>
            )}
          </div>
          <div className="frame-bottom-controls" ref={bottomControls}>
            <FrameRecenterControl
              viewStateStore={viewStateStore}
              controller={controller}
              language={language}
              label={t('canvasStatus.recenter')}
            />
            <div className="frame-status-bar" data-testid="canvas-status-bar">
              {scene === 'workflow-start' &&
                (() => {
                  const command = {
                    type: 'layout' as const,
                    style: 'flow' as const,
                  };
                  const state = controller.current?.getActionState(
                    frameSelectionActionId(command),
                  );
                  return (
                    <FrameTooltip
                      disabled={!state?.enabled}
                      content={
                        !state?.enabled
                          ? frameDisabledReason(state?.reason, language)
                          : undefined
                      }
                    >
                      <button
                        data-testid="workflow-auto-layout"
                        disabled={!state?.enabled}
                        onClick={() =>
                          void controller.current?.executeAction(
                            frameSelectionActionId(command),
                          )
                        }
                      >
                        {t('arrange.flow')}
                      </button>
                    </FrameTooltip>
                  );
                })()}
              <button
                data-testid="canvas-status-fit"
                disabled={!stateFor('canvas.view.fit').enabled}
                onClick={() => runAction('canvas.view.fit')}
              >
                {labelFor('canvas.view.fit', labels.fit)}
              </button>
              <FrameZoomControls
                viewStateStore={viewStateStore}
                controller={controller}
              />
            </div>
          </div>
        </div>
        <ProductPropertyPanel
          active={!suspended && !presenting && !myOpen}
          key={frameId}
          open={inspectorOpen}
          cellId={cell?.id}
          identity={inspectorIdentity}
          disabled={inspectorDisabled}
          headerActions={
            <FrameIconButton
              label={language === 'zh' ? '收起属性面板' : 'Collapse properties'}
              icon={PanelRightClose}
              actionId="product.inspector.toggle"
              testId="inspector-collapse"
              buttonRef={inspectorCollapse}
              buttonProps={{ 'aria-expanded': true }}
              onClick={() => runAction('product.inspector.toggle')}
            />
          }
          title={
            <>
              {cell && isNodeCell(cell) ? (
                <>
                  <span className="frame-inspector__type">
                    {inspectorTitle}
                  </span>
                  <FrameSettingsControl
                    key={cell.id}
                    field={{
                      key: 'inspector-name',
                      editor: 'input',
                      props: {
                        type: 'text',
                        'aria-label': language === 'zh' ? '名称' : 'Name',
                        'data-testid': 'inspector-name',
                        placeholder: inspectorTitle,
                        title: cell.name ?? nameText?.plainText ?? '',
                        disabled:
                          busy ||
                          readonly ||
                          viewState?.readonly ||
                          !selectionAllows(
                            store,
                            [cell.id],
                            registry,
                            'edit',
                            frameId,
                          ),
                      },
                    }}
                    value={
                      cell.name ??
                      nameText?.plainText.replace(/[\r\n]+/g, ' ') ??
                      ''
                    }
                    onCommit={(value) => replace({ ...cell, name: value })}
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
                <FrameGeometryControls
                  values={displayedGeometry!}
                  identity={cell.id}
                  disabled={(key) =>
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
                  minDimension={0}
                  precision={0}
                  onCommit={(key, value) => {
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
              getStore={getInspectorStore}
              key={cell?.id ?? frameId}
              store={store}
              frameId={frameId}
              cell={cell}
              zh={language === 'zh'}
              disabled={cell ? !inspectorEditable : inspectorDisabled}
              dispatch={dispatch}
              executeAction={settingsContext.executeAction}
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
                  controller={activeController()}
                  appearance={appearance}
                  frameId={frameId}
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
                  controller={activeController()}
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
              (isEdgeCell(cell) && !cell.kind.startsWith('uml-')) ||
              contributedProperties.length > 0) && (
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
                          <FrameSettingsControl
                            field={{
                              key: 'Roughness',
                              editor: 'input',
                              props: {
                                'aria-label': 'Roughness',
                                type: 'range',
                                min: '0',
                                max: '3',
                                step: '0.25',
                              },
                            }}
                            value={
                              (cell.data as { roughness?: number } | undefined)
                                ?.roughness ?? 0
                            }
                            onCommit={(value) =>
                              replace({
                                ...cell,
                                data: {
                                  ...(cell.data as object),
                                  roughness: Number(value),
                                },
                              })
                            }
                          />
                        </label>
                      )}
                      {contributedProperties.map((panel) => (
                        <div key={panel.id} data-settings-panel={panel.id}>
                          {panel.node}
                        </div>
                      ))}
                      {['mind-root', 'mind-child', 'mind-summary'].includes(
                        cell.kind,
                      ) &&
                        !contributedProperties.some(
                          (panel) => panel.pluginId === 'mind',
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
                              noteRequest?.id === cell.id
                                ? noteRequest.sequence
                                : 0
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
                  {!isNodeCell(cell) &&
                    contributedProperties.map((panel) => (
                      <div key={panel.id} data-settings-panel={panel.id}>
                        {panel.node}
                      </div>
                    ))}
                  {cell && isNodeCell(cell) && cell.kind === 'vector-line' && (
                    <label>
                      {language === 'zh' ? '路径' : 'Path'}
                      <FrameSettingsControl
                        field={{
                          key: 'Vector line shape',
                          editor: 'select',
                          props: {
                            'aria-label': 'Vector line shape',
                            children: (
                              <>
                                <option value="straight">
                                  {language === 'zh' ? '直线' : 'Straight'}
                                </option>
                                <option value="curve">
                                  {language === 'zh' ? '曲线' : 'Curve'}
                                </option>
                              </>
                            ),
                          },
                        }}
                        value={
                          (cell.data as { shape?: string })?.shape ?? 'straight'
                        }
                        onCommit={(value) =>
                          replace(
                            setVectorLineShape(
                              cell as NodeCell<VectorLineData>,
                              value as VectorLineData['shape'],
                            ),
                          )
                        }
                      />
                    </label>
                  )}
                  {cell &&
                    (isFrameCell(cell) || isFrameReferenceCell(cell)) && (
                      <label>
                        {language === 'zh' ? '比例' : 'Aspect'}
                        <FrameSettingsControl
                          field={{
                            key: 'frame-product-shell.0',
                            editor: 'select',
                            props: {
                              'aria-label':
                                language === 'zh'
                                  ? '比例'
                                  : 'Frame aspect ratio',
                              children: (
                                <>
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
                                </>
                              ),
                            },
                          }}
                          value={cell.aspectRatio ?? 'custom'}
                          onCommit={(value) => {
                            const aspectRatio =
                              value as import('@sue/board-core').FrameAspectRatio;
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
                        />
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
                              onOpenLink={linkHost?.openLink}
                              locale={language}
                              linkActivation={
                                interactionSettings.linkActivation
                              }
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
                            <FrameSettingsControl
                              field={{
                                key: 'frame-product-shell.0',
                                editor: 'input',
                                props: {
                                  'aria-label': `Edge label position ${index + 1}`,
                                  type: 'range',
                                  min: '0',
                                  max: '1',
                                  step: '.01',
                                },
                              }}
                              value={label.position ?? 0.5}
                              onCommit={(value) => {
                                const next = [
                                  ...(cell.labels?.length
                                    ? cell.labels
                                    : [label]),
                                ];
                                next[index] = {
                                  ...label,
                                  position: Number(value),
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
                            <FrameSettingsControl
                              field={{
                                key: 'Edge route',
                                editor: 'select',
                                props: {
                                  'aria-label': 'Edge route',
                                  children: (
                                    <>
                                      <option value="auto">
                                        {language === 'zh' ? '自动' : 'Auto'}
                                      </option>
                                      {!registry.get(cell.kind)
                                        ?.orthogonalRoute && (
                                        <option value="straight">
                                          {language === 'zh'
                                            ? '直线'
                                            : 'Straight'}
                                        </option>
                                      )}
                                      <option value="orthogonal">
                                        {language === 'zh'
                                          ? '正交'
                                          : 'Orthogonal'}
                                      </option>
                                      {!registry.get(cell.kind)
                                        ?.orthogonalRoute && (
                                        <option value="curve">
                                          {language === 'zh' ? '曲线' : 'Curve'}
                                        </option>
                                      )}
                                      {cell.route.mode === 'fixed' && (
                                        <option value="fixed">
                                          {language === 'zh'
                                            ? '固定折线'
                                            : 'Fixed polyline'}
                                        </option>
                                      )}
                                    </>
                                  ),
                                },
                              }}
                              value={cell.route.mode}
                              onCommit={(value) => {
                                const mode = value as
                                  'auto' | 'straight' | 'orthogonal' | 'curve';
                                replace({
                                  ...cell,
                                  route: {
                                    mode,
                                    ...((mode === 'auto' ||
                                      mode === 'orthogonal') &&
                                    'strategy' in cell.route &&
                                    cell.route.strategy
                                      ? { strategy: cell.route.strategy }
                                      : {}),
                                  },
                                });
                              }}
                            />
                          </label>
                          {resetWaypointsControl}
                          {!(
                            cell.kind === 'architecture-edge' &&
                            (cell.data as { relation?: string } | undefined)
                              ?.relation
                          ) &&
                            (['sourceMarker', 'targetMarker'] as const).map(
                              (end) => (
                                <label key={end}>
                                  {end === 'sourceMarker'
                                    ? language === 'zh'
                                      ? '起点箭头'
                                      : 'Start marker'
                                    : language === 'zh'
                                      ? '终点箭头'
                                      : 'End marker'}
                                  <FrameSettingsControl
                                    field={{
                                      key: 'frame-product-shell.1',
                                      editor: 'select',
                                      props: {
                                        'aria-label': end,
                                        children: (
                                          <>
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
                                              <option
                                                key={marker}
                                                value={marker}
                                              >
                                                {
                                                  (
                                                    {
                                                      none:
                                                        language === 'zh'
                                                          ? '无'
                                                          : 'None',
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
                                          </>
                                        ),
                                      },
                                    }}
                                    value={
                                      (
                                        cell.data as
                                          Record<string, string> | undefined
                                      )?.[end] ??
                                      (end === 'sourceMarker'
                                        ? 'none'
                                        : 'arrow')
                                    }
                                    onCommit={(value) =>
                                      replace({
                                        ...cell,
                                        data: {
                                          ...(cell.data as object),
                                          [end]: value,
                                        },
                                      })
                                    }
                                  />
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
                  <FrameSettingsControl
                    field={{
                      key: 'Theme',
                      editor: 'select',
                      props: {
                        'aria-label': 'Theme',
                        children: (
                          <>
                            {Object.values(ThemeColorMode).map((mode) => (
                              <option key={mode} value={mode}>
                                {t(`theme.${mode}`)}
                              </option>
                            ))}
                          </>
                        ),
                      },
                    }}
                    value={
                      isFrameCell(frame)
                        ? resolveBoardTheme(frame.view?.theme, appearance).id
                        : ThemeColorMode.default
                    }
                    onCommit={(value) => setTheme(value as ThemeColorMode)}
                  />
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
                  <FrameSettingsControl
                    field={{
                      key: 'frame-product-shell.2',
                      editor: 'input',
                      props: { type: 'color' },
                    }}
                    value={isFrameCell(frame) ? theme.background : '#f8fafc'}
                    onCommit={(value) => {
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
                                    boardBackground: value,
                                    backgroundMode: 'custom',
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
                  <button
                    type="button"
                    aria-label="Reset canvas background"
                    onClick={() =>
                      setTheme(
                        frame.view?.theme?.themeColorMode ??
                          ThemeColorMode.default,
                      )
                    }
                  >
                    {language === 'zh'
                      ? '恢复主题背景'
                      : 'Use theme background'}
                  </button>
                )}
                {isFrameCell(frame) && (
                  <>
                    <label>
                      {language === 'zh' ? '网格' : 'Grid'}
                      <FrameSettingsControl
                        field={{
                          key: 'Canvas grid',
                          editor: 'input',
                          props: {
                            'aria-label': 'Canvas grid',
                            type: 'checkbox',
                          },
                        }}
                        value={!!frame.view?.theme?.gridEnabled}
                        onCommit={(value) =>
                          replace(
                            {
                              ...frame,
                              view: {
                                ...frame.view,
                                theme: {
                                  themeColorMode: ThemeColorMode.default,
                                  ...frame.view?.theme,
                                  gridEnabled: value,
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
          {contributedSettings.length > 0 && (
            <FramePropertyGroup
              id="plugin-settings"
              title={language === 'zh' ? '扩展设置' : 'Extension settings'}
            >
              {contributedSettings.map((panel) => (
                <div key={panel.id} data-settings-panel={panel.id}>
                  {panel.node}
                </div>
              ))}
            </FramePropertyGroup>
          )}
          {(selected.length > 0 ||
            frameScene(store, selectionFrameId, registry) !== 'mind-root') && (
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
                {selection.ids.length > 0 &&
                  (() => {
                    const lanes = frameLanes(store, selectionFrameId, registry);
                    if (!lanes.length) return null;
                    const label =
                      language === 'zh' ? '分配泳道' : 'Assign swimlane';
                    return (
                      <label>
                        {label}
                        <FrameSettingsControl<string>
                          field={{
                            key: 'Assign swimlane',
                            editor: 'select',
                            props: {
                              'aria-label': label,
                              children: (
                                <>
                                  <option value="" disabled>
                                    {label}
                                  </option>
                                  <option value="remove">
                                    {language === 'zh'
                                      ? '移出泳道'
                                      : 'Remove from swimlane'}
                                  </option>
                                  {lanes.map((lane, index) => (
                                    <option
                                      key={JSON.stringify([
                                        lane.containerId,
                                        lane.id,
                                      ])}
                                      value={index}
                                    >
                                      {lane.label ||
                                        `${language === 'zh' ? '泳道' : 'Lane'} ${index + 1}`}
                                    </option>
                                  ))}
                                </>
                              ),
                            },
                          }}
                          value=""
                          onCommit={(value) => {
                            const lane = lanes[Number(value)];
                            if (value === 'remove')
                              runAction('draw.assign-swimlane', null);
                            else if (value && lane)
                              runAction('draw.assign-swimlane', {
                                containerId: lane.containerId,
                                laneId: lane.id,
                              });
                          }}
                        />
                      </label>
                    );
                  })()}
                {cell?.kind === 'architecture-layer' && (
                  <div className="frame-property-icons">
                    {([-1, 1] as const).map((direction) => {
                      const id =
                        direction < 0
                          ? 'architecture.layer-up'
                          : 'architecture.layer-down';
                      return (
                        <button
                          key={id}
                          data-action-id={id}
                          aria-label={labelFor(id)}
                          disabled={!stateFor(id).enabled}
                          onClick={() => runAction(id)}
                        >
                          {direction < 0 ? (
                            <ArrowUp
                              strokeWidth={1.75}
                              size={16}
                              aria-hidden="true"
                            />
                          ) : (
                            <ArrowDown
                              strokeWidth={1.75}
                              size={16}
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {cell && isNodeCell(cell) && (
                  <>
                    <label>
                      {language === 'zh' ? '锁定' : 'Locked'}
                      <FrameSettingsControl
                        field={{
                          key: 'frame-product-shell.3',
                          editor: 'input',
                          props: {
                            type: 'checkbox',
                            disabled: !stateFor(
                              cell.locked
                                ? 'canvas.selection.unlock'
                                : 'canvas.selection.lock',
                            ).enabled,
                          },
                        }}
                        value={!!cell.locked}
                        onCommit={(value) =>
                          replace({ ...cell, locked: value })
                        }
                      />
                    </label>
                  </>
                )}
                {!!transferTargets.length && (
                  <label>
                    {language === 'zh' ? '移入容器' : 'Move to frame'}
                    <FrameSettingsControl
                      field={{
                        key: 'Move to frame',
                        editor: 'select',
                        props: {
                          'aria-label': 'Move to frame',
                          children: (
                            <>
                              <option value="">
                                {language === 'zh'
                                  ? '选择容器'
                                  : 'Choose frame'}
                              </option>
                              {transferTargets.map((target) => (
                                <option key={target.id} value={target.id}>
                                  {target.content?.label ||
                                    (target.id === store.rootId
                                      ? '白板'
                                      : target.id)}
                                </option>
                              ))}
                            </>
                          ),
                        },
                      }}
                      value={
                        transferTargets.some(
                          (target) => target.id === transferTarget,
                        )
                          ? transferTarget
                          : ''
                      }
                      onCommit={(value) => setTransferTarget(value)}
                    />
                    <button
                      aria-label="Move selection to frame"
                      disabled={
                        !transferTargets.some(
                          (target) => target.id === transferTarget,
                        )
                      }
                      onClick={() => {
                        void controller.current
                          ?.executeAction('canvas.selection.move', {
                            targetFrameId: transferTarget,
                          })
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
                    {!frameScene(store, selectionFrameId, registry) &&
                      (['front', 'forward', 'backward', 'back'] as const).map(
                        (direction, index) => (
                          <button
                            key={direction}
                            disabled={
                              !stateFor(`canvas.order.${direction}`).enabled
                            }
                            aria-label={labelFor(`canvas.order.${direction}`)}
                            onClick={() =>
                              runAction(`canvas.order.${direction}`)
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
              {cell?.kind === 'uml-relation' && resetWaypointsControl}
              {cell &&
                (isFrameCell(cell) ||
                  isFrameReferenceCell(cell) ||
                  [
                    'mind-root',
                    'workflow-start',
                    'architecture-layer',
                  ].includes(cell.kind)) && (
                  <button
                    data-testid="frame-open"
                    disabled={
                      !stateFor('product.frame.open', {
                        frameId: detailTargetId,
                      }).enabled
                    }
                    onClick={() =>
                      runAction('product.frame.open', {
                        frameId: detailTargetId,
                      })
                    }
                  >
                    {labelFor('product.frame.open', labels.open)}
                  </button>
                )}{' '}
              <button
                className="frame-property-delete"
                disabled={!stateFor('canvas.selection.delete').enabled}
                onClick={() => runAction('canvas.selection.delete')}
              >
                {labelFor('canvas.selection.delete', labels.delete)}
              </button>
            </FramePropertyGroup>
          )}
          {detachedFrameIds.map((id) => (
            <button key={id} onClick={() => onOpenFrame(id)}>
              {store.cells[id]?.kind}: {id}
            </button>
          ))}
        </ProductPropertyPanel>

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
            appearance={appearance}
            themeBackground={(mode) =>
              resolveBoardTheme(
                isFrameCell(frame) ? frame.view?.theme : undefined,
                mode,
              ).background
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
              dispatch(clearFrameCells(store, frameId, registry));
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
          accept="application/json,.verd,.verd.json,.md,.markdown,.mmd,.mermaid"
          onChange={(event) => void importFile(event)}
        />
        <input
          hidden
          ref={openInput}
          type="file"
          accept="application/json,.verd,.verd.json,.md,.markdown,.mmd,.mermaid"
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
              onClick={() =>
                void navigator.clipboard.writeText(markdownPreview)
              }
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
            linkHost={linkHost}
            documentReferences={documentReferences}
            value={value}
            frameId={frameId}
            pluginSet={pluginSet}
            extensions={extensions}
            instanceHost={instanceHost}
            interactionSettings={interactionSettings}
            fullscreenRoot={presentation?.fullscreenRoot ?? rootRef.current}
            ownsFullscreen={!presentation}
            navigation={navigation}
            onNavigationResult={onNavigationResult}
            onBack={presentation?.onBack}
            onExit={exitPresentation}
          />
        )}
      </div>
    </ThemedActionScope>
  );
}
