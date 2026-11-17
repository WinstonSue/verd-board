import type { FrameAutoCalculationConfig } from './frame-auto-calculation';
import {
  createActionRegistry,
  type ActionResult,
  type ActionRegistry,
} from '@sue/board-common';
import {
  copyCellFragment,
  deleteCells,
  focusedCellIds,
  isFrameCell,
  planCellPaste,
  reorderCells,
  resolveCellArrangementScope,
  selectionAllows,
  type ArrangementCommand,
  type CellOperation,
} from '@sue/board-core';
import type {
  FrameActionContext,
  FrameActionDefinition,
} from './frame-plugins';
import type { FrameIntentResult } from './frame-canvas';

export type FrameSelectionOperation =
  | ArrangementCommand
  | {
      type: 'group' | 'ungroup' | 'lock' | 'unlock' | 'fit-content';
    }
  | { type: 'reroute' }
  | { type: 'optimize-routes' };
export function frameSelectionActionId(
  command: FrameSelectionOperation,
): string {
  return command.type === 'align'
    ? `canvas.align.${command.axis}`
    : command.type === 'distribute'
      ? `canvas.distribute.${command.axis}`
      : command.type === 'layout'
        ? `canvas.layout.${command.style}`
        : command.type === 'optimize-routes'
          ? 'canvas.edges.optimize'
          : command.type === 'reroute'
            ? 'canvas.edges.reroute'
            : `canvas.selection.${command.type}`;
}
export interface FrameActionServices {
  resetWaypointPlan?(edgeId: string): CellOperation[];
  getAutoCalculation?(): FrameAutoCalculationConfig;
  toggleAutoCalculation?(kind: 'layout' | 'edges'): void;
  selectionState(command: FrameSelectionOperation): {
    enabled: boolean;
    reason?: string;
  };
  selectionExecute(
    command: FrameSelectionOperation,
  ): Promise<FrameIntentResult>;
  prepareClipboard(
    kind: 'copy' | 'cut' | 'paste',
  ): () => Promise<FrameIntentResult>;
  flushEditing(): Promise<FrameIntentResult>;
  settleClipboard(
    perform: () => Promise<FrameIntentResult>,
  ): Promise<FrameIntentResult>;
  history(kind: 'undo' | 'redo'): void | Promise<unknown>;
  movePlan(targetFrameId: string): CellOperation[];
  canHistory(kind: 'undo' | 'redo'): boolean;
  fit(): void;
  centerSelection(): void;
  centerState(): { enabled: boolean; reason?: string };
  setZoom(value: number): void;
  getZoom(): number;
  select(ids: readonly string[]): void;
  exit(): void;
  edit(id: string): void;
  copyLink?(): Promise<ActionResult>;
}
export const frameIntentActionResult = (
  result: FrameIntentResult,
): ActionResult =>
  result.status === 'accepted'
    ? { status: 'completed' }
    : result.message === 'scope-disposed'
      ? { status: 'cancelled', code: 'scope-disposed' }
      : { status: 'rejected', code: 'edit-rejected', message: result.message };
const editingState = (c: FrameActionContext) => ({
  enabled: !c.disabled,
  reason: c.pending
    ? 'pending'
    : c.readonly
      ? 'readonly'
      : c.locked
        ? 'locked'
        : undefined,
});

