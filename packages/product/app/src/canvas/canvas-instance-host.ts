import { isFrameReferenceCell, type FrameSnapshot } from '@sue/board-core';
import {
  isRegularCanvas,
  type WorkspaceSession,
} from '@sue/verd-board-workspace';
import type { FrameInstanceHost } from '@sue/verd-board-ui';
import {
  refOccurrenceId,
  rootOccurrenceId,
  type CanvasSession,
} from './canvas-session';

/** The same occurrence contract serves workspace windows and standalone containers. */
export function createCanvasInstanceHost(
  session: WorkspaceSession,
  getCanvas: () => CanvasSession | null,
): FrameInstanceHost {
  const snapshots = new WeakMap<object, FrameSnapshot>();
  return {
    source: {
      getSnapshot(id) {
        const file = session.getState().files.get(id)?.file;
        if (!file) return null;
        let snapshot = snapshots.get(file);
        if (!snapshot) {
          snapshot = {
            store: {
              rootId: file.frame.id,
              cells: { [file.frame.id]: file.frame, ...file.cells },
            },
          };
          snapshots.set(file, snapshot);
        }
        return snapshot;
      },
      subscribe: (listener) => session.subscribe(listener),
    },
    get(query) {
      const occurrence = getCanvas()?.get(
        refOccurrenceId(query.ownerFileId, query.refId, query.appearance),
      );
      if (!occurrence || occurrence.missing) return null;
      const file = session.getState().files.get(occurrence.fileId)?.file;
      return {
        occurrenceId: occurrence.id,
        runtime: occurrence.runtime,
        readonly: occurrence.contentReadonly,
        preview: !!file && isRegularCanvas(file),
      };
    },
    acquire(query, options) {
      const canvas = getCanvas();
      if (!canvas) return () => {};
      canvas.openFile(query.ownerFileId);
      const opened = canvas.openRef(
        query.ownerFileId,
        query.refId,
        query.parentOccurrenceId ?? rootOccurrenceId(query.ownerFileId),
        query.appearance,
        { activate: !!options?.edit, edit: options?.edit },
      );
      return opened.occurrence
        ? canvas.retainOccurrence(opened.occurrence.id)
        : () => {};
    },
    release(query) {
      getCanvas()?.close(
        refOccurrenceId(query.ownerFileId, query.refId, query.appearance),
      );
    },
    async commit(id, transaction) {
      const result = await getCanvas()?.dispatch(id, transaction);
      return result?.ok
        ? { status: 'accepted' }
        : {
            status: 'rejected',
            message: result?.diagnostics[0]?.message || 'Canvas is unavailable',
          };
    },
    updateContentOffset(id, rootId, offset) {
      const canvas = getCanvas();
      const occurrence = canvas?.get(id);
      const owner = occurrence?.ownerFileId
        ? session.getState().files.get(occurrence.ownerFileId)?.file
        : undefined;
      const ref =
        owner && occurrence?.refId ? owner.cells[occurrence.refId] : undefined;
      if (isFrameReferenceCell(ref))
        void canvas?.updateRefShell(id, {
          data: {
            mindOffsets: { ...(ref.data.mindOffsets ?? {}), [rootId]: offset },
          },
        });
    },
  };
}
