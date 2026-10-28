import { groupLeafMembers } from './group';
import { createCellRegistry, type CellRegistry } from './registry';
import {
  isDocumentCell,
  isDocumentReferenceCell,
  isEdgeCell,
  isFrameCell,
  isFrameReferenceCell,
  isGroupCell,
  isNodeCell,
  type CellId,
  type CellStore,
} from './types';

export interface CellValidationIssue {
  cellId: CellId;
  message: string;
}

/** Validation is independent of DOM and never changes the candidate store. */
export const validateCellStore = (
  store: CellStore,
  registry: CellRegistry = createCellRegistry(),
): CellValidationIssue[] => {
  const issues: CellValidationIssue[] = [];
  const report = (cellId: string, message: string) =>
    issues.push({ cellId, message });
  const parents = new Map<string, string>();
  const root = store.cells[store.rootId];
  if (!root || !isFrameCell(root)) report(store.rootId, 'Root must be a frame');
  Object.entries(store.cells).forEach(([id, cell]) => {
    if (!registry.get(cell.kind))
      report(id, `Unregistered cell kind: ${cell.kind}`);
    if (id !== cell.id) report(id, 'Cell key does not match id');
    if (isFrameCell(cell)) {
      if (cell.geometry.rotation) report(id, 'Frames cannot rotate');
      const seen = new Set<string>();
      [...cell.children, ...cell.groups].forEach((childId) => {
        const child = store.cells[childId];
        if (!child) {
          report(id, `Missing child ${childId}`);
          return;
        }
        if (seen.has(childId)) report(id, `Repeated child ${childId}`);
        seen.add(childId);
        if (parents.has(childId)) report(childId, 'Cell has multiple parents');
        parents.set(childId, id);
        if (isGroupCell(child) !== cell.groups.includes(childId))
          report(childId, 'Groups must be listed in frame.groups');
      });
      const children = cell.children
        .map((childId) => store.cells[childId])
        .filter(Boolean);
      const scenes = registry.scenes.filter((scene) =>
        children.some((child) => scene.anchorKinds.includes(child.kind)),
      );
      if (scenes.length > 1) report(id, 'Mixed frame scenes');
      const scene = scenes[0];
      for (const child of children) {
        if (isFrameCell(child) || isDocumentReferenceCell(child)) continue;
        const childScene = registry.scenes.find((candidate) =>
          candidate.kinds.includes(child.kind),
        );
        if (scene ? !scene.kinds.includes(child.kind) : !!childScene)
          report(child.id, 'Cell does not belong to the frame scene');
      }
      if (scene?.allowGroups === false && cell.groups.length)
        report(id, 'Groups are not allowed in this scene');
    }
    if (isNodeCell(cell)) {
      if (isDocumentCell(cell)) {
        if (
          typeof cell.data?.targetDocumentId !== 'string' ||
          !cell.data.targetDocumentId
        )
          report(id, 'Document reference requires a target');
        if (cell.geometry.rotation)
          report(id, 'Document references cannot rotate');
        if (cell.ports?.length)
          report(id, 'Document references cannot have ports');
      }
      if (isFrameReferenceCell(cell)) {
        // An absent target is a legitimate placeholder state, not an issue.
        if (
          typeof cell.data?.targetFrameId !== 'string' ||
          !cell.data.targetFrameId
        )
          report(id, 'Frame reference requires a target');
        if (cell.geometry.rotation)
          report(id, 'Frame references cannot rotate');
      }
      const g = cell.geometry;
      if (
        ![g.x, g.y, g.width, g.height].every(Number.isFinite) ||
        (g.rotation !== undefined && !Number.isFinite(g.rotation)) ||
        g.width < 0 ||
        g.height < 0
      )
        report(id, 'Invalid geometry');
      const portIds = cell.ports?.map((port) => port.id) ?? [];
      if (new Set(portIds).size !== portIds.length)
        report(id, 'Duplicate ports');
    }
    const error = registry?.validate(store, cell);
    if (error) report(id, error);
  });
  if (parents.has(store.rootId))
    report(store.rootId, 'Root cannot have a parent');
  const groupedMembers = new Set<string>();
  Object.values(store.cells).forEach((cell) => {
    let ancestor = parents.get(cell.id);
    const seen = new Set([cell.id]);
    while (ancestor) {
      if (seen.has(ancestor)) {
        report(cell.id, 'Frame hierarchy cycle');
        break;
      }
      seen.add(ancestor);
      ancestor = parents.get(ancestor);
    }
    if (!parents.has(cell.id) && !isFrameCell(cell))
      report(cell.id, 'Cell must belong to a frame');
    if (isEdgeCell(cell)) {
      for (const terminal of [cell.source, cell.target]) {
        if ('cellId' in terminal) {
          if (
            terminal.anchor &&
            (terminal.anchor.length !== 2 ||
              !terminal.anchor.every(Number.isFinite))
          )
            report(cell.id, 'Invalid bound anchor');
          const endpoint = store.cells[terminal.cellId];
          if (isDocumentCell(endpoint))
            report(cell.id, 'Document references cannot be connected');
          if (!endpoint || !isNodeCell(endpoint))
            report(cell.id, 'Edge endpoint must be a node');
          if (parents.get(terminal.cellId) !== parents.get(cell.id))
            report(cell.id, 'Edge crosses frame boundary');
          if (
            terminal.portId &&
            (!isNodeCell(endpoint) ||
              !endpoint.ports?.some((port) => port.id === terminal.portId))
          )
            report(cell.id, 'Unknown endpoint port');
        } else if (!terminal.point.every(Number.isFinite))
          report(cell.id, 'Invalid free endpoint');
      }
      if (
        'points' in cell.route &&
        cell.route.points &&
        (cell.route.points.length < 2 ||
          cell.route.points.some(
            (point) => point.length !== 2 || !point.every(Number.isFinite),
          ))
      )
        report(cell.id, 'Invalid route points');
      if (
        'strategy' in cell.route &&
        cell.route.strategy !== undefined &&
        (!['auto', 'orthogonal'].includes(cell.route.mode) ||
          cell.route.strategy !== 'optimized')
      )
        report(cell.id, 'Invalid routing strategy');
      const error = registry?.validateEdge(store, cell);
      if (error) report(cell.id, error);
    }
    if (isGroupCell(cell)) {
      const walk = (id: string, stack: Set<string>) => {
        if (stack.has(id)) {
          report(cell.id, 'Group cycle');
          return;
        }
        const member = store.cells[id];
        if (!isGroupCell(member)) return;
        stack.add(id);
        member.members.forEach((child) => walk(child, stack));
        stack.delete(id);
      };
      cell.members.forEach((id) => {
        if (groupedMembers.has(id))
          report(cell.id, 'Cell belongs to multiple groups');
        groupedMembers.add(id);
        const member = store.cells[id];
        if (!member) {
          report(cell.id, `Missing group member ${id}`);
          return;
        }
        const allowed =
          isGroupCell(member) ||
          (isNodeCell(member) &&
            registry.get(member.kind)?.groupable !== false) ||
          (isEdgeCell(member) && registry.get(member.kind)?.groupable === true);
        if (!allowed) report(cell.id, 'Invalid group member');
        if (parents.get(id) !== parents.get(cell.id))
          report(cell.id, 'Group crosses frame');
        walk(id, new Set([cell.id]));
      });
      if (
        new Set(cell.members).size !== cell.members.length ||
        cell.members.length < 2
      )
        report(cell.id, 'Invalid group membership');
      const parent = store.cells[parents.get(cell.id) ?? ''];
      if (
        parent &&
        isFrameCell(parent) &&
        !registry.scenes.some(
          (scene) =>
            scene.consecutiveGroups === false &&
            parent.children.some((id) =>
              scene.anchorKinds.includes(store.cells[id]?.kind),
            ),
        )
      ) {
        const leafPositions = groupLeafMembers(store, cell.id)
          .filter((id) => store.cells[id] && !isGroupCell(store.cells[id]))
          .map((id) => parent.children.indexOf(id))
          .sort((a, b) => a - b);
        if (
          leafPositions.some(
            (position, index) =>
              position < 0 ||
              (index > 0 && position !== leafPositions[index - 1] + 1),
          )
        )
          report(cell.id, 'Group members must be consecutive in one frame');
      }
    }
  });
  return issues;
};
