import {
  createCellStore,
  createFrameCell,
  type Cell,
  type EdgeCell,
  type FrameCell,
  type GroupCell,
  type NodeCell,
} from '../../packages/engine/core/src/cell/types';
import {
  createArchitectureLayerCell,
  createArchitectureModuleCell,
} from '../../packages/engine/architecture/src/cell-commands';

/** A legacy container in another file must not turn a color edit into a move. */
export function styleColorWorkspaceFixture() {
  const board = createFrameCell('style-board');
  board.name = 'Style colors';
  board.geometry = { x: 0, y: 0, width: 900, height: 400 };
  board.view = {
    theme: { themeColorMode: 'default', backgroundMode: 'theme' },
  };
  const source: NodeCell = {
    id: 'style-source',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 100, y: 120, width: 200, height: 100, outline: 'rectangle' },
    content: { label: 'Source' },
  };
  const target: NodeCell = {
    ...source,
    id: 'style-target',
    geometry: { ...source.geometry, x: 500 },
    content: { label: 'Target' },
  };
  const edge: EdgeCell = {
    id: 'style-edge',
    kind: 'arrow',
    cellType: 'edge',
    source: { cellId: source.id, anchor: [1, 0.5] },
    target: { cellId: target.id, anchor: [0, 0.5] },
    route: { mode: 'auto' },
  };
  board.children = [edge.id, source.id, target.id];

  const legacy = createFrameCell('style-legacy');
  legacy.name = 'Legacy containers';
  const layer = createArchitectureLayerCell('style-layer');
  layer.geometry = {
    ...layer.geometry,
    x: 40,
    y: 100,
    width: 640,
    height: 260,
    derived: false,
  };
  const member = createArchitectureModuleCell('style-member');
  member.geometry = { ...member.geometry, x: 80, y: 140, derived: false };
  member.data = { shape: 'box', placed: true };
  layer.data!.memberIds = [member.id];
  const heading: NodeCell = {
    ...source,
    id: 'style-heading',
    geometry: { ...source.geometry, x: 400, y: 140, outline: 'text' },
    content: { label: 'Companion' },
  };
  const group: GroupCell = {
    id: 'style-group',
    kind: 'group',
    cellType: 'group',
    members: [member.id, heading.id],
  };
  legacy.children = [layer.id, member.id, heading.id];
  legacy.groups = [group.id];
  const file = (frame: FrameCell, cells: Cell[]) => ({
    format: 'verd-frame' as const,
    version: 2 as const,
    frame,
    cells: Object.fromEntries(cells.map((cell) => [cell.id, cell])),
  });
  const files = [
    file(board, [source, target, edge]),
    file(legacy, [layer, member, heading, group]),
  ];
  const root = createFrameCell('style-workspace');
  root.children = files.map(({ frame }) => frame.id);
  const store = createCellStore(root);
  for (const file of files)
    Object.assign(store.cells, file.cells, { [file.frame.id]: file.frame });
  return { files, store };
}
