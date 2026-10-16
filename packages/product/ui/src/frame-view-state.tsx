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
  const zoom = useSyncExternalStore(
    viewStateStore.subscribe,
    viewStateStore.getZoom,
    viewStateStore.getZoom,
  );
  return (
    <>
      <button
        data-testid="canvas-zoom-out"
        onClick={() => controller.current?.setZoom(zoom - 0.1)}
      >
        −
      </button>
      <span data-testid="canvas-zoom-label">{Math.round(zoom * 100)}%</span>
      <button
        data-testid="canvas-zoom-in"
        onClick={() => controller.current?.setZoom(zoom + 0.1)}
      >
        +
      </button>
    </>
  );
}

export function FrameRecenterControl({
  viewStateStore,
  controller,
  label,
}: {
  viewStateStore: FrameViewStateStore;
  controller: RefObject<FrameCanvasController | null>;
  label: string;
}) {
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
        disabled={recenter === 2}
        onClick={() => controller.current?.centerSelection()}
      >
        {label}
      </button>
    </div>
  );
}
