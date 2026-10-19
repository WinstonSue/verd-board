import { entityCodesToText } from './utils.js';
import {
  createUmlClassFrameSnapshot,
  createUmlSequenceFrameSnapshot,
  createUmlClassCell,
  createUmlParticipantCell,
  createUmlRelationCell,
  createUmlMessageCell,
  createUmlNoteCell,
  createUmlFragmentCell,
  registerUmlCells,
} from '@sue/board-uml';
import {
  createCellRegistry,
  isFrameCell,
  isNodeCell,
  umlRoot,
  validateCellStore,
  type Cell,
  type NodeCell,
  type EdgeCell,
  type FrameSnapshot,
  type UmlClassData,
  type UmlRelationData,
  type UmlSequenceData,
  type UmlFragmentData,
  type UmlNoteData,
  type UmlMessageData,
  type UmlEvent,
  type UmlRelation,
} from '@sue/board-core';
import type { Diagram } from 'mermaid/dist/Diagram.js';
import type {
  ClassNode,
  ClassRelation,
  ClassMember,
} from 'mermaid/dist/diagrams/class/classTypes.js';
type Db = {
  getClasses(): Record<string, ClassNode>;
  getRelations(): ClassRelation[];
  getNamespaces(): Record<string, unknown>;
  getNotes(): unknown[];
  getActors(): Record<
    string,
    { description: string; type: 'participant' | 'actor'; prevActor?: string }
  >;
  getActorKeys?(): string[];
  getMessages(): {
    type: number;
    from: any;
    to: any;
    message: string;
    placement?: number;
  }[];
  getBoxes(): unknown[];
  getCreatedActors(): Record<string, unknown>;
  getDestroyedActors(): Record<string, unknown>;
  showSequenceNumbers?(): boolean;
};
const text = (value: string) =>
  entityCodesToText(value).replace(/<br\s*\/?>/gi, '\n');
const actorId = (value: any): string =>
  typeof value === 'string' ? value : value?.actor;
