import {
  frameScene,
  isFrameCell,
  isEdgeCell,
  isFrameReferenceCell,
  isNodeCell,
  type CellOperation,
  type FrameCell,
  type NodeCell,
} from '@sue/board-core';
import {
  addMindChild,
  createMindChildCell,
  createMindPlugin,
  createMindRootCell,
  createMindSummaries,
  DEFAULT_MIND_MAX_WIDTH,
  mindChildIds,
  prepareMindReveal,
  type MindChildData,
  type MindMetricsOptions,
  type MindRootData,
} from '@sue/board-mind';
import {
  type FrameActionContext,
  type FramePluginContext,
  type FrameUIPlugin,
} from '@sue/board-react';
import { createMindFrameExtensions } from './frame-extension';
import { FrameMindProperties, MindSchemeField } from './frame-mind-properties';
import { projectEmbeddedMindTrees } from './frame-projection';
import { MindUISettings } from './settings';
const isTopic = (c: FrameActionContext) =>
  !!c.cell && ['mind-root', 'mind-child'].includes(c.cell.kind);
const creationParent = (c: FrameActionContext) => {
  if (isTopic(c)) return c.cell;
  const frame = c.store.cells[c.frameId];
  const roots = isFrameCell(frame)
    ? frame.children
        .map((id) => c.store.cells[id])
        .filter((cell) => cell?.kind === 'mind-root')
    : [];
  return roots.length === 1 ? roots[0] : undefined;
};
const summaryParent = (c: FrameActionContext) => {
  const branch = Object.values(c.store.cells).find(
    (cell) =>
      isEdgeCell(cell) &&
      cell.kind === 'mind-branch' &&
      'cellId' in cell.target &&
      cell.target.cellId === c.selectionIds[0],
  );
  if (!isEdgeCell(branch) || !('cellId' in branch.source)) return undefined;
  const siblings = mindChildIds(c.store, branch.source.cellId);
  return c.selectionIds.length > 0 &&
    c.selectionIds.every((id) => siblings.includes(id))
    ? branch.source.cellId
    : undefined;
};
const isMindNode = (c: FrameActionContext) =>
  !!c.cell && ['mind-root', 'mind-child', 'mind-summary'].includes(c.cell.kind);
const parentBranch = (c: FrameActionContext) =>
  Object.values(c.store.cells).find(
    (cell) =>
      isEdgeCell(cell) &&
      cell.kind === 'mind-branch' &&
      'cellId' in cell.target &&
      cell.target.cellId === c.cell?.id,
  );
