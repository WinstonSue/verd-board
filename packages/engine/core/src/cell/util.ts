import type { CellUtil as RegisteredUtil, CellOperation } from './index';
import type { Cell, CellStore, EdgeCell, NodeCell } from './types';
import { isNodeCell } from './types';
import type { RectangleClient } from '../interfaces/rectangle-client';
import type { Point } from '../interfaces/point';
import { hitNodeShape } from '../geometry/node';

export interface CellMoveContext {
  point: Point;
  geometry: ReadonlyMap<string, import('./types').NodeGeometry>;
  /** CSS pixels per content unit, including the camera and enclosing Frames. */
  scale?: number;
}

export type FrameMount = 'root' | 'embedded';
export interface CellCapabilities {
  move: boolean;
  resize: boolean;
  rotate: boolean;
  delete: boolean;
  edit: boolean;
  connect: boolean;
}
export abstract class BaseCellUtil implements RegisteredUtil {
  abstract readonly kind: string;
  validate(_store: CellStore, _cell: Cell): string | undefined {
    return undefined;
  }
  keyboard(
    _store: CellStore,
    _cell: Cell,
    _key: string,
    _allocateId: () => string,
  ): CellOperation[] | undefined {
    return undefined;
  }
  move(
    _store: CellStore,
    cell: Cell,
    geometry: import('./types').NodeGeometry,
    _targetId?: string,
    _context?: CellMoveContext,
  ): CellOperation[] {
    return isNodeCell(cell)
      ? [{ type: 'replace_cell', cell: { ...cell, geometry } }]
      : [];
  }
  resize(
    _store: CellStore,
    cell: Cell,
    geometry: import('./types').NodeGeometry,
    _targetId?: string,
  ): CellOperation[] {
    return isNodeCell(cell)
      ? [{ type: 'replace_cell', cell: { ...cell, geometry } }]
      : [];
  }
  rotate(
    store: CellStore,
    cell: Cell,
    geometry: import('./types').NodeGeometry,
    _targetId?: string,
  ): CellOperation[] {
    return this.resize(store, cell, geometry);
  }
  capabilities(
    _store: CellStore,
    cell: Cell,
    _mount: FrameMount,
  ): CellCapabilities {
    const editable = !cell.locked;
    return {
      move: editable,
      resize: editable,
      rotate: editable,
      delete: editable,
      edit: editable,
      connect: editable,
    };
  }
}
export abstract class NodeUtil extends BaseCellUtil {
  hitTest(
    _store: CellStore,
    cell: NodeCell,
    point: Point,
    tolerance = 6,
  ): boolean {
    return hitNodeShape(cell, point, tolerance);
  }
  bounds(_store: CellStore, cell: NodeCell): RectangleClient {
    return { ...cell.geometry };
  }
}
export abstract class EdgeUtil extends BaseCellUtil {
  validateEdge(_store: CellStore, _edge: EdgeCell): string | undefined {
    return undefined;
  }
}
export class GroupUtil extends BaseCellUtil {
  readonly kind = 'group';
  override capabilities(
    store: CellStore,
    cell: Cell,
    mount: FrameMount,
  ): CellCapabilities {
    return {
      ...super.capabilities(store, cell, mount),
      resize: false,
      rotate: false,
      connect: false,
    };
  }
}
export class FrameUtil extends NodeUtil {
  readonly kind = 'frame';
  override capabilities(
    store: CellStore,
    cell: Cell,
    mount: FrameMount,
  ): CellCapabilities {
    return {
      ...super.capabilities(store, cell, mount),
      rotate: false,
      connect: false,
      move: mount === 'embedded' && !cell.locked,
      resize: mount === 'embedded' && !cell.locked,
      delete: mount === 'embedded' && cell.id !== store.rootId && !cell.locked,
    };
  }
}

/** Reference shells behave like embedded frames: movable/resizable/deletable, never rotated or connected. */
export class FrameReferenceUtil extends NodeUtil {
  readonly kind: string = 'frame-reference';
  override capabilities(
    store: CellStore,
    cell: Cell,
    mount: FrameMount,
  ): CellCapabilities {
    return {
      ...super.capabilities(store, cell, mount),
      rotate: false,
      connect: false,
    };
  }
}
export class DocumentReferenceUtil extends FrameReferenceUtil {
  override readonly kind = 'document-reference';
  override capabilities(
    store: CellStore,
    cell: Cell,
    mount: FrameMount,
  ): CellCapabilities {
    return { ...super.capabilities(store, cell, mount), edit: false };
  }
}
export class DocumentFrameUtil extends FrameReferenceUtil {
  override readonly kind = 'document-frame';
}
export const nodeBounds = (cell: Cell): RectangleClient | undefined =>
  isNodeCell(cell) ? { ...cell.geometry } : undefined;
