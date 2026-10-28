import { FrameSettingsControl, settingsCommitResult } from '@sue/board-react';
import { type ArchitectureLayerData } from '@sue/board-architecture';
import {
  indexCells,
  isFrameCell,
  isNodeCell,
  lockedByAncestor,
  selectionAllows,
  type CellRegistry,
  type CellStore,
  type NodeCell,
} from '@sue/board-core';
export function ArchitectureLayerField({
  store,
  frameId,
  cell,
  registry,
  disabled,
  language,
  executeAction,
}: {
  store: CellStore;
  frameId: string;
  cell: NodeCell;
  registry: CellRegistry;
  disabled: boolean;
  language: 'zh' | 'en';
  executeAction: import('@sue/board-react').FrameActionContext['executeAction'];
  getStore?(): CellStore | undefined;
}) {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame) || cell.kind !== 'architecture-module') return null;
  const layers = frame.children
    .map((id) => store.cells[id])
    .filter(
      (item): item is NodeCell<ArchitectureLayerData> =>
        isNodeCell(item) && item.kind === 'architecture-layer',
    )
    .sort((a, b) => a.data!.order.localeCompare(b.data!.order));
  return (
    <label>
      {language === 'zh' ? '所属层' : 'Layer'}
      <FrameSettingsControl
        field={{
          key: 'Architecture layer',
          editor: 'select',
          props: {
            'aria-label': 'Architecture layer',
            disabled:
              disabled ||
              !selectionAllows(store, [cell.id], registry, 'move', frameId),
            children: (
              <>
                {layers.map((layer, index) => (
                  <option
                    key={layer.id}
                    value={layer.id}
                    disabled={layer.locked || lockedByAncestor(store, layer.id)}
                  >
                    {layer.content?.label ||
                      `${language === 'zh' ? '层' : 'Layer'} ${index + 1}`}
                  </option>
                ))}
              </>
            ),
          },
        }}
        value={indexCells(store, registry).domainOwnerOf.get(cell.id) ?? ''}
        onCommit={(value) => {
          return settingsCommitResult(
            executeAction('architecture.move-module', {
              cellId: cell.id,
              layerId: value,
            }),
          );
        }}
      />
    </label>
  );
}