export interface MindUIPluginOptions extends MindMetricsOptions {}
export const createMindUIPlugin = (
  options: MindUIPluginOptions = {},
): FrameUIPlugin => ({
  messages: {
    zh: {
      'mind.maxNodeWidth': '节点最大宽度',
      'mind.widthMode': '最大宽度来源',
      'mind.followDefault': '跟随应用默认',
      'mind.customWidth': '自定义宽度',
      'mind.effectiveWidth': '当前最大宽度',
    },
    en: {
      'mind.maxNodeWidth': 'Maximum node width',
      'mind.widthMode': 'Maximum width source',
      'mind.followDefault': 'Follow application default',
      'mind.customWidth': 'Custom width',
      'mind.effectiveWidth': 'Effective maximum width',
    },
  },
  id: 'mind',
  prepareReveal: prepareMindReveal,
  engine: createMindPlugin(),
  extensions: (registry) => createMindFrameExtensions(registry, options),
  cells: {
    'mind-root': {
      topic: true,
      pasteTarget: true,
      embeddedPan: true,
      defaultFontSize: 20,
      defaultTextAlignment: 'left',
    },
    'mind-child': {
      topic: true,
      pasteTarget: true,
      pointerMove: true,
      expandShortcut: true,
      defaultTextAlignment: 'left',
    },
    'mind-summary': {
      topic: true,
      pointerMove: false,
      defaultTextAlignment: 'left',
    },
    'mind-branch': { branch: true },
    'mind-summary-edge': { branch: true },
  },
  projectEmbedded: projectEmbeddedMindTrees,
  fitLayoutBounds: (store, id) => {
    const frame = store.cells[id];
    return (
      isFrameCell(frame) &&
      frame.children.some((id) => store.cells[id]?.kind === 'mind-root')
    );
  },
  referenceOffsets: (cell) =>
    isFrameReferenceCell(cell) ? cell.data.mindOffsets : undefined,
  updateOffset(cell, rootId, offset) {
    if (isFrameReferenceCell(cell))
      return {
        ...cell,
        data: {
          ...cell.data,
          mindOffsets: { ...cell.data.mindOffsets, [rootId]: offset },
        },
      };
    return cell.kind === 'mind-root' && isNodeCell(cell)
      ? {
          ...cell,
          data: { ...(cell.data as MindRootData), embeddedOffset: offset },
        }
      : cell;
  },
  pasteImage(c) {
    return c.hit &&
      isNodeCell(c.hit) &&
      ['mind-root', 'mind-child', 'mind-summary'].includes(c.hit.kind)
      ? [
          {
            type: 'replace_cell',
            cell: {
              ...c.hit,
              geometry: {
                ...c.hit.geometry,
                width: Math.max(c.hit.geometry.width, c.image.width + 16),
              },
              data: { ...(c.hit.data as object), image: c.image },
            },
          },
        ]
      : undefined;
  },
  pasteText(c) {
    if (
      frameScene(c.store, c.frameId, c.registry) !== 'mind-root' &&
      c.registry.plugins.length !== 1 &&
      !(c.hit && ['mind-root', 'mind-child'].includes(c.hit.kind))
    )
      return undefined;
    const node = createMindChildCell(c.allocateId());
    node.content = { label: c.text };
    if (c.hit && ['mind-root', 'mind-child'].includes(c.hit.kind))
      return addMindChild(c.store, c.hit.id, node, c.allocateId());
    const root = {
      ...createMindRootCell(node.id, c.at),
      content: node.content,
    };
    return [{ type: 'insert_cell', parentId: c.frameId, cell: root }];
  },
  actions: [
    {
      id: 'mind.root',
      label: { zh: '中心主题', en: 'Central topic' },
      category: 'mind',
      effect: 'content',
      getState: (c) => ({ enabled: !c.disabled }),
      execute: (c) => {
        const cell = createMindRootCell(c.allocateId());
        return c.runOperations(
          [{ type: 'insert_cell', parentId: c.frameId, cell }],
          { selectionIds: [cell.id], editId: cell.id },
        );
      },
    },
    {
      id: 'mind.add-child',
      label: { zh: '子主题', en: 'Add child topic' },
      keywords: ['添加子主题', 'child topic'],
      category: 'mind',
      effect: 'content',
      shortcuts: [{ key: 'Tab' }],
      shortcutWhen: (c) => isTopic(c),
      getState: (c) => ({
        visible: !!creationParent(c),
        enabled:
          !c.disabled && !!creationParent(c) && !creationParent(c)!.locked,
      }),
      execute: (c) => {
        const cell = createMindChildCell(c.allocateId());
        return c.runOperations(
          addMindChild(c.store, creationParent(c)!.id, cell, c.allocateId()),
          { selectionIds: [cell.id], editId: cell.id },
        );
      },
    },
    {
      id: 'mind.add-sibling',
      label: { zh: '添加同级主题', en: 'Add sibling topic' },
      category: 'mind',
      effect: 'content',
      shortcuts: [{ key: 'Enter' }],
      getState: (c) => ({
        visible: c.cell?.kind === 'mind-child',
        enabled: !c.disabled && !!parentBranch(c),
      }),
      execute: (c) => {
        const branch = parentBranch(c);
        if (!branch || !isEdgeCell(branch) || !('cellId' in branch.source))
          return { status: 'rejected', code: 'missing-parent' };
        const cell = createMindChildCell(c.allocateId());
        return c.runOperations(
          addMindChild(
            c.store,
            branch.source.cellId,
            cell,
            c.allocateId(),
            mindChildIds(c.store, branch.source.cellId).indexOf(c.cell!.id) + 1,
            c.cell!.id,
          ),
          { selectionIds: [cell.id], editId: cell.id },
        );
      },
    },
    {
      id: 'mind.toggle-collapse',
      label: { zh: '展开或收起分支', en: 'Expand or collapse branch' },
      category: 'mind',
      effect: 'content',
      shortcuts: [{ key: '/' }, { key: '/', mod: true }],
      getState: (c) => ({
        visible: c.cell?.kind === 'mind-child',
        enabled:
          !c.disabled && isNodeCell(c.cell) && c.cell.kind === 'mind-child',
        checked: !!(
          isNodeCell(c.cell) &&
          (c.cell.data as MindChildData)?.collapsed &&
          !c.viewProjection.expandedCellIds.has(c.cell.id)
        ),
      }),
      execute: async (c) => {
        if (!isNodeCell(c.cell))
          return { status: 'rejected', code: 'missing-topic' };
        const collapsed = !!(c.cell.data as MindChildData)?.collapsed;
        const effectiveCollapsed =
          collapsed && !c.viewProjection.expandedCellIds.has(c.cell.id);
        const next = !effectiveCollapsed;
        const result = await c.runOperations(
          collapsed === next
            ? []
            : [
                {
                  type: 'replace_cell',
                  cell: {
                    ...c.cell,
                    data: {
                      ...(c.cell.data as MindChildData),
                      collapsed: next,
                    },
                  },
                },
              ],
        );
        if (result.status === 'completed' || result.status === 'noop')
          c.clearRevealOverrides?.([c.cell.id]);
        return result;
      },
    },
    {
      id: 'mind.open-note',
      label: { zh: '打开主题笔记', en: 'Open topic note' },
      category: 'mind',
      effect: 'dialog',
      shortcuts: [{ key: 'n', mod: true, shift: true }],
      getState: (c) => ({
        visible: isMindNode(c),
        enabled: !c.disabled && isMindNode(c) && !!c.requestProperties,
      }),
      execute: (c) => {
        c.requestProperties?.('mind', c.cell!.id, 'note');
        return { status: 'completed' };
      },
    },
    {
      id: 'mind.summary',
      label: { zh: '概要', en: 'Summary' },
      category: 'mind',
      effect: 'content',
      getState: (c) => ({
        visible: c.selectionIds.some(
          (id) => c.store.cells[id]?.kind === 'mind-child',
        ),
        enabled: !c.disabled && !!summaryParent(c),
      }),
      execute: (c) => {
        const parent = summaryParent(c);
        return parent
          ? c.runOperations(
              createMindSummaries(
                c.store,
                parent,
                c.selectionIds,
                c.allocateId,
              ),
            )
          : { status: 'rejected', code: 'missing-parent' };
      },
    },
    {
      id: 'mind.update-properties',
      label: { zh: '修改脑图属性', en: 'Update mind properties' },
      category: 'mind',
      effect: 'content',
      validateArgs: (args: unknown): args is { operations: CellOperation[] } =>
        !!args &&
        typeof args === 'object' &&
        Array.isArray((args as { operations?: unknown }).operations),
      getState: (c, args) => ({ visible: !!args, enabled: !c.disabled }),
      execute: (c, args: { operations: CellOperation[] }) =>
        c.runOperations(args.operations),
    },
  ],
  tools: [
    { id: 'mind.root', actionId: 'mind.root' },
    { id: 'mind.child', actionId: 'mind.add-child' },
    { id: 'mind.summary', actionId: 'mind.summary' },
  ],
  Properties: (c: FramePluginContext) =>
    isNodeCell(c.cell) && c.cell.kind.startsWith('mind-') ? (
      <MindUISettings.Provider
        value={{ maxNodeWidth: options.maxNodeWidth ?? DEFAULT_MIND_MAX_WIDTH }}
      >
        <FrameMindProperties
          cell={c.cell}
          store={c.store}
          frame={
            isFrameCell(c.store.cells[c.frameId])
              ? (c.store.cells[c.frameId] as FrameCell)
              : undefined
          }
          getCell={() =>
            (c.controller?.runtime.store ?? c.store).cells[
              c.cell!.id
            ] as NodeCell
          }
          replace={(cell) => {
            void c.executeAction('mind.update-properties', {
              operations: [{ type: 'replace_cell', cell }],
            });
          }}
          dispatch={(operations) => {
            void c.executeAction('mind.update-properties', { operations });
          }}
          readonly={c.disabled}
          openNoteRequest={c.propertyRequests?.[`mind:${c.cell.id}:note`] ?? 0}
        />
      </MindUISettings.Provider>
    ) : null,
  Settings: (c) => (
    <MindSchemeField
      frame={
        isFrameCell(c.store.cells[c.frameId])
          ? (c.store.cells[c.frameId] as FrameCell)
          : undefined
      }
      apply={(cell) => {
        void c.executeAction('mind.update-properties', {
          operations: [{ type: 'replace_cell', cell }],
        });
      }}
      readonly={c.disabled}
    />
  ),
});
