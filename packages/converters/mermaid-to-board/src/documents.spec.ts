import { describe, expect, it } from 'vitest';
import {
  CellKind,
  createFrameCell,
  isNodeCell,
  isEdgeCell,
  isFrameCell,
  validateCellStore,
} from '@sue/board-core';
import {
  parseMermaidToArchitectureFrame,
  parseMermaidToWorkflowFrame,
  serializeFrameToMermaid,
} from './documents';
const nodes = (snapshot: ReturnType<typeof parseMermaidToArchitectureFrame>) =>
  Object.values(snapshot.store.cells)
    .filter(isNodeCell)
    .filter((node) => !isFrameCell(node));
const edges = (snapshot: ReturnType<typeof parseMermaidToArchitectureFrame>) =>
  Object.values(snapshot.store.cells).filter(isEdgeCell);
describe('Mermaid native Frames', () => {
  it('imports subgraphs, all module shapes and loose nodes as native architecture Cells', () => {
    const snapshot = parseMermaidToArchitectureFrame(`flowchart TB
subgraph apps ["Apps"]
desktop["Desktop"]
choice{"Ship"}
db[("Store")]
end
orphan["Loose"]
desktop -->|uses| choice
`);
    const layers = nodes(snapshot).filter(
      (node) => node.kind === CellKind.architectureLayer,
    );
    expect(layers.map((node) => node.content?.label)).toEqual([
      'Apps',
      'Default',
    ]);
    const modules = nodes(snapshot).filter(
      (node) => node.kind === CellKind.architectureModule,
    );
    expect(modules.map((node) => node.data)).toEqual([
      { shape: 'box' },
      { shape: 'decision' },
      { shape: 'store' },
      { shape: 'box' },
    ]);
    expect(edges(snapshot)[0].labels).toEqual([{ text: 'uses' }]);
    expect(validateCellStore(snapshot.store)).toEqual([]);
    const exported = serializeFrameToMermaid(snapshot);
    const again = parseMermaidToArchitectureFrame(exported);
    expect(again).toEqual(snapshot);
    expect(exported).toBe(serializeFrameToMermaid(again));
  });
  it('imports workflow membership, ports, labels and coordinates without legacy keys', () => {
    const snapshot = parseMermaidToWorkflowFrame(`flowchart LR
%% verd:{"positions":{"start":{"x":40,"y":80},"review":{"x":240,"y":80}},"edges":[{"source":"start","target":"review","key":"e1","sourcePort":"out","targetPort":"top"}]}
start(["Start"])
review{"Review"}
start --> review
`);
    const start = nodes(snapshot).find(
      (node) => node.kind === CellKind.workflowStart,
    )!;
    const review = nodes(snapshot).find(
      (node) => node.kind === CellKind.workflowDecision,
    )!;
    expect(start.content?.label).toBe('Start');
    expect(start.data).toMatchObject({
      memberIds: [start.id, review.id],
      graphMode: 'dag',
    });
    expect(review.geometry).toMatchObject({ x: 240, y: 80 });
    expect(edges(snapshot)[0]).toMatchObject({
      source: { cellId: start.id, portId: 'right' },
      target: { cellId: review.id, portId: 'top' },
    });
    expect(
      parseMermaidToWorkflowFrame(serializeFrameToMermaid(snapshot)),
    ).toEqual(snapshot);
  });
  it('preserves several independent workflow graphs and process mode on export', () => {
    const snapshot = parseMermaidToWorkflowFrame(`flowchart LR
%% verd:{"graphs":[{"start":"a","members":["a","b","e"],"mode":"process","origin":[10,20]},{"start":"c","members":["c","d"],"mode":"dag","origin":[20,300]}]}
a(["One"])
b["Loop"]
e["Return"]
c(["Two"])
d["Task"]
a --> b
b --> e
e --> b
c --> d
`);
    expect(
      nodes(snapshot).filter((node) => node.kind === CellKind.workflowStart),
    ).toHaveLength(2);
    expect(
      parseMermaidToWorkflowFrame(serializeFrameToMermaid(snapshot)),
    ).toEqual(snapshot);
  });
  it('rejects DAG cycles, incoming links to start and invalid ports', () => {
    expect(() =>
      parseMermaidToWorkflowFrame(
        'flowchart LR\nstart([Start])\na[A]\nb[B]\nstart --> a\na --> b\nb --> a',
      ),
    ).toThrow();
    expect(() =>
      parseMermaidToWorkflowFrame(
        'flowchart LR\nstart([Start])\na[A]\na --> start',
      ),
    ).toThrow();
    expect(() =>
      parseMermaidToWorkflowFrame(
        'flowchart LR\n%% verd:{"edges":[{"sourcePort":"missing"}]}\nstart([Start])\na[A]\nstart --> a',
      ),
    ).toThrow();
  });
  it('keeps empty architecture layers and separates colliding layer and module identifiers', () => {
    const snapshot = parseMermaidToArchitectureFrame(
      'flowchart TB\nsubgraph same ["Layer"]\nsame["Module"]\nend\nsubgraph empty ["Empty"]\nend',
    );
    expect(
      nodes(snapshot).filter(
        (node) => node.kind === CellKind.architectureLayer,
      ),
    ).toHaveLength(2);
    expect(
      nodes(snapshot).filter(
        (node) => node.kind === CellKind.architectureModule,
      ),
    ).toHaveLength(1);
    expect(validateCellStore(snapshot.store)).toEqual([]);
  });
  it('rejects nested frames, groups and mind maps instead of omitting them', () => {
    const frame = createFrameCell('root');
    frame.groups = ['g'];
    expect(() =>
      serializeFrameToMermaid({
        store: {
          rootId: 'root',
          cells: {
            root: frame,
            g: {
              id: 'g',
              kind: 'group',
              cellType: 'group',
              members: ['a', 'b'],
            },
          },
        },
      }),
    ).toThrow('JSON');
    const mind = createFrameCell('mind');
    mind.children = ['topic'];
    expect(() =>
      serializeFrameToMermaid({
        store: {
          rootId: 'mind',
          cells: {
            mind,
            topic: {
              id: 'topic',
              kind: 'mind-root',
              cellType: 'node',
              geometry: { x: 0, y: 0, width: 10, height: 10 },
            },
          },
        },
      }),
    ).toThrow('JSON');
  });
});