function checked(snapshot: FrameSnapshot) {
  const registry = createCellRegistry();
  registerUmlCells(registry);
  const issues = validateCellStore(snapshot.store, registry);
  if (issues.length) throw new Error(issues.map((i) => i.message).join('; '));
  return snapshot;
}
/** Consume Mermaid's semantic database before its SVG/skeleton projection discards structure. */
export function mermaidDiagramToUml(
  diagram: Diagram,
  scene: 'uml-class' | 'uml-sequence',
  definition: string,
): FrameSnapshot {
  const expected = scene === 'uml-class' ? 'classDiagram' : 'sequence';
  if (diagram.type !== expected)
    throw new Error(`Expected Mermaid ${expected} for ${scene}`);
  const db = diagram.db as unknown as Db;
  const metaLine = definition
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('%% verd-uml:'));
  const meta = metaLine
    ? (JSON.parse(metaLine.trim().slice('%% verd-uml:'.length)) as {
        frameId?: string;
        cellIds?: Record<string, string>;
        positions?: Record<string, { x: number; y: number; width: number }>;
        rootId?: string;
      })
    : {};
  const frameId = meta.frameId ?? 'mermaid:uml:frame',
    rootId = meta.rootId ?? 'mermaid:uml:root';
  const snapshot =
    scene === 'uml-class'
      ? createUmlClassFrameSnapshot(frameId, rootId)
      : createUmlSequenceFrameSnapshot(frameId, rootId);
  const frame = snapshot.store.cells[
      frameId
    ] as import('@sue/board-core').FrameCell,
    root = snapshot.store.cells[rootId] as NodeCell<UmlSequenceData>;
  let counter = 0;
  const idFor = (key: string) => meta.cellIds?.[key] ?? `mermaid:uml:${key}`;
  const add = (cell: Cell) => {
    if (snapshot.store.cells[cell.id])
      throw new Error('Duplicate UML import identity');
    snapshot.store.cells[cell.id] = cell;
    frame.children.push(cell.id);
  };
  if (scene === 'uml-class') {
    if (Object.keys(db.getNamespaces()).length || db.getNotes().length)
      throw new Error('UML class namespaces and notes are not supported');
    const classes = db.getClasses();
    const member = (m: ClassMember) =>
      `${m.visibility}${m.id}${m.memberType === 'method' ? `(${m.parameters ?? ''})${m.returnType ? ` ${m.returnType}` : ''}` : ''}${m.classifier ?? ''}`;
    for (const [at, [key, value]] of Object.entries(classes).entries()) {
      const annotations = value.annotations.map((a) => a.toLowerCase());
      if (
        annotations.some(
          (a) => !['interface', 'abstract', 'enumeration', 'enum'].includes(a),
        )
      )
        throw new Error('Unsupported UML class annotation');
      const kind = annotations.includes('interface')
        ? 'interface'
        : annotations.includes('abstract')
          ? 'abstract'
          : annotations.includes('enumeration') || annotations.includes('enum')
            ? 'enum'
            : 'class';
      const cell = createUmlClassCell(idFor(key), kind);
      cell.content = { label: text(value.label || key) };
      cell.data!.attributes = value.members.map((m) => text(member(m)));
      cell.data!.methods = value.methods.map((m) => text(member(m)));
      cell.geometry = {
        ...cell.geometry,
        x: 60 + (at % 3) * 280,
        y: 80 + Math.floor(at / 3) * 260,
        ...meta.positions?.[key],
      };
      add(cell);
    }
    for (const relation of db.getRelations()) {
      const { type1, type2, lineType } = relation.relation;
      const markers = [type1, type2].filter((t) => t >= 0 && t !== -1);
      if (markers.length > 1 || markers.includes(4))
        throw new Error('Unsupported UML relationship markers');
      let source = relation.id1,
        target = relation.id2;
      let sourceMultiplicity = relation.relationTitle1,
        targetMultiplicity = relation.relationTitle2;
      const marker = markers[0];
      let kind: UmlRelation = 'association';
      if (marker === 0 || marker === 2) {
        kind = marker === 0 ? 'aggregation' : 'composition';
        if (type2 === marker) {
          [source, target] = [target, source];
          [sourceMultiplicity, targetMultiplicity] = [
            targetMultiplicity,
            sourceMultiplicity,
          ];
        }
      } else if (marker === 1 || marker === 3) {
        kind =
          marker === 1
            ? lineType === 1
              ? 'realization'
              : 'generalization'
            : lineType === 1
              ? 'dependency'
              : 'association';
        if (type1 === marker) {
          [source, target] = [target, source];
          [sourceMultiplicity, targetMultiplicity] = [
            targetMultiplicity,
            sourceMultiplicity,
          ];
        }
      } else if (lineType === 1)
        throw new Error('Unsupported undirected dotted UML relation');
      const cell = createUmlRelationCell(
        idFor(`relation${counter++}`),
        idFor(source),
        idFor(target),
        kind,
      );
      cell.labels = [{ text: text(relation.title ?? '') }];
      cell.data = {
        ...cell.data!,
        navigable: marker === 3 && lineType === 0,
        sourceMultiplicity:
          sourceMultiplicity === 'none' ? '' : text(sourceMultiplicity ?? ''),
        targetMultiplicity:
          targetMultiplicity === 'none' ? '' : text(targetMultiplicity ?? ''),
      };
      add(cell);
    }
  } else {
    if (
      db.getBoxes().length ||
      Object.keys(db.getCreatedActors()).length ||
      Object.keys(db.getDestroyedActors()).length ||
      db.showSequenceNumbers?.()
    )
      throw new Error(
        'Unsupported UML sequence grouping, creation/destruction or autonumber',
      );
    const actors = db.getActors();
    const actorIds = db.getActorKeys?.() ?? Object.keys(actors);
    root.data!.participantIds = actorIds.map(idFor);
    for (const key of actorIds) {
      const value = actors[key];
      const cell = createUmlParticipantCell(idFor(key), value.type);
      cell.content = { label: text(value.description || key) };
      add(cell);
    }
    const stack: {
      fragment?: NodeCell<UmlFragmentData>;
      events: UmlEvent[];
    }[] = [{ events: root.data!.events }];
    const append = (cell: Cell) => {
      add(cell);
      stack.at(-1)!.events.push({ type: 'cell', cellId: cell.id });
    };
    for (const message of db.getMessages()) {
      const type = message.type,
        from = actorId(message.from),
        to = actorId(message.to),
        label = text(message.message ?? '');
      if ([0, 1, 5, 6, 24, 25].includes(type)) {
        const cell = createUmlMessageCell(
          idFor(`message${counter++}`),
          idFor(from),
          idFor(to),
          [1, 6, 25].includes(type)
            ? 'return'
            : [5, 24].includes(type)
              ? 'async'
              : 'sync',
        );
        cell.labels = [{ text: label }];
        append(cell);
      } else if (type === 2) {
        const cell = createUmlNoteCell(idFor(`note${counter++}`), [
          ...new Set([from, to].filter(Boolean).map(idFor)),
        ]);
        cell.content = { label };
        cell.data!.position =
          message.placement === 0
            ? 'left'
            : message.placement === 1
              ? 'right'
              : 'over';
        append(cell);
      } else if (type === 17 || type === 18) {
        stack.at(-1)!.events.push({
          type: type === 17 ? 'activate' : 'deactivate',
          id: idFor(`activation${counter++}`),
          participantId: idFor(from),
        });
      } else if ([10, 12, 15].includes(type)) {
        const cell = createUmlFragmentCell(
          idFor(`fragment${counter++}`),
          type === 10 ? 'loop' : type === 12 ? 'alt' : 'opt',
        );
        cell.data!.operands = [
          { id: `${cell.id}:operand:0`, guard: label, events: [] },
        ];
        append(cell);
        stack.push({ fragment: cell, events: cell.data!.operands[0].events });
      } else if (type === 13) {
        const current = stack.at(-1)!;
        if (current.fragment?.data?.operator !== 'alt')
          throw new Error('Invalid UML else');
        const operand = {
          id: `${current.fragment.id}:operand:${current.fragment.data.operands.length}`,
          guard: label,
          events: [],
        };
        current.fragment.data.operands.push(operand);
        current.events = operand.events;
      } else if ([11, 14, 16].includes(type)) {
        if (stack.length === 1) throw new Error('Invalid UML fragment end');
        stack.pop();
      } else throw new Error(`Unsupported UML sequence event: ${type}`);
    }
    if (stack.length !== 1) throw new Error('Unclosed UML fragment');
  }
  return checked(snapshot);
}
const escapedText = (value: string) =>
  value
    .replace(/[#;]/g, (char) => (char === '#' ? '#35;' : '#59;'))
    .replace(/\r?\n/g, '<br/>');
const quoted = (value: string) =>
  `"${escapedText(value).replace(/"/g, '#quot;').replace(/\\/g, '#92;')}"`;
const messageText = escapedText;
export function serializeUmlToMermaid(
  snapshot: FrameSnapshot,
  frameId = snapshot.store.rootId,
): string {
  checked(snapshot);
  const { store } = snapshot,
    frame = store.cells[frameId],
    root = umlRoot(store, frameId);
  if (!isFrameCell(frame) || !root) throw new Error('Missing UML frame');
  if (
    frame.groups.length ||
    frame.children.some((id) => !store.cells[id].kind.startsWith('uml-'))
  )
    throw new Error('Mermaid cannot express this frame; export JSON instead');
  const aliases = new Map<string, string>();
  const meta: {
    frameId: string;
    rootId: string;
    cellIds: Record<string, string>;
    positions: Record<string, { x: number; y: number; width: number }>;
  } = { frameId, rootId: root.id, cellIds: {}, positions: {} };
  const alias = (id: string) => {
    if (!aliases.has(id)) {
      const key = `n${aliases.size}`;
      aliases.set(id, key);
      meta.cellIds[key] = id;
    }
    return aliases.get(id)!;
  };
  let lines: string[];
  if (root.kind === 'uml-class-root') {
    lines = ['classDiagram'];
    for (const id of frame.children) {
      const cell = store.cells[id];
      if (cell.kind !== 'uml-class') continue;
      const node = cell as NodeCell<UmlClassData>,
        key = alias(id);
      meta.positions[key] = {
        x: node.geometry.x,
        y: node.geometry.y,
        width: node.geometry.width,
      };
      lines.push(`  class ${key}[${quoted(node.content?.label ?? '')}]`);
      if (node.data!.classifier !== 'class')
        lines.push(
          `  <<${node.data!.classifier === 'enum' ? 'enumeration' : node.data!.classifier}>> ${key}`,
        );
      if (node.data!.attributes.length || node.data!.methods.length) {
        lines.push(`  class ${key} {`);
        for (const member of [
          ...node.data!.attributes,
          ...node.data!.methods,
        ]) {
          if (/[{}\n\r]/.test(member))
            throw new Error('Member text cannot be represented in Mermaid');
          lines.push(`    ${messageText(member)}`);
        }
        lines.push('  }');
      }
    }
    const syntax: Record<UmlRelation, string> = {
      association: '--',
      dependency: '..>',
      generalization: '--|>',
      realization: '..|>',
      aggregation: 'o--',
      composition: '*--',
    };
    let count = 0;
    for (const id of frame.children) {
      const cell = store.cells[id];
      if (cell.kind !== 'uml-relation') continue;
      const edge = cell as EdgeCell<UmlRelationData>;
      if (!('cellId' in edge.source) || !('cellId' in edge.target))
        throw new Error('Invalid UML endpoint');
      const d = edge.data!;
      meta.cellIds[`relation${count++}`] = edge.id;
      lines.push(
        `  ${alias(edge.source.cellId)}${d.sourceMultiplicity ? ` ${quoted(d.sourceMultiplicity)}` : ''} ${d.relation === 'association' && d.navigable ? '-->' : syntax[d.relation]}${d.targetMultiplicity ? ` ${quoted(d.targetMultiplicity)}` : ''} ${alias(edge.target.cellId)}${edge.labels?.[0]?.text ? ` : ${messageText(edge.labels[0].text)}` : ''}`,
      );
    }
  } else {
    lines = ['sequenceDiagram'];
    const data = root.data as UmlSequenceData;
    for (const id of data.participantIds) {
      const cell = store.cells[id] as NodeCell<{ actorType: string }>;
      lines.push(
        `  ${cell.data!.actorType} ${alias(id)} as ${messageText(cell.content?.label ?? '')}`,
      );
    }
    let count = 0;
    const write = (events: UmlEvent[], indent = '  ') => {
      for (const event of events) {
        if (event.type !== 'cell') {
          meta.cellIds[`activation${count++}`] = event.id;
          lines.push(`${indent}${event.type} ${alias(event.participantId)}`);
          continue;
        }
        const cell = store.cells[event.cellId];
        if (cell.kind === 'uml-message') {
          const edge = cell as EdgeCell<UmlMessageData>;
          if (!('cellId' in edge.source) || !('cellId' in edge.target))
            throw new Error('Invalid UML endpoint');
          meta.cellIds[`message${count++}`] = cell.id;
          lines.push(
            `${indent}${alias(edge.source.cellId)}${edge.data!.messageKind === 'return' ? '-->>' : edge.data!.messageKind === 'async' ? '-)' : '->>'}${alias(edge.target.cellId)}: ${messageText(edge.labels?.[0]?.text ?? '')}`,
          );
        } else if (cell.kind === 'uml-note') {
          const node = cell as NodeCell<UmlNoteData>;
          meta.cellIds[`note${count++}`] = cell.id;
          const ids = node.data!.participantIds;
          if (node.data!.position !== 'over' && ids.length > 1)
            throw new Error('Side notes support one participant in Mermaid');
          lines.push(
            `${indent}Note ${node.data!.position === 'over' ? 'over' : `${node.data!.position} of`} ${[...new Set(ids)].map(alias).join(',')}: ${messageText(node.content?.label ?? '')}`,
          );
        } else if (cell.kind === 'uml-fragment') {
          const node = cell as NodeCell<UmlFragmentData>;
          meta.cellIds[`fragment${count++}`] = cell.id;
          node.data!.operands.forEach((operand, i) => {
            lines.push(
              `${indent}${i ? 'else' : node.data!.operator} ${messageText(operand.guard)}`,
            );
            write(operand.events, indent + '  ');
          });
          lines.push(`${indent}end`);
        }
      }
    };
    write(data.events);
  }
  // Metadata keys for participant/class aliases are also used by the importer.
  lines.splice(1, 0, `%% verd-uml:${JSON.stringify(meta)}`);
  return lines.join('\n') + '\n';
}
