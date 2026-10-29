import type { BoardTextNode } from '@sue/board-common';
import type { Cell, NodeGeometry, CellLayoutStyle } from '@sue/board-core';
import type {
  WorkspaceFile,
  AuthoringDiagnostic,
} from '@sue/verd-board-app/headless';
export type { AuthoringDiagnostic } from '@sue/verd-board-app/headless';
export type ContentKind =
  | 'document'
  | 'whiteboard'
  | 'mind'
  | 'workflow'
  | 'architecture'
  | 'uml-class'
  | 'uml-sequence';
export type AuthoringOperation =
  | {
      type: 'pattern.instantiate';
      patternId: string;
      parameters?: { title?: string };
      dir?: string;
    }
  | {
      type: 'file.create';
      kind: ContentKind;
      id?: string;
      anchorId?: string;
      title: string;
      path: string;
      mode?: 'dag' | 'process';
    }
  | { type: 'file.import'; file: WorkspaceFile; path: string }
  | { type: 'file.replace'; fileId: string; file: WorkspaceFile }
  | {
      type: 'mermaid.import';
      scene: 'workflow' | 'architecture' | 'uml-class' | 'uml-sequence';
      source: string;
      path: string;
      title?: string;
    }
  | { type: 'file.move'; fileId: string; path: string }
  | { type: 'file.copy'; fileId: string; dir?: string }
  | { type: 'file.remove'; fileId: string }
  | {
      type: 'document.set';
      fileId: string;
      markdown?: string;
      content?: BoardTextNode;
    }
  | {
      type: 'document.splice';
      fileId: string;
      index: number;
      deleteCount?: number;
      blocks: BoardTextNode[];
    }
  | {
      type: 'node.upsert';
      fileId: string;
      id?: string;
      kind: string;
      label?: string;
      parentId?: string;
      geometry?: Partial<NodeGeometry>;
      data?: Record<string, unknown>;
      appearance?: Record<string, unknown>;
      points?: [number, number][];
    }
  | {
      type: 'edge.upsert';
      fileId: string;
      id?: string;
      sourceId: string;
      targetId: string;
      label?: string;
      relation?: string;
      messageKind?: string;
      sourcePort?: string;
      targetPort?: string;
    }
  | {
      type: 'relation.move';
      fileId: string;
      id: string;
      parentId: string;
      index?: number;
    }
  | { type: 'architecture.reorder'; fileId: string; ids: string[] }
  | {
      type: 'sequence.move';
      fileId: string;
      id: string;
      operandId?: string;
      index: number;
    }
  | { type: 'sequence.reorder'; fileId: string; ids: string[] }
  | {
      type: 'sequence.activation';
      fileId: string;
      participantId: string;
      startId: string;
      endId: string;
    }
  | { type: 'table.set'; fileId: string; id: string; values: string[][] }
  | {
      type: 'table.track';
      fileId: string;
      id: string;
      action: 'insert' | 'remove' | 'resize';
      axis: 'row' | 'column';
      index: number;
      size?: number;
    }
  | {
      type: 'table.merge';
      fileId: string;
      id: string;
      range: { top: number; left: number; bottom: number; right: number };
    }
  | { type: 'table.split'; fileId: string; id: string; entryId: string }
  | {
      type: 'reference.upsert';
      fileId: string;
      id?: string;
      targetId: string;
      targetKind: 'document' | 'frame';
      geometry?: Partial<NodeGeometry>;
    }
  | { type: 'group.set'; fileId: string; id?: string; ids: string[] }
  | { type: 'element.remove'; fileId: string; ids: string[] }
  | {
      type: 'elements.move';
      fileId: string;
      targetFileId: string;
      ids: string[];
      parentId?: string;
    }
  | { type: 'cell.set'; fileId: string; cell: Cell }
  | {
      type: 'layout.apply';
      fileId: string;
      style: CellLayoutStyle | 'domain';
      ids?: string[];
    };
export interface AuthoringEntry {
  path: string;
  file: WorkspaceFile;
}
export interface PreparedBatch {
  format: 'verd-authoring-plan';
  version: 1;
  transactionId: string;
  workspaceVersion: string;
  /** Hash of all other plan fields. Detects accidental editing of prepared content. */
  integrity: string;
  files: AuthoringEntry[];
  removeIds: string[];
  idMap: Record<string, string>;
  diagnostics: AuthoringDiagnostic[];
  changes: { fileId: string; beforePath?: string; afterPath?: string }[];
}
