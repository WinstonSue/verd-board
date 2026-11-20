import { randomUUID } from 'node:crypto';
import {
  createBlockText,
  createInlineText,
  deriveBoardTextPlainText,
} from '@sue/board-common';
import {
  applyCellOperations,
  createFrameCell,
  isNodeCell,
  isEdgeCell,
  planGeometryLayout,
  type GeometryDiagnostic,
  type Cell,
  type CellOperation,
  frameLaneScene,
  type CellStore,
  type NodeCell,
  type FrameCell,
  type EdgeCell,
} from '@sue/board-core';
import * as draw from '@sue/board-draw';
import * as mind from '@sue/board-mind';
import * as workflow from '@sue/board-workflow';
import * as architecture from '@sue/board-architecture';
import * as uml from '@sue/board-uml';
import { parseMarkdownToTextDocument } from '@sue/board-markdown-to-text';
import {
  createDocumentFile,
  createWorkspaceCellRegistry,
  frameFileFor,
  remapWorkspaceFiles,
  workspaceFileClosure,
  workspaceFileId,
} from '@sue/verd-board-workspace';
import type { AuthoringEntry, AuthoringOperation } from './types';

const registry = () => createWorkspaceCellRegistry();
const clone = <T>(value: T): T => structuredClone(value);
export function runOperations(
  input: AuthoringEntry[],
  operations: AuthoringOperation[],
  makeId = () => randomUUID() as string,
) {
  const entries = new Map(
    input.map((e) => [workspaceFileId(e.file), clone(e)]),
  );
  const idMap: Record<string, string> = {};
  const geometryDiagnostics: GeometryDiagnostic[] = [];
  const allocate = (hint?: string) => {
    const id = hint ?? makeId();
    idMap[hint ?? id] = id;
    return id;
  };
  const entry = (id: string) => {
    const e = entries.get(id);
    if (!e) throw new Error('Unknown file: ' + id);
    return e;
  };
  for (const op of operations) {
    if (op.type === 'pattern.instantiate' || op.type === 'mermaid.import')
      throw new Error('Imports must be expanded before running operations');
    if (op.type === 'file.create') {
      const id = allocate(op.id);
      if (entries.has(id)) throw new Error('File already exists: ' + id);
      if (op.kind === 'document')
        entries.set(id, {
          path: op.path,
          file: createDocumentFile(id, op.title),
        });
      else {
        const anchor = allocate(op.anchorId ?? `${id}:root`);
        const snapshot =
          op.kind === 'mind'
            ? mind.createMindFrameSnapshot(id, anchor)
            : op.kind === 'workflow'
              ? workflow.createWorkflowFrameSnapshot(id, anchor)
              : op.kind === 'architecture'
                ? architecture.createArchitectureFrameSnapshot(id, anchor)
                : op.kind === 'uml-class'
                  ? uml.createUmlClassFrameSnapshot(id, anchor)
                  : op.kind === 'uml-sequence'
                    ? uml.createUmlSequenceFrameSnapshot(id, anchor)
                    : {
                        store: {
                          rootId: id,
                          cells: { [id]: createFrameCell(id) },
                        },
                      };
        (snapshot.store.cells[id] as FrameCell).name = op.title;
        if (op.kind === 'workflow' && op.mode)
          (
            snapshot.store.cells[anchor] as NodeCell<workflow.WorkflowStartData>
          ).data!.graphMode = op.mode;
        const file = frameFileFor(snapshot.store, id);
        entries.set(id, { path: op.path, file });
      }
      continue;
    }
    if (op.type === 'file.import') {
      const id = workspaceFileId(op.file);
      if (entries.has(id))
        throw new Error('Imported file identity already exists: ' + id);
      const imported = clone(op.file);
      if (imported.format === 'verd-frame') delete imported.organization;
      entries.set(id, { path: op.path, file: imported });
      continue;
    }
    const e = entry(op.fileId);
    if (op.type === 'file.replace') {
      if (
        workspaceFileId(op.file) !== op.fileId ||
        op.file.format !== e.file.format
      )
        throw new Error('Replacement must preserve file identity and kind');
      e.file = clone(op.file);
      if (e.file.format === 'verd-frame') delete e.file.organization;
      continue;
    }
    if (op.type === 'file.move') {
      e.path = op.path;
      continue;
    }
    if (op.type === 'file.remove') {
      entries.delete(op.fileId);
      continue;
    }
    if (op.type === 'file.copy') {
      const originals = [...entries.values()].map((v) => v.file);
      const claimed = new Set(
        originals.flatMap((f) =>
          f.format === 'verd-frame'
            ? [f.frame.id, ...Object.keys(f.cells)]
            : [f.id],
        ),
      );
      const remapped = remapWorkspaceFiles(
        workspaceFileClosure(originals, op.fileId),
        (id) => claimed.has(id),
        makeId,
        { rootId: op.fileId },
        registry(),
      );
      for (const [oldId, newId] of remapped.idMap) idMap[oldId] = newId;
      for (const file of remapped.files) {
        const name =
          file.format === 'verd-document'
            ? file.title
            : (file.frame.name ?? 'Canvas');
        const suffix =
          file.format === 'verd-document' ? '.verd-doc.json' : '.verd';
        const copiedId = workspaceFileId(file);
        entries.set(copiedId, {
          file,
          path: `${op.dir ? op.dir + '/' : ''}${name}-${copiedId.slice(-8)}${suffix}`,
        });
      }
      continue;
    }
    if (op.type === 'document.set' || op.type === 'document.splice') {
      if (e.file.format !== 'verd-document') throw new Error('Not a document');
      if (op.type === 'document.set') {
        if ((op.markdown === undefined) === (op.content === undefined))
          throw new Error('Choose exactly one of markdown/content');
        if (op.markdown !== undefined) {
          const parsed = parseMarkdownToTextDocument(op.markdown, {
            id: e.file.id,
          });
          if (parsed.warnings.length)
            throw new Error(
              'Markdown conversion warnings: ' +
                JSON.stringify(parsed.warnings),
            );
          e.file.text = parsed.document;
        } else e.file.text.content = clone(op.content!);
      } else {
        const blocks = e.file.text.content.content ?? [];
        if (
          !Number.isInteger(op.index) ||
          op.index < 0 ||
          op.index > blocks.length ||
          !Number.isInteger(op.deleteCount ?? 0) ||
          (op.deleteCount ?? 0) < 0
        )
          throw new Error('Invalid document block range');
        blocks.splice(op.index, op.deleteCount ?? 0, ...clone(op.blocks));
        e.file.text.content.content = blocks;
      }
      e.file.text.plainText = deriveBoardTextPlainText(e.file.text.content);
      continue;
    }
    if (e.file.format !== 'verd-frame')
      throw new Error('Not a canvas: ' + op.fileId);
    let file = e.file;
    let store: CellStore = {
      rootId: file.frame.id,
      cells: { [file.frame.id]: clone(file.frame), ...clone(file.cells) },
    };
    const frame = store.cells[store.rootId] as FrameCell;
    const cells = () => Object.values(store.cells);
    const first = (kind: string) => cells().find((c) => c.kind === kind)?.id;
    const apply = (ops: readonly CellOperation[]) => {
      store = applyCellOperations(store, ops, registry());
    };
    const insert = (cell: Cell) =>
      apply([{ type: 'insert_cell', parentId: store.rootId, cell }]);
    const upsert = (cell: Cell) =>
      store.cells[cell.id]
        ? apply([{ type: 'replace_cell', cell }])
        : insert(cell);
    if (op.type === 'node.upsert') {
      const id = allocate(op.id),
        old = store.cells[id];
      let node: NodeCell;
      if (old) {
        if (!isNodeCell(old) || old.kind !== op.kind)
          throw new Error('Node kind cannot change through upsert');
        node = clone(old);
      } else
        switch (op.kind) {
          case 'mind-root':
            node = mind.createMindRootCell(id);
            break;
          case 'workflow-start':
            node = workflow.createWorkflowStartCell(id);
            break;
          case 'text':
            node = {
              ...draw.createGeometryCell(id, 'text', [[60, 60]]),
              kind: 'text',
            };
            break;
          case 'mind-child':
            node = mind.createMindChildCell(id);
            break;
          case 'workflow-task':
          case 'workflow-decision':
            node = workflow.createWorkflowTaskCell(
              id,
              op.kind === 'workflow-decision',
            );
            break;
          case 'architecture-layer':
            node = architecture.createArchitectureLayerCell(
              id,
              String(cells().filter((c) => c.kind === op.kind).length).padStart(
                8,
                '0',
              ),
            );
            break;
          case 'architecture-module':
            node = architecture.createArchitectureModuleCell(id);
            break;
          case 'uml-class':
            node = uml.createUmlClassCell(id);
            break;
          case 'uml-participant':
            node = uml.createUmlParticipantCell(id);
            break;
          case 'uml-note':
            node = uml.createUmlNoteCell(
              id,
              (op.data?.participantIds as string[]) ?? [],
            );
            break;
          case 'uml-fragment':
            node = uml.createUmlFragmentCell(
              id,
              (op.data?.operator as 'alt' | 'opt' | 'loop') ?? 'opt',
            );
            break;
          case 'table':
          case 'swimlane':
            node = draw.createTableCell(
              id,
              [[60, 60]],
              3,
              3,
              op.kind === 'swimlane',
            );
            break;
          case 'freehand':
            node = draw.createFreehandCell(
              id,
              op.points ?? [
                [0, 0],
                [100, 80],
              ],
            );
            break;
          case 'vector-line':
            node = draw.createVectorLineCell(
              id,
              op.points ?? [
                [0, 0],
                [100, 80],
              ],
            );
            break;
          case 'image':
            node = {
              id,
              kind: 'image',
              cellType: 'node',
              geometry: { x: 60, y: 60, width: 200, height: 120 },
              data: { url: '', ...op.data },
            };
            break;
          case 'geometry':
            node = draw.createGeometryCell(
              id,
              (op.data?.shape as string) ?? 'rectangle',
              [[60, 60]],
            );
            break;
          case 'card':
            node = draw.createCardCell(id, [[60, 60]], op.label);
            break;
          default:
            throw new Error(
              'Use an existing anchor ID or cell.set for this node kind: ' +
                op.kind,
            );
        }
      if (op.label !== undefined)
        node.content = {
          ...node.content,
          label: op.label,
          text:
            op.kind === 'card'
              ? draw.createCardText(op.label)
              : createInlineText(op.label),
        };
      if (op.geometry)
        node.geometry = { ...node.geometry, ...op.geometry, derived: false };
      if (
        !old &&
        op.kind === 'swimlane' &&
        frameLaneScene(store, op.parentId ?? store.rootId, registry())
      )
        node.data = { ...(node.data as object), laneMembers: {} };
      if (op.data) node.data = { ...(node.data as object), ...op.data };
      if (op.appearance)
        node.appearance = { ...node.appearance, ...op.appearance };
      if (old) upsert(node);
      else if (op.kind === 'mind-child')
        apply(
          mind.addMindChild(
            store,
            op.parentId ?? first('mind-root')!,
            node,
            allocate(),
          ),
        );
      else if (op.kind.startsWith('workflow-') && op.kind !== 'workflow-start')
        apply(
          workflow.addWorkflowTask(
            store,
            op.parentId ?? first('workflow-start')!,
            node,
          ),
        );
      else if (op.kind === 'architecture-module')
        apply(
          architecture.addArchitectureModule(
            store,
            op.parentId ?? first('architecture-layer')!,
            node,
          ),
        );
      else if (op.kind.startsWith('uml-'))
        apply(uml.addUmlCell(store, store.rootId, node, op.parentId));
      else insert(node);
    } else if (op.type === 'edge.upsert') {
      const id = allocate(op.id),
        source = store.cells[op.sourceId],
        target = store.cells[op.targetId];
      if (!isNodeCell(source) || !isNodeCell(target))
        throw new Error('Edge endpoints must be nodes');
      const kind = source.kind.startsWith('workflow-')
        ? 'workflow-edge'
        : source.kind.startsWith('architecture-')
          ? 'architecture-edge'
          : source.kind === 'uml-class'
            ? 'uml-relation'
            : source.kind === 'uml-participant'
              ? 'uml-message'
              : 'arrow';
      let edge: EdgeCell =
        kind === 'uml-relation'
          ? uml.createUmlRelationCell(
              id,
              source.id,
              target.id,
              (op.relation ?? 'association') as uml.UmlRelation,
            )
          : kind === 'uml-message'
            ? uml.createUmlMessageCell(
                id,
                source.id,
                target.id,
                (op.messageKind ?? 'sync') as uml.UmlMessageData['messageKind'],
              )
            : {
                id,
                kind,
                cellType: 'edge',
                source: {
                  cellId: source.id,
                  portId:
                    op.sourcePort ??
                    workflow.defaultWorkflowPort(
                      store,
                      source,
                      target,
                      'source',
                      id,
                    ),
                },
                target: {
                  cellId: target.id,
                  portId:
                    op.targetPort ??
                    workflow.defaultWorkflowPort(
                      store,
                      target,
                      source,
                      'target',
                      id,
                    ),
                },
                route: { mode: 'orthogonal' },
                labels: [],
              };
      const previous = store.cells[id];
      if (kind === 'architecture-edge') {
        if (
          op.relation !== undefined &&
          !['dependency', 'flow'].includes(op.relation)
        )
          throw new Error('Invalid architecture relationship');
        edge.data = {
          ...(previous?.cellType === 'edge' ? (previous.data as object) : {}),
          ...(op.relation !== undefined
            ? { relation: op.relation }
            : !previous
              ? { relation: 'dependency' }
              : {}),
        };
      }
      if (previous) {
        if (!isEdgeCell(previous) || previous.kind !== edge.kind)
          throw new Error('Edge kind cannot change');
        edge = {
          ...previous,
          source:
            'cellId' in previous.source && previous.source.cellId === source.id
              ? previous.source
              : edge.source,
          target:
            'cellId' in previous.target && previous.target.cellId === target.id
              ? previous.target
              : edge.target,
          ...(op.relation || op.messageKind
            ? {
                data: {
                  ...(previous.data as object),
                  ...(edge.data as object),
                },
              }
            : {}),
        };
      }
      if (op.sourcePort !== undefined)
        edge.source = { cellId: source.id, portId: op.sourcePort };
      if (op.targetPort !== undefined)
        edge.target = { cellId: target.id, portId: op.targetPort };
      if (op.label !== undefined) edge.labels = [{ text: op.label }];
      if (!previous && kind === 'uml-message')
        apply(uml.addUmlCell(store, store.rootId, edge));
      else upsert(edge);
    } else if (op.type === 'relation.move') {
      const node = store.cells[op.id];
      apply(
        node?.kind === 'mind-child'
          ? mind.reparentMindChild(store, op.id, op.parentId, op.index)
          : architecture.moveArchitectureModuleToLayer(
              store,
              op.id,
              op.parentId === store.rootId ? null : op.parentId,
            ),
      );
    } else if (op.type === 'architecture.reorder')
      apply(
        architecture.reorderArchitectureLayers(store, store.rootId, op.ids),
      );
    else if (op.type === 'sequence.move')
      apply(
        uml.moveUmlEvent(store, store.rootId, op.id, op.operandId, op.index),
      );
    else if (op.type === 'sequence.reorder') {
      for (const [i, id] of op.ids.entries())
        apply(uml.reorderUmlParticipant(store, store.rootId, id, i));
    } else if (op.type === 'sequence.activation') {
      const events = uml.sequenceEventLocations(store, store.rootId),
        start = events.find((e) => e.cellId === op.startId),
        end = events.find((e) => e.cellId === op.endId);
      if (!start || !end || start.operandId !== end.operandId)
        throw new Error(
          'Activation endpoints must exist in the same sequence branch',
        );
      apply(
        uml.addUmlActivation(
          store,
          store.rootId,
          op.participantId,
          start.at,
          end.at + 1,
          () => allocate(),
          start.operandId,
        ),
      );
    } else if (
      op.type === 'table.track' ||
      op.type === 'table.merge' ||
      op.type === 'table.split'
    ) {
      const table = store.cells[op.id] as NodeCell<draw.TableCellData>;
      if (!table || !['table', 'swimlane'].includes(table.kind))
        throw new Error('Not a table');
      const next =
        op.type === 'table.merge'
          ? draw.mergeTableRange(table, op.range)
          : op.type === 'table.split'
            ? draw.splitTableEntry(table, op.entryId, () => allocate())
            : op.action === 'insert'
              ? draw.insertTableTrack(table, op.axis, op.index, () =>
                  allocate(),
                )
              : op.action === 'remove'
                ? draw.removeTableTrack(table, op.axis, op.index)
                : op.action === 'resize' && op.size !== undefined
                  ? draw.resizeTableTrack(table, op.axis, op.index, op.size)
                  : undefined;
      if (!next)
        throw new Error(
          'A table must retain at least one row and column, and resize requires size',
        );
      upsert(next);
    } else if (op.type === 'table.set') {
      const cell = store.cells[op.id] as NodeCell<draw.TableCellData>;
      if (!['table', 'swimlane'].includes(cell?.kind))
        throw new Error('Not a table');
      if (
        op.values.length !== cell.data!.rows.length ||
        op.values.some((row) => row.length !== cell.data!.columns.length)
      )
        throw new Error(
          'Use cell.set with a valid table model to change tracks',
        );
      const data = clone(cell.data!);
      for (const c of data.cells) {
        const r = data.rows.findIndex((x) => x.id === c.rowId),
          col = data.columns.findIndex((x) => x.id === c.columnId);
        c.text = createBlockText(op.values[r][col]);
      }
      upsert({ ...cell, data });
    } else if (op.type === 'reference.upsert') {
      const id = allocate(op.id),
        old = store.cells[id];
      const cell: NodeCell = {
        id,
        kind:
          op.targetKind === 'document'
            ? 'document-reference'
            : 'frame-reference',
        cellType: 'node',
        geometry: {
          x: 40,
          y: 40,
          width: 320,
          height: 220,
          ...(isNodeCell(old) ? old.geometry : {}),
          ...op.geometry,
        },
        data:
          op.targetKind === 'document'
            ? { targetDocumentId: op.targetId }
            : { targetFrameId: op.targetId },
      };
      upsert(cell);
    } else if (op.type === 'group.set')
      upsert({
        id: allocate(op.id),
        cellType: 'group',
        kind: 'group',
        members: op.ids,
      });
    else if (op.type === 'element.remove')
      apply(op.ids.map((id) => ({ type: 'remove_cell', cellId: id })));
    else if (op.type === 'cell.set') upsert(clone(op.cell));
    else if (op.type === 'elements.move') {
      const target = entry(op.targetFileId);
      if (target.file.format !== 'verd-frame')
        throw new Error('Target is not a canvas');
      // Move all selected cells together; explicit edge handling is required.
      const targetFile = clone(target.file),
        moved = new Set(op.ids);
      for (const id of op.ids) {
        const cell = store.cells[id];
        if (!cell || cell.cellType === 'frame')
          throw new Error('Invalid move member');
        targetFile.cells[id] = clone(cell);
        delete store.cells[id];
        if (cell.cellType === 'group') {
          targetFile.frame.groups.push(id);
          frame.groups = frame.groups.filter((x) => x !== id);
        } else {
          targetFile.frame.children.push(id);
          frame.children = frame.children.filter((x) => x !== id);
        }
      }
      for (const c of Object.values(store.cells))
        if (
          isNodeCell(c) &&
          Array.isArray((c.data as { memberIds?: string[] })?.memberIds)
        )
          (c.data as { memberIds: string[] }).memberIds = (
            c.data as { memberIds: string[] }
          ).memberIds.filter((id) => !moved.has(id));
      if (op.parentId) {
        const owner = targetFile.cells[op.parentId] as NodeCell<{
          memberIds: string[];
        }>;
        if (!owner?.data?.memberIds)
          throw new Error('Missing target domain owner');
        owner.data.memberIds.push(
          ...op.ids.filter((id) => isNodeCell(targetFile.cells[id])),
        );
      }
      target.file = targetFile;
    } else if (op.type === 'layout.apply') {
      const plan = planGeometryLayout(
        store,
        { focus: [store.rootId], ids: op.ids ?? frame.children },
        op.style,
        registry(),
      );
      geometryDiagnostics.push(...plan.diagnostics);
      apply(plan.operations);
    }
    file = frameFileFor(store, store.rootId);
    delete file.organization;
    e.file = file;
  }
  return { entries: [...entries.values()], idMap, geometryDiagnostics };
}
