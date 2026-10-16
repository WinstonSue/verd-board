import type { CellOperation, CellStore, CellSelection } from '@sue/board-core';
import {
  deleteCells,
  isFrameReferenceCell,
  selectionAllows,
} from '@sue/board-core';
import type { FrameCanvasController } from '@sue/board-react';

export interface FrameCommand {
  label: string;
  disabled?: boolean;
  run(): void | Promise<unknown>;
}

/** Shared context-menu selection commands. */
export function selectionCommands(
  store: CellStore,
  selection: CellSelection,
  controller: FrameCanvasController,
  dispatch: (operations: CellOperation[]) => void,
  onDuplicateReference?: (refIds: string[]) => void,
): FrameCommand[] {
  const ids = selection.ids;
  const refIds = ids.filter((id) => isFrameReferenceCell(store.cells[id]));
  const commands: FrameCommand[] = [
    {
      label: '复制',
      disabled: !ids.length,
      run: () => controller.clipboard('copy'),
    },
    {
      label: '剪切',
      disabled: !selectionAllows(
        store,
        ids,
        controller.runtime.registry,
        'delete',
        controller.runtime.mountedRootId,
      ),
      run: () => controller.clipboard('cut'),
    },
    { label: '粘贴', run: () => controller.clipboard('paste') },
    {
      label: '删除',
      disabled: !selectionAllows(
        store,
        ids,
        controller.runtime.registry,
        'delete',
        controller.runtime.mountedRootId,
      ),
      run: () => dispatch(deleteCells(store, ids)),
    },
  ];
  if (onDuplicateReference)
    commands.push({
      label: '独立副本',
      disabled: !refIds.length,
      run: () => onDuplicateReference(refIds),
    });
  return commands;
}
