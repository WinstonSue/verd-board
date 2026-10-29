import { actionLabel } from '@sue/board-common';
import { useActionSource } from '@sue/board-react-actions';
import {
  autoUpdate,
  FloatingPortal,
  shift,
  useFloating,
} from '@floating-ui/react';
import {
  frameScene,
  isFrameCell,
  selectionAllows,
  type CellOperation,
  type CellSelection,
  type CellStore,
} from '@sue/board-core';
import type { FrameCanvasController } from '@sue/board-react';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { FrameTooltip, frameDisabledReason } from './frame-tooltip';
import { FrameArrangement } from './frame-arrangement';
import { FrameSelectionAppearance } from './frame-selection-appearance';
import { FrameSelectionText } from './frame-selection-text';
import { useI18n } from './i18n';

export function FrameActionsPopover({
  point,
  store,
  selection,
  controller,
  onClose,
  onFailure,
}: {
  point: [number, number];
  store: CellStore;
  selection: CellSelection;
  controller: FrameCanvasController;
  onClose(): void;
  onFailure(message: string): void;
}) {
  const { t, language } = useI18n();
  useActionSource(controller.actionSource);
  const selectionKey = JSON.stringify(selection);
  const captured = useMemo(
    () =>
      new Map(
        controller.actions().map((action) => [action.id, action.capture()]),
      ),
    [controller, selectionKey],
  );
  const { refs, elements, floatingStyles } = useFloating({
    open: true,
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [shift({ padding: 8, crossAxis: true })],
    whileElementsMounted: autoUpdate,
  });
  useLayoutEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => ({
        x: point[0],
        y: point[1],
        left: point[0],
        right: point[0],
        top: point[1],
        bottom: point[1],
        width: 0,
        height: 0,
      }),
    });
  }, [point, refs]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const element = elements.floating;
    if (!element) return;
    element.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) closeRef.current();
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
  }, [elements.floating]);
  const frameId =
    [...selection.focus].reverse().find((id) => isFrameCell(store.cells[id])) ??
    store.rootId;
  const valid = () =>
    JSON.stringify(controller.runtime.selection) ===
      JSON.stringify(selection) &&
    selection.ids.every((id) => !!controller.runtime.store.cells[id]);
  controller = {
    ...controller,
    actions: () => [...captured.values()],
    getActionState: (id, args) =>
      valid()
        ? (captured.get(id)?.getState(args) ?? {
            visible: false,
            enabled: false,
          })
        : { visible: true, enabled: false, reason: 'stale-context' },
    executeAction: (id, args, invocation) =>
      valid()
        ? (captured.get(id)?.execute(args, invocation) ??
          Promise.resolve({ status: 'rejected', code: 'unknown-action' }))
        : Promise.resolve({ status: 'cancelled', code: 'stale-context' }),
  };
  const dispatch = (operations: CellOperation[]) => {
    if (!valid()) return;
    void controller
      .executeAction('canvas.apply-operations', { operations })
      .then((result) => {
        if (result.status === 'rejected' || result.status === 'failed')
          onFailure(result.message ?? result.code);
      });
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
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        role="dialog"
        aria-label="Selection actions"
        className="frame-actions-popover"
        style={floatingStyles}
      >
        <div className="frame-actions-row">
          {[
            'canvas.clipboard.copy',
            'canvas.clipboard.cut',
            'canvas.clipboard.paste',
            'canvas.selection.delete',
            'canvas.link.copy',
            'product.reference.duplicate',
          ].flatMap((id) => {
            const action = controller.actions().find((item) => item.id === id);
            if (!action) return [];
            const state = action.getState();
            if (!state.visible) return [];
            return [
              <FrameTooltip
                key={id}
                disabled={!state.enabled}
                content={
                  !state.enabled
                    ? frameDisabledReason(state.reason, language)
                    : undefined
                }
              >
                <button
                  disabled={!state.enabled}
                  onClick={() => void run(() => controller.executeAction(id))}
                >
                  {actionLabel(action.label, language)}
                </button>
              </FrameTooltip>,
            ];
          })}
        </div>
        <FrameArrangement
          store={store}
          selection={selection}
          controller={controller}
        />
        <FrameSelectionAppearance
          controller={controller}
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
        {!!selection.ids.length &&
          !frameScene(store, frameId, controller.runtime.registry) && (
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
                    disabled={
                      !controller.getActionState(`canvas.order.${direction}`)
                        .enabled
                    }
                    onClick={() =>
                      void run(() =>
                        controller.executeAction(`canvas.order.${direction}`),
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
    </FloatingPortal>
  );
}
