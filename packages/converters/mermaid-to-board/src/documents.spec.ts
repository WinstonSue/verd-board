import { ArchitectureKind } from '@sue/board-architecture';
import {
  createFrameCell,
  isEdgeCell,
  isFrameCell,
  isNodeCell,
  validateCellStore,
} from '@sue/board-core';
import { WorkflowKind } from '@sue/board-workflow';
import { describe, expect, it } from 'vitest';
import { createTestCellRegistry as createFixtureRegistry } from '../../../../tests/fixtures/plugins/registry';
import {
  parseMermaidToArchitectureFrame,
  parseMermaidToWorkflowFrame,
  serializeFrameToMermaid,
} from './documents';
import { parseMermaidToFrameSnapshot } from './index';
const testCellRegistry = createFixtureRegistry();
const nodes = (snapshot: ReturnType<typeof parseMermaidToArchitectureFrame>) =>
  Object.values(snapshot.store.cells)
    .filter(isNodeCell)
    .filter((node) => !isFrameCell(node));
const edges = (snapshot: ReturnType<typeof parseMermaidToArchitectureFrame>) =>
  Object.values(snapshot.store.cells).filter(isEdgeCell);
describe('Mermaid native Frames', () => {
  it.each(['text', 'full'] as const)(
    'round-trips mixed layer relationships, free modules and bounds through the %s parser',
    async (parser) => {
      const parse = (source: string) =>
        parser === 'full'
          ? parseMermaidToFrameSnapshot(source, { scene: 'architecture' })
          : Promise.resolve(parseMermaidToArchitectureFrame(source));
      const snapshot = await parse(`flowchart TB
subgraph a [Apps]
service[Service]
end
subgraph b [Data]
end
loose[Loose]
a -.->|uses| b
b -->|events| a
service -->|legacy call| loose
%% verd:{"layerBounds":{"a":{"x":20,"y":30,"width":440,"height":240},"b":{"x":600,"y":30,"width":360,"height":240}},"positions":{"service":{"x":60,"y":100},"loose":{"x":80,"y":400}},"edges":[{"key":"layer-dependency","sourcePort":"right","targetPort":"left","relation":"dependency"},{"key":"layer-flow","sourcePort":"bottom","targetPort":"bottom","relation":"flow"},{"key":"legacy-module","sourcePort":"bottom","targetPort":"top"}]}
`);
      const layerNodes = nodes(snapshot).filter(
        (node) => node.kind === 'architecture-layer',
      );
      expect(layerNodes).toHaveLength(2);
      expect(
        nodes(snapshot).filter((node) => node.kind === 'architecture-module'),
      ).toHaveLength(2);
      expect(edges(snapshot)[0]).toMatchObject({
        source: { cellId: layerNodes[0].id, portId: 'right' },
        target: { cellId: layerNodes[1].id, portId: 'left' },
        data: { relation: 'dependency' },
      });
      const source = serializeFrameToMermaid(snapshot);
      expect(
        edges(snapshot).map(
          (edge) => (edge.data as { relation?: string } | undefined)?.relation,
        ),
      ).toEqual(['dependency', 'flow', undefined]);
      const restored = await parse(source);
      expect(restored).toEqual(snapshot);
      expect(source).toContain('-.->');
      const external = await parse('flowchart LR\na[A]\nb[B]\na -.-> b');
      expect(edges(external)[0].data).toBeUndefined();
      expect(edges(external)[0].appearance?.strokeStyle).toBe('dashed');
    },
  );
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
      (node) => node.kind === ArchitectureKind.architectureLayer,
    );
    expect(layers.map((node) => node.content?.label)).toEqual(['Apps']);
    const modules = nodes(snapshot).filter(
      (node) => node.kind === ArchitectureKind.architectureModule,
    );
    expect(modules.map((node) => node.data)).toEqual([
      { shape: 'box' },
      { shape: 'decision' },
      { shape: 'store' },
      { shape: 'box', placed: true },
    ]);
    expect(edges(snapshot)[0].labels).toEqual([{ text: 'uses' }]);
    expect(validateCellStore(snapshot.store, testCellRegistry)).toEqual([]);
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
      (node) => node.kind === WorkflowKind.workflowStart,
    )!;
    const review = nodes(snapshot).find(
      (node) => node.kind === WorkflowKind.workflowDecision,
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
      nodes(snapshot).filter(
        (node) => node.kind === WorkflowKind.workflowStart,
      ),
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
        (node) => node.kind === ArchitectureKind.architectureLayer,
      ),
    ).toHaveLength(2);
    expect(
      nodes(snapshot).filter(
        (node) => node.kind === ArchitectureKind.architectureModule,
      ),
    ).toHaveLength(1);
    expect(validateCellStore(snapshot.store, testCellRegistry)).toEqual([]);
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
