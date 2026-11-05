import { Minus, Plus } from 'lucide-react';
import { useActionSource } from '@sue/board-react-actions';
import { actionLabel } from '@sue/board-common';
import { useSyncExternalStore, type RefObject } from 'react';
import type {
  FrameCanvasController,
  FrameCanvasViewState,
} from '@sue/board-react';

type StructuralViewState = Omit<
  FrameCanvasViewState,
  'zoom' | 'selectionScreenBounds'
>;

/** Camera updates belong to their controls, rather than the whole product page. */
export function createFrameViewStateStore() {
  let view: FrameCanvasViewState | null = null;
  let structural: StructuralViewState | null = null;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => view,
    getZoom: () => view?.zoom ?? 1,
    getRecenter: () =>
      !view?.selectionScreenBounds ? 0 : view.dragging ? 2 : 1,
    getStructuralSnapshot: () => structural,
    publish(next: FrameCanvasViewState) {
      if (view === next) return;
      view = next;
      if (
        !structural ||
        structural.canUndo !== next.canUndo ||
        structural.canRedo !== next.canRedo ||
        structural.pending !== next.pending ||
        structural.readonly !== next.readonly ||
        structural.dragging !== next.dragging
      ) {
        structural = {
          canUndo: next.canUndo,
          canRedo: next.canRedo,
          pending: next.pending,
          readonly: next.readonly,
          dragging: next.dragging,
        };
      }
      listeners.forEach((listener) => listener());
    },
  };
}

export type FrameViewStateStore = ReturnType<typeof createFrameViewStateStore>;

export const useFrameStructuralViewState = (store: FrameViewStateStore) =>
  useSyncExternalStore(
    store.subscribe,
    store.getStructuralSnapshot,
    store.getStructuralSnapshot,
  );

export function FrameZoomControls({
  viewStateStore,
  controller,
}: {
  viewStateStore: FrameViewStateStore;
  controller: RefObject<FrameCanvasController | null>;
}) {
  useActionSource(controller.current?.actionSource);
  const zoom = useSyncExternalStore(
    viewStateStore.subscribe,
    viewStateStore.getZoom,
    viewStateStore.getZoom,
  );
  return (
    <>
      <button
        data-testid="canvas-zoom-out"
        aria-label="Zoom out"
        disabled={
          !controller.current?.getActionState('canvas.view.zoom-out').enabled
        }
        onClick={() =>
          controller.current?.executeAction('canvas.view.zoom-out')
        }
      >
        <Minus strokeWidth={1.75} size={16} aria-hidden="true" />
      </button>
      <span data-testid="canvas-zoom-label">{Math.round(zoom * 100)}%</span>
      <button
        data-testid="canvas-zoom-in"
        aria-label="Zoom in"
        disabled={
          !controller.current?.getActionState('canvas.view.zoom-in').enabled
        }
        onClick={() => controller.current?.executeAction('canvas.view.zoom-in')}
      >
        <Plus strokeWidth={1.75} size={16} aria-hidden="true" />
      </button>
    </>
  );
}

export function FrameRecenterControl({
  viewStateStore,
  controller,
  label,
  language = 'zh',
}: {
  viewStateStore: FrameViewStateStore;
  controller: RefObject<FrameCanvasController | null>;
  label: string;
  language?: 'zh' | 'en';
}) {
  useActionSource(controller.current?.actionSource);
  const action = controller.current
    ?.actions()
    .find((action) => action.id === 'canvas.view.center');
  const recenter = useSyncExternalStore(
    viewStateStore.subscribe,
    viewStateStore.getRecenter,
    viewStateStore.getRecenter,
  );
  if (!recenter) return null;
  return (
    <div className="frame-recenter-control">
      <button
        type="button"
        data-testid="canvas-recenter"
        disabled={recenter === 2 || !action?.getState().enabled}
        onClick={() => controller.current?.executeAction('canvas.view.center')}
      >
        {action ? actionLabel(action.label, language) : label}
      </button>
    </div>
  );
}
