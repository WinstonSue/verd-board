import { FrameSettingsControl } from '@sue/board-react';
import {
  addArchitectureModule,
  createArchitectureLayerCell,
  createArchitectureModuleCell,
  createArchitecturePlugin,
  reorderArchitectureLayers,
  moveArchitectureModuleToLayer,
  type ArchitectureLayerData,
  type ArchitectureModuleData,
} from '@sue/board-architecture';
import {
  indexCells,
  isFrameCell,
  isNodeCell,
  lockedByAncestor,
  selectionAllows,
  type NodeCell,
} from '@sue/board-core';
import {
  type FrameActionContext,
  type FramePluginContext,
  type FrameUIPlugin,
} from '@sue/board-react';
import { createArchitectureFrameExtensions } from './frame-extension';
import { ArchitectureLayerField } from './layer-field';
const layersOf = (c: FramePluginContext) => {
  const frame = c.store.cells[c.frameId];
  return isFrameCell(frame)
    ? frame.children
        .map((id) => c.store.cells[id])
        .filter(
          (cell): cell is NodeCell<ArchitectureLayerData> =>
            isNodeCell(cell) && cell.kind === 'architecture-layer',
        )
        .sort((a, b) => a.data!.order.localeCompare(b.data!.order))
    : [];
};
const activeLayer = (c: FramePluginContext) =>
  c.cell?.kind === 'architecture-layer'
    ? c.cell.id
    : c.cell
      ? c.controller?.runtime.index.domainOwnerOf.get(c.cell.id)
      : layersOf(c).length === 1
        ? layersOf(c)[0].id
        : undefined;
