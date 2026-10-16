import { useEffect, useRef } from 'react';
import {
  frameScene,
  isFrameCell,
  reorderCells,
  selectionAllows,
  type CellStore,
  type CellSelection,
  type CellOperation,
} from '@sue/board-core';
import type { FrameCanvasController } from '@sue/board-react';
import { FrameArrangement } from './frame-arrangement';
import { FrameSelectionAppearance } from './frame-selection-appearance';
import { FrameSelectionText } from './frame-selection-text';
import { selectionCommands } from './frame-commands';
import { useI18n } from './i18n';

export function FrameActionsPopover({
  point,
  store,
  selection,
  controller,
  dispatch,
  onClose,
  onFailure,
  onDuplicateReference,
}: {
  point: [number, number];
  store: CellStore;
  selection: CellSelection;
  controller: FrameCanvasController;
  dispatch(operations: CellOperation[]): void;
  onClose(): void;
  onFailure(message: string): void;
  onDuplicateReference?(refIds: string[]): void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) closeRef.current();
    };
    document.addEventListener('pointerdown', dismiss, true);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const frameId =
    [...selection.focus].reverse().find((id) => isFrameCell(store.cells[id])) ??
    store.rootId;
  const valid = () =>
    JSON.stringify(controller.runtime.selection) ===
      JSON.stringify(selection) &&
    selection.ids.every((id) => !!controller.runtime.store.cells[id]);
  const originalController = controller;
  controller = {
    ...controller,
    clipboard: (...args) =>
      valid()
        ? originalController.clipboard(...args)
        : Promise.resolve({ status: 'rejected' }),
    executeSelectionCommand: (...args) =>
      valid()
        ? originalController.executeSelectionCommand(...args)
        : Promise.resolve({ status: 'rejected' }),
  };
  const originalDispatch = dispatch;
  dispatch = (operations) => {
    if (valid()) originalDispatch(operations);
  };
  const run = async (action: () => void | Promise<unknown>) => {
    try {
      if (!valid()) {
        onClose();
        return;
      }
      await action();
      onClose();
    } catch (error) {
      onFailure(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Selection actions"
      className="frame-actions-popover"
      style={{
        left: Math.max(8, Math.min(point[0], window.innerWidth - 300)),
        top: Math.max(8, Math.min(point[1], window.innerHeight - 460)),
      }}
    >
      <div className="frame-actions-row">
        {selectionCommands(
          store,
          selection,
          controller,
          dispatch,
          onDuplicateReference,
        ).map((command) => (
          <button
            key={command.label}
            disabled={command.disabled}
            onClick={() => void run(() => command.run())}
          >
            {command.label}
          </button>
        ))}
      </div>
      <FrameArrangement
        store={store}
        selection={selection}
        controller={controller}
      />
      <FrameSelectionAppearance
        store={store}
        ids={selection.ids}
        single={false}
        dispatch={dispatch}
        getStore={() =>
          valid() &&
          selectionAllows(
            controller.runtime.store,
            selection.ids,
            controller.runtime.registry,
            'edit',
            frameId,
          )
            ? controller.runtime.store
            : undefined
        }
      />
      <FrameSelectionText
        store={store}
        ids={selection.ids}
        dispatch={dispatch}
        getStore={() =>
          valid() &&
          selectionAllows(
            controller.runtime.store,
            selection.ids,
            controller.runtime.registry,
            'edit',
            frameId,
          )
            ? controller.runtime.store
            : undefined
        }
      />
      {!!selection.ids.length && !frameScene(store, frameId) && (
        <div className="frame-actions-row">
          {(['front', 'forward', 'backward', 'back'] as const).map(
            (direction, index) => (
              <button
                key={direction}
                aria-label={
                  [
                    t('layer.toTop'),
                    t('layer.moveUp'),
                    t('layer.moveDown'),
                    t('layer.toBottom'),
                  ][index]
                }
                onClick={() =>
                  void run(() =>
                    dispatch(
                      reorderCells(store, frameId, selection.ids, direction),
                    ),
                  )
                }
              >
                {
                  [
                    t('layer.toTop'),
                    t('layer.moveUp'),
                    t('layer.moveDown'),
                    t('layer.toBottom'),
                  ][index]
                }
              </button>
            ),
          )}
        </div>
      )}
      <button aria-label="Close selection actions" onClick={onClose}>
        关闭
      </button>
    </div>
  );
}