export function createFrameActions(options: {
  getContext(): FrameActionContext;
  refresh(context: FrameActionContext): FrameActionContext | null;
  services(): FrameActionServices;
  definitions(): readonly FrameActionDefinition[];
}): ActionRegistry<FrameActionContext> {
  const registry = createActionRegistry({
    getContext: options.getContext,
    refresh: options.refresh,
    beforeExecute: async () =>
      frameIntentActionResult(await options.services().flushEditing()),
  });
  const add = (definition: FrameActionDefinition) =>
    registry.register(definition);
  add({
    id: 'canvas.edge.reset-waypoints',
    label: { zh: '清除所有锚点', en: 'Reset all waypoints' },
    category: 'canvas',
    effect: 'content',
    palette: false,
    validateArgs: (args: unknown): args is { edgeId: string } =>
      !!args &&
      typeof args === 'object' &&
      typeof (args as { edgeId?: unknown }).edgeId === 'string',
    getState: (c, args: { edgeId: string }) => ({
      ...editingState(c),
      enabled:
        !c.disabled &&
        (options.services().resetWaypointPlan?.(args.edgeId)?.length ?? 0) > 0,
    }),
    execute: (c, args: { edgeId: string }) =>
      c.runOperations(
        options.services().resetWaypointPlan?.(args.edgeId) ?? [],
      ),
  });
  const selectionLabel = (
    command: FrameSelectionOperation,
    language: 'zh' | 'en',
    fallback: string,
  ) => {
    if (
      command.type !== 'layout' &&
      command.type !== 'reroute' &&
      command.type !== 'optimize-routes'
    )
      return fallback;
    const c = options.getContext();
    const selection = c.controller?.runtime.selection;
    if (!selection) return fallback;
    const scope = resolveCellArrangementScope(c.store, selection);
    const scopeLabel =
      language === 'zh'
        ? { group: '组内', frame: '当前画布', selection: '所选对象' }[
            scope.kind
          ]
        : {
            group: 'group contents',
            frame: 'current canvas',
            selection: 'selection',
          }[scope.kind];
    return `${fallback} (${scopeLabel})`;
  };
  const selectionAction = (
    id: string,
    zh: string,
    en: string,
    command: FrameSelectionOperation,
    shortcuts?: FrameActionDefinition['shortcuts'],
  ) =>
    add({
      id,
      label: {
        get zh() {
          return selectionLabel(command, 'zh', zh);
        },
        get en() {
          return selectionLabel(command, 'en', en);
        },
      },
      category: 'canvas',
      effect: 'content',
      shortcuts,
      getState: (c) => {
        const state = options.services().selectionState(command);
        const reasons: Record<string, Record<'zh' | 'en', string>> = {
          'layout-overlap': {
            zh: '布局结果会与范围外或锁定节点重叠，未应用。请调整范围或位置后重试。',
            en: 'Layout would overlap an outside or locked node. Nothing was changed; adjust the scope or positions and retry.',
          },
          'already-optimized': {
            zh: '当前路径已优化',
            en: 'The current paths are optimized',
          },
          'no-routes-to-optimize': {
            zh: '当前范围没有可优化的自动线或正交线，或连线已锁定',
            en: 'No editable automatic or orthogonal routes in this scope, or the routes are locked',
          },
          'no-routes-to-reset': {
            zh: '当前范围没有可重置的手工折点；自动连线会随节点位置更新',
            en: 'No editable manual paths to reset; automatic routes update when nodes move',
          },
        };
        return {
          ...state,
          reason: reasons[state.reason ?? '']?.[c.language] ?? state.reason,
        };
      },
      execute: async () =>
        frameIntentActionResult(
          await options.services().selectionExecute(command),
        ),
    });
  selectionAction(
    'canvas.selection.group',
    '组合',
    'Group',
    { type: 'group' },
    [{ key: 'g', mod: true }],
  );
  selectionAction(
    'canvas.selection.ungroup',
    '取消组合',
    'Ungroup',
    { type: 'ungroup' },
    [{ key: 'g', mod: true, shift: true }],
  );
  selectionAction('canvas.selection.lock', '锁定', 'Lock', { type: 'lock' });
  selectionAction('canvas.selection.unlock', '解锁', 'Unlock', {
    type: 'unlock',
  });
  selectionAction(
    'canvas.selection.fit-content',
    '根据内容调整大小',
    'Fit content',
    { type: 'fit-content' },
  );
  for (const axis of [
    'left',
    'center',
    'right',
    'top',
    'middle',
    'bottom',
  ] as const)
    selectionAction(
      `canvas.align.${axis}`,
      {
        left: '左对齐',
        center: '水平居中',
        right: '右对齐',
        top: '顶对齐',
        middle: '垂直居中',
        bottom: '底对齐',
      }[axis],
      {
        left: 'Align left',
        center: 'Align horizontal centers',
        right: 'Align right',
        top: 'Align top',
        middle: 'Align vertical centers',
        bottom: 'Align bottom',
      }[axis],
      { type: 'align', axis },
    );
  for (const axis of ['horizontal', 'vertical'] as const)
    selectionAction(
      `canvas.distribute.${axis}`,
      axis === 'horizontal' ? '水平等距分布' : '垂直等距分布',
      axis === 'horizontal'
        ? 'Distribute horizontally'
        : 'Distribute vertically',
      { type: 'distribute', axis },
    );
  for (const style of [
    'grid',
    'horizontal',
    'vertical',
    'relationships',
    'flow',
    'layers',
  ] as const)
    selectionAction(
      `canvas.layout.${style}`,
      `布局节点：${{ grid: '网格', horizontal: '横向', vertical: '纵向', relationships: '按连接关系', flow: '按连线层级', layers: '按架构层' }[style]}`,
      `Layout nodes: ${style}`,
      { type: 'layout', style },
    );
  for (const kind of ['layout', 'edges'] as const) {
    add({
      id:
        kind === 'layout'
          ? 'canvas.layout.auto.toggle'
          : 'canvas.edges.auto.toggle',
      label: {
        get zh() {
          const scope = options.services().getAutoCalculation?.()[kind]?.scope;
          return `${kind === 'layout' ? '自动布局节点' : '自动优化连线'}${scope ? `（${{ frame: '当前画布', group: '组内', selection: '固定选区' }[scope.kind]}）` : ''}`;
        },
        get en() {
          const scope = options.services().getAutoCalculation?.()[kind]?.scope;
          return `${kind === 'layout' ? 'Auto layout nodes' : 'Auto optimize edges'}${scope ? ` (${scope.kind})` : ''}`;
        },
      },
      category: 'canvas',
      effect: 'view',
      getState: (c) => {
        const checked = !!options.services().getAutoCalculation?.()[kind];
        return {
          ...editingState(c),
          enabled: !c.pending && (checked || !c.disabled),
          checked,
        };
      },
      execute: () => {
        options.services().toggleAutoCalculation?.(kind);
        return { status: 'completed' };
      },
    });
  }
  selectionAction(
    'canvas.edges.reroute',
    '重置手工走线',
    'Reset manual paths',
    {
      type: 'reroute',
    },
  );
  selectionAction(
    'canvas.edges.optimize',
    '优化全部连线',
    'Optimize all edges',
    { type: 'optimize-routes' },
  );
  for (const kind of ['copy', 'cut', 'paste'] as const)
    add({
      id: `canvas.clipboard.${kind}`,
      label: {
        zh: { copy: '复制', cut: '剪切', paste: '粘贴' }[kind],
        en: { copy: 'Copy', cut: 'Cut', paste: 'Paste' }[kind],
      },
      category: 'canvas',
      effect: kind === 'copy' ? 'external' : 'content',
      flushEditing: true,
      shortcuts: [
        {
          key: { copy: 'c', cut: 'x', paste: 'v' }[kind],
          mod: true,
          transport: 'clipboard',
        },
      ],
      getState: (c) =>
        kind === 'copy'
          ? { enabled: c.selectionIds.length > 0 }
          : {
              ...editingState(c),
              enabled:
                !c.disabled && (kind === 'paste' || c.selectionIds.length > 0),
            },
      beforeFlush: (
        _c,
        args: { performNative?: () => Promise<FrameIntentResult> } | undefined,
      ) => args?.performNative ?? options.services().prepareClipboard(kind),
      execute: async (_c, _args, invocation) => {
        const perform =
          invocation.preflight as () => Promise<FrameIntentResult>;
        return frameIntentActionResult(
          await options.services().settleClipboard(perform),
        );
      },
    });
  add({
    id: 'canvas.selection.all',
    flushEditing: true,
    label: { zh: '全选当前容器', en: 'Select all' },
    category: 'canvas',
    effect: 'view',
    shortcuts: [{ key: 'a', mod: true }],
    execute(c) {
      options
        .services()
        .select(
          focusedCellIds(
            c.store,
            c.controller!.runtime.selection.focus.at(-1) ?? c.frameId,
          ).filter((id) => !c.store.cells[id]?.hidden),
        );
      return { status: 'completed' };
    },
  });
  add({
    id: 'canvas.selection.delete',
    label: { zh: '删除', en: 'Delete' },
    category: 'canvas',
    effect: 'content',
    shortcuts: [{ key: 'Delete' }, { key: 'Backspace' }],
    getState(c) {
      return {
        ...editingState(c),
        enabled:
          !c.disabled &&
          c.selectionIds.length > 0 &&
          selectionAllows(
            c.store,
            [...c.selectionIds],
            c.registry,
            'delete',
            c.frameId,
          ),
      };
    },
    execute: (c) =>
      c.runOperations(
        deleteCells(c.store, [...c.selectionIds], { registry: c.registry }),
        { selectionIds: [] },
      ),
  });
  add({
    id: 'canvas.selection.duplicate',
    label: { zh: '复制副本', en: 'Duplicate' },
    category: 'canvas',
    effect: 'content',
    shortcuts: [{ key: 'd', mod: true }],
    getState: (c) => ({ enabled: !c.disabled && c.selectionIds.length > 0 }),
    execute(c) {
      const plan = planCellPaste({
        fileId: c.fileId ?? c.store.rootId,
        store: c.store,
        frameId: c.frameId,
        selectionIds: c.selectionIds,
        fragment: copyCellFragment(c.store, [...c.selectionIds], c.registry, {
          fileId: c.fileId ?? c.store.rootId,
        }),
        allocateId: c.allocateId,
        registry: c.registry,
        intent: 'duplicate',
        offset: [20, 20],
      });
      return c.runOperations(plan.operations, {
        selectionIds: plan.selection.ids,
      });
    },
  });
  for (const direction of ['forward', 'backward', 'front', 'back'] as const)
    add({
      id: `canvas.order.${direction}`,
      label: {
        zh: {
          forward: '上移一层',
          backward: '下移一层',
          front: '置于顶层',
          back: '置于底层',
        }[direction],
        en: {
          forward: 'Bring forward',
          backward: 'Send backward',
          front: 'Bring to front',
          back: 'Send to back',
        }[direction],
      },
      category: 'canvas',
      effect: 'content',
      shortcuts: [
        {
          key: direction === 'forward' || direction === 'front' ? ']' : '[',
          mod: true,
          shift: direction === 'front' || direction === 'back',
        },
      ],
      getState: (c) => ({ enabled: !c.disabled && c.selectionIds.length > 0 }),
      execute(c) {
        return c.runOperations(
          reorderCells(c.store, c.frameId, [...c.selectionIds], direction),
        );
      },
    });
  for (const kind of ['undo', 'redo'] as const)
    add({
      id: `canvas.history.${kind}`,
      label: {
        zh: kind === 'undo' ? '撤销' : '重做',
        en: kind === 'undo' ? 'Undo' : 'Redo',
      },
      category: 'canvas',
      effect: 'history',
      flushEditing: true,
      shortcuts: [
        { key: 'z', mod: true, shift: kind === 'redo', repeat: true },
        ...(kind === 'redo' ? [{ key: 'y', mod: true, repeat: true }] : []),
      ],
      getState: (c) => ({
        enabled:
          !c.readonly && !c.pending && options.services().canHistory(kind),
      }),
      async execute() {
        await options.services().history(kind);
        return { status: 'completed' };
      },
    });
  for (const [id, zh, en, key, run] of [
    [
      'fit',
      '适配画布',
      'Fit canvas',
      undefined,
      () => options.services().fit(),
    ],
    [
      'center',
      '重新居中',
      'Re-center',
      undefined,
      () => options.services().centerSelection(),
    ],
    [
      'zoom-in',
      '放大',
      'Zoom in',
      '=',
      () => options.services().setZoom(options.services().getZoom() + 0.1),
    ],
    [
      'zoom-out',
      '缩小',
      'Zoom out',
      '-',
      () => options.services().setZoom(options.services().getZoom() - 0.1),
    ],
    [
      'zoom-reset',
      '缩放至100%',
      'Reset zoom',
      '0',
      () => options.services().setZoom(1),
    ],
  ] as const)
    add({
      id: `canvas.view.${id}`,
      label: { zh, en },
      category: 'canvas',
      effect: 'view',
      getState: () => (id === 'center' ? options.services().centerState() : {}),
      shortcuts: key
        ? [
            { key, mod: true, repeat: true },
            ...(id === 'zoom-in'
              ? [{ key: '+', mod: true, shift: true, repeat: true }]
              : []),
          ]
        : id === 'fit'
          ? [{ key: '1', mod: true }]
          : id === 'center'
            ? [{ key: '2', mod: true }]
            : undefined,
      execute() {
        run();
        return { status: 'completed' };
      },
    });
  add({
    id: 'canvas.selection.edit',
    flushEditing: true,
    label: { zh: '编辑文字', en: 'Edit text' },
    category: 'canvas',
    effect: 'view',
    validateArgs: (a: unknown): a is { cellId?: string } | undefined =>
      a === undefined ||
      (!!a &&
        typeof a === 'object' &&
        typeof (a as { cellId?: unknown }).cellId === 'string'),
    getState: (c, a: { cellId?: string } | undefined) => ({
      enabled:
        !c.disabled &&
        !!c.store.cells[a?.cellId ?? c.selectionIds[0]] &&
        (a?.cellId !== undefined || c.selectionIds.length === 1),
    }),
    execute(c, a: { cellId?: string } | undefined) {
      options.services().edit(a?.cellId ?? c.selectionIds[0]);
      return { status: 'completed' };
    },
  });
  add({
    id: 'canvas.view.set-zoom',
    label: 'Set zoom',
    category: 'canvas',
    effect: 'view',
    palette: false,
    validateArgs: (args: unknown): args is { zoom: number } =>
      !!args &&
      typeof args === 'object' &&
      Number.isFinite((args as { zoom?: number }).zoom),
    execute: (_c, args: { zoom: number }) => {
      options.services().setZoom(args.zoom);
      return { status: 'completed' };
    },
  });
  add({
    id: 'canvas.link.copy',
    label: { zh: '复制对象链接', en: 'Copy object link' },
    category: 'canvas',
    effect: 'external',
    getState: (c) => ({
      visible: !!options.services().copyLink,
      enabled: c.selectionIds.length === 1,
    }),
    execute: () => options.services().copyLink!(),
  });
  add({
    id: 'canvas.apply-operations',
    label: 'Apply operations',
    category: 'canvas',
    effect: 'content',
    palette: false,
    concurrency: 'queue',
    validateArgs: (
      args: unknown,
    ): args is {
      operations: CellOperation[];
      restoreView?: boolean;
      normalizePositions?: boolean;
    } =>
      !!args &&
      typeof args === 'object' &&
      Array.isArray((args as { operations?: unknown }).operations),
    getState: editingState,
    execute: (
      c,
      args: {
        operations: CellOperation[];
        restoreView?: boolean;
        normalizePositions?: boolean;
      },
    ) =>
      c.runOperations(args.operations, {
        restoreView: args.restoreView,
        normalizePositions: args.normalizePositions,
      }),
  });
  add({
    id: 'canvas.selection.move',
    label: { zh: '移动到其他画布', en: 'Move to another canvas' },
    category: 'canvas',
    effect: 'content',
    palette: false,
    validateArgs: (args: unknown): args is { targetFrameId: string } =>
      !!args &&
      typeof args === 'object' &&
      typeof (args as { targetFrameId?: unknown }).targetFrameId === 'string',
    getState: (c, args: { targetFrameId: string }) => ({
      ...editingState(c),
      enabled:
        !c.disabled &&
        c.selectionIds.length > 0 &&
        isFrameCell(c.store.cells[args.targetFrameId]) &&
        !c.store.cells[args.targetFrameId].locked &&
        args.targetFrameId !== c.frameId,
    }),
    execute: (c, args: { targetFrameId: string }) =>
      c.runOperations(options.services().movePlan(args.targetFrameId)),
  });
  for (const [mode, key, zh, en] of [
    ['select', 'v', '选择', 'Select'],
    ['hand', 'h', '手型', 'Hand'],
  ] as const)
    add({
      id: `canvas.tool.${mode}`,
      flushEditing: true,
      label: { zh, en },
      category: 'canvas',
      effect: 'view',
      shortcuts: [{ key }],
      getState: (c) => ({
        visible: !!c.setTool,
        enabled: !!c.setTool && !c.pending,
        checked: (c.tool?.mode ?? 'select') === mode,
      }),
      execute: (c) => {
        c.setTool?.({ mode });
        return { status: 'completed' };
      },
    });
  add({
    id: 'canvas.container.enter',
    flushEditing: true,
    label: { zh: '进入容器', en: 'Enter container' },
    category: 'canvas',
    effect: 'view',
    getState: (c) => ({
      enabled:
        c.selectionIds.length === 1 &&
        (c.cell?.cellType === 'frame' || c.cell?.cellType === 'group'),
    }),
    execute: (c) => {
      const selection = c.controller!.runtime.selection;
      c.controller!.runtime.select({
        focus: [...selection.focus, c.selectionIds[0]],
        ids: [],
      });
      return { status: 'completed' };
    },
  });
  add({
    id: 'canvas.container.exit',
    flushEditing: true,
    label: { zh: '退出容器', en: 'Exit container' },
    category: 'canvas',
    effect: 'view',
    getState: (c) => ({
      enabled: (c.controller?.runtime.selection.focus.length ?? 1) > 1,
    }),
    execute: () => {
      options.services().exit();
      return { status: 'completed' };
    },
  });
  for (const definition of options.definitions()) add(definition);
  registry.seal();
  return registry;
}