export const createArchitectureUIPlugin = (): FrameUIPlugin => ({
  id: 'architecture',
  engine: createArchitecturePlugin(),
  extensions: createArchitectureFrameExtensions,
  cells: {
    'architecture-layer': { pointerMove: false },
    'architecture-module': { edgeKind: 'architecture-edge' },
  },
  pasteText(c) {
    const frame = c.store.cells[c.frameId];
    if (!isFrameCell(frame)) return undefined;
    const layers = frame.children
      .map((id) => c.store.cells[id])
      .filter((cell) => cell?.kind === 'architecture-layer');
    const layerId =
      c.hit?.kind === 'architecture-layer'
        ? c.hit.id
        : c.hit
          ? indexCells(c.store, c.registry).domainOwnerOf.get(c.hit.id)
          : layers.length === 1
            ? layers[0].id
            : undefined;
    return layerId
      ? addArchitectureModule(c.store, layerId, {
          ...createArchitectureModuleCell(c.allocateId()),
          content: { label: c.text },
        })
      : undefined;
  },
  actions: [
    {
      id: 'architecture.layer',
      label: { zh: '添加层', en: 'Layer' },
      category: 'architecture',
      effect: 'content',
      getState: (c) => ({ enabled: !c.disabled }),
      execute: (c) => {
        const cell = createArchitectureLayerCell(
          c.allocateId(),
          `${layersOf(c).at(-1)?.data?.order ?? ''}~`,
        );
        return c.runOperations(
          [{ type: 'insert_cell', parentId: c.frameId, cell }],
          { selectionIds: [cell.id] },
        );
      },
    },
    ...(['box', 'decision', 'store'] as const).map((shape) => ({
      id: `architecture.${shape}`,
      label: {
        box: { zh: '模块', en: 'Module' },
        decision: { zh: '判断', en: 'Decision' },
        store: { zh: '存储', en: 'Store' },
      }[shape],
      category: 'architecture',
      effect: 'content' as const,
      getState: (c: FrameActionContext) => ({
        enabled: !c.disabled && !!activeLayer(c),
      }),
      execute: (c: FrameActionContext) => {
        const layerId = activeLayer(c);
        if (!layerId)
          return { status: 'rejected' as const, code: 'missing-layer' };
        const cell = createArchitectureModuleCell(c.allocateId(), shape);
        return c.runOperations(addArchitectureModule(c.store, layerId, cell), {
          selectionIds: [cell.id],
          editId: cell.id,
        });
      },
    })),
    ...([-1, 1] as const).map((direction) => ({
      id: direction < 0 ? 'architecture.layer-up' : 'architecture.layer-down',
      label:
        direction < 0
          ? { zh: '上移层', en: 'Move layer up' }
          : { zh: '下移层', en: 'Move layer down' },
      category: 'architecture',
      effect: 'content' as const,
      getState: (c: FrameActionContext) => {
        const ids = layersOf(c).map((cell) => cell.id),
          at = ids.indexOf(c.cell?.id ?? '');
        return {
          visible: c.cell?.kind === 'architecture-layer',
          enabled:
            !c.disabled &&
            at >= 0 &&
            at + direction >= 0 &&
            at + direction < ids.length,
        };
      },
      execute: (c: FrameActionContext) => {
        const ids = layersOf(c).map((cell) => cell.id),
          at = ids.indexOf(c.cell?.id ?? ''),
          next = at + direction;
        if (at < 0 || next < 0 || next >= ids.length)
          return { status: 'rejected' as const, code: 'invalid-layer-order' };
        [ids[at], ids[next]] = [ids[next], ids[at]];
        return c.runOperations(
          reorderArchitectureLayers(c.store, c.frameId, ids),
        );
      },
    })),
    {
      id: 'architecture.move-module',
      label: { zh: '移动模块到层', en: 'Move module to layer' },
      category: 'architecture',
      effect: 'content',
      validateArgs: (
        args: unknown,
      ): args is { cellId: string; layerId: string } =>
        !!args &&
        typeof args === 'object' &&
        typeof (args as { cellId?: unknown }).cellId === 'string' &&
        typeof (args as { layerId?: unknown }).layerId === 'string',
      getState: (c, args) => ({
        visible: !!args,
        enabled:
          !c.disabled &&
          !!args &&
          c.store.cells[args.cellId]?.kind === 'architecture-module' &&
          c.store.cells[args.layerId]?.kind === 'architecture-layer' &&
          !c.store.cells[args.layerId]?.locked &&
          !lockedByAncestor(c.store, args.layerId) &&
          selectionAllows(
            c.store,
            [args.cellId],
            c.registry,
            'move',
            c.frameId,
          ),
      }),
      execute: (c, args: { cellId: string; layerId: string }) =>
        c.runOperations(
          moveArchitectureModuleToLayer(c.store, args.cellId, args.layerId, {
            position: 'inside-layer',
          }),
        ),
    },
    {
      id: 'architecture.set-shape',
      label: { zh: '设置模块形状', en: 'Set module shape' },
      category: 'architecture',
      effect: 'content',
      validateArgs: (
        args: unknown,
      ): args is { cellId: string; shape: ArchitectureModuleData['shape'] } =>
        !!args &&
        typeof args === 'object' &&
        typeof (args as { cellId?: unknown }).cellId === 'string' &&
        ['box', 'decision', 'store'].includes(
          (args as { shape: string }).shape,
        ),
      getState: (c, args) => ({
        visible: !!args,
        enabled:
          !c.disabled &&
          c.store.cells[args?.cellId]?.kind === 'architecture-module',
      }),
      execute: (
        c,
        args: { cellId: string; shape: ArchitectureModuleData['shape'] },
      ) => {
        const cell = c.store.cells[args.cellId];
        if (!isNodeCell(cell))
          return { status: 'rejected', code: 'missing-module' };
        const template = createArchitectureModuleCell(cell.id, args.shape);
        return c.runOperations([
          {
            type: 'replace_cell',
            cell: {
              ...cell,
              geometry: {
                ...cell.geometry,
                outline: template.geometry.outline,
              },
              data: { ...(cell.data as object), shape: args.shape },
            },
          },
        ]);
      },
    },
  ],
  tools: ['layer', 'box', 'decision', 'store'].map((id) => ({
    id: `architecture.${id}`,
    actionId: `architecture.${id}`,
  })),
  Toolbar: (c) =>
    c.cell?.kind === 'architecture-layer' ? (
      <>
        {([-1, 1] as const).map((direction) => {
          const ids = layersOf(c).map((layer) => layer.id),
            at = ids.indexOf(c.cell!.id),
            next = at + direction;
          return (
            <button
              key={direction}
              type="button"
              disabled={c.disabled || next < 0 || next >= ids.length}
              onClick={() => {
                void c.executeAction(
                  direction < 0
                    ? 'architecture.layer-up'
                    : 'architecture.layer-down',
                );
              }}
            >
              {c.language === 'zh'
                ? direction < 0
                  ? '上移层'
                  : '下移层'
                : direction < 0
                  ? 'Move layer up'
                  : 'Move layer down'}
            </button>
          );
        })}
      </>
    ) : null,
  propertyPanels: [
    {
      id: 'architecture.properties',
      render: (c) =>
        c.cell?.kind === 'architecture-module' && isNodeCell(c.cell) ? (
          <>
            {c.controller && (
              <ArchitectureLayerField
                {...c}
                cell={c.cell}
                registry={c.controller.runtime.registry}
                getStore={() => c.controller?.runtime.store ?? c.store}
              />
            )}
            {c.surface !== 'product' && (
              <label>
                {c.language === 'zh' ? '形状' : 'Shape'}
                <FrameSettingsControl
                  field={{
                    key: 'plugin.0',
                    editor: 'select',
                    props: {
                      disabled: c.disabled,
                      children: (
                        <>
                          <option value="box">Box</option>
                          <option value="decision">Decision</option>
                          <option value="store">Store</option>
                        </>
                      ),
                    },
                  }}
                  value={(c.cell.data as ArchitectureModuleData).shape}
                  onCommit={(value) =>
                    c.executeAction('architecture.set-shape', {
                      cellId: c.cell!.id,
                      shape: value,
                    })
                  }
                />
              </label>
            )}
          </>
        ) : null,
    },
  ],
});
