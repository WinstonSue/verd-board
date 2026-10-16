import { useMemo, useRef, useState } from 'react';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameAdapter,
  type FrameRenderExtension,
} from '@sue/board-react';
import {
  createCellRegistry,
  applyCellOperations,
  createFrameCell,
  isNodeCell,
  type CellTransaction,
  type FrameSnapshot,
  type CellStore,
  type NodeCell,
} from '@sue/board-core';
import { createWorkflowFrameExtensions } from '@sue/board-react-workflow';
import { createMindFrameExtensions } from '@sue/board-react-mind';
import { createArchitectureFrameExtensions } from '@sue/board-react-architecture';
import {
  createWorkflowStartCell,
  createWorkflowTaskCell,
  createWorkflowFrameSnapshot,
  addWorkflowTask,
} from '@sue/board-workflow';
import {
  createMindRootCell,
  createMindChildCell,
  createMindFrameSnapshot,
} from '@sue/board-mind';
import {
  createArchitectureModuleCell,
  createArchitectureFrameSnapshot,
  addArchitectureModule,
} from '@sue/board-architecture';

const useExtensions = () =>
  useMemo(() => {
    const registry = createCellRegistry();
    return {
      registry,
      extensions: [
        ...createMindFrameExtensions(registry),
        ...createWorkflowFrameExtensions(registry),
        ...createArchitectureFrameExtensions(registry),
      ],
    };
  }, []);
const initialGraph = () => ({
  nodes: [{ key: 'cmd-1', kind: 'command', config: { name: 'Run' } }],
});
type Graph = ReturnType<typeof initialGraph>;
const graphAdapter: FrameAdapter<Graph> = {
  toFrameSnapshot: (graph) => {
    const root = createFrameCell('workflow-frame'),
      start = createWorkflowStartCell('start');
    start.data!.memberIds = ['start', ...graph.nodes.map((node) => node.key)];
    root.children = ['start', ...graph.nodes.map((node) => node.key)];
    return {
      store: {
        rootId: root.id,
        cells: {
          [root.id]: root,
          start,
          ...Object.fromEntries(
            graph.nodes.map((node, index) => [
              node.key,
              {
                ...createWorkflowTaskCell(node.key),
                geometry: {
                  x: 280,
                  y: 80 + index * 80,
                  width: 160,
                  height: 48,
                  outline: 'roundRectangle',
                },
                content: { label: node.kind },
                data: node,
              },
            ]),
          ),
        },
      },
    };
  },
};
function WorkflowHarness({ dual = false }: { dual?: boolean }) {
  const [graph, setGraph] = useState(initialGraph),
    { registry, extensions } = useExtensions();
  const ref = useRef<FrameCanvasController>(null);
  const render: FrameRenderExtension = {
    kind: 'workflow-task',
    render: ({ cell, geometry }) => (
      <foreignObject
        x={geometry!.x}
        y={geometry!.y}
        width={geometry!.width}
        height={geometry!.height}
      >
        <div data-testid={`node-${cell.id}`}>
          {(cell as NodeCell<Graph['nodes'][number]>).data?.kind}:{cell.id}
        </div>
      </foreignObject>
    ),
  };
  const onIntent = (transaction: CellTransaction) => {
    const candidate = applyCellOperations(
      graphAdapter.toFrameSnapshot(graph).store,
      transaction.operations,
      registry,
    );
    setGraph({
      nodes: Object.values(candidate.cells)
        .filter((cell) => cell.kind === 'workflow-task')
        .map((cell) => ({
          key: cell.id,
          kind:
            (cell as NodeCell<Graph['nodes'][number]>).data?.kind ?? 'command',
          config: (cell as NodeCell<Graph['nodes'][number]>).data?.config ?? {
            name: 'Added',
          },
        })),
    });
    return { status: 'accepted' as const };
  };
  const add = () => {
    const store = ref.current!.runtime.store;
    const node = createWorkflowTaskCell(crypto.randomUUID());
    node.data = { kind: 'command', config: { name: 'Added' } };
    void ref.current!.dispatch({
      id: crypto.randomUUID(),
      operations: addWorkflowTask(store, 'start', node),
    });
  };
  const canvas = (name: string) => (
    <div
      data-testid={`workflow-canvas-${name}`}
      style={{ height: 360, border: '1px solid #ddd' }}
    >
      <FrameCanvas
        ref={name === 'a' ? ref : undefined}
        value={graph}
        adapter={graphAdapter}
        registry={registry}
        extensions={[...extensions, render]}
        onIntent={onIntent}
      />
    </div>
  );
  return (
    <div>
      <h1>Workflow harness</h1>
      <pre data-testid="fixture-json">{JSON.stringify(graph)}</pre>
      <div data-testid="workflow-nodes">
        {graph.nodes.map((node) => (
          <div key={node.key} data-testid={`node-${node.key}`}>
            {node.kind}:{node.key}
          </div>
        ))}
      </div>
      <button data-testid="palette-command" onClick={add}>
        command
      </button>
      <button data-testid="palette-workspace" onClick={add}>
        workspace
      </button>
      {canvas('a')}
      {dual && canvas('b')}
    </div>
  );
}
type Goal = { id: string; title: string; children?: Goal[] };
const mindAdapter: FrameAdapter<Goal[]> = {
  toFrameSnapshot: (roots) => {
    const root = createFrameCell('mind-frame'),
      cells: CellStore['cells'] = { [root.id]: root };
    const walk = (goal: Goal, parent?: string, index = 0) => {
      const node = parent
        ? createMindChildCell(goal.id)
        : createMindRootCell(goal.id, [40, 80 + index * 200]);
      node.content = { label: goal.title };
      cells[node.id] = node;
      root.children.push(node.id);
      if (parent) {
        const edgeId = `branch/${parent.length}:${parent}/${goal.id.length}:${goal.id}`;
        cells[edgeId] = {
          id: edgeId,
          kind: 'mind-branch',
          cellType: 'edge',
          source: { cellId: parent },
          target: { cellId: goal.id },
          route: { mode: 'auto' },
          data: { order: String(index).padStart(8, '0') },
        };
        root.children.push(edgeId);
      }
      goal.children?.forEach((child, index) => walk(child, goal.id, index));
    };
    roots.forEach((goal, index) => walk(goal, undefined, index));
    return { store: { rootId: root.id, cells } };
  },
};
function MindHarness() {
  const [roots, setRoots] = useState<Goal[]>([
      {
        id: 'goal-1',
        title: 'North',
        children: [{ id: 'goal-1-1', title: 'Child' }],
      },
      { id: 'goal-2', title: 'South' },
    ]),
    { registry, extensions } = useExtensions();
  const rejectHost = new URLSearchParams(window.location.search).get('reject');
  const onIntent = (transaction: CellTransaction) => {
    if (rejectHost === '1')
      return { status: 'rejected' as const, message: 'Denied' };
    const store = applyCellOperations(
      mindAdapter.toFrameSnapshot(roots).store,
      transaction.operations,
      registry,
    );
    const rename = (nodes: Goal[]): Goal[] =>
      nodes.map((node) => ({
        ...node,
        title: (store.cells[node.id] as NodeCell).content?.label ?? node.title,
        children: node.children ? rename(node.children) : undefined,
      }));
    setRoots(rename(roots));
    return { status: 'accepted' as const };
  };
  const render: FrameRenderExtension = {
    render: ({ cell, geometry, dispatch }) => {
      if (!isNodeCell(cell)) return null;
      return (
        <foreignObject
          data-testid={`mind-node-${cell.id}`}
          x={geometry!.x}
          y={geometry!.y}
          width={geometry!.width}
          height={geometry!.height}
        >
          <button
            data-testid={`mind-edit-${cell.id}`}
            onClick={() =>
              void dispatch({
                id: crypto.randomUUID(),
                operations: [
                  {
                    type: 'replace_cell',
                    cell: {
                      ...cell,
                      content: { label: `${cell.content?.label}!` },
                    },
                  },
                ],
              })
            }
          >
            {cell.content?.label}
          </button>
        </foreignObject>
      );
    },
  };
  return (
    <div style={{ height: 480 }}>
      <h1>Mind harness</h1>
      <pre data-testid="mind-host-json">{JSON.stringify(roots)}</pre>
      <FrameCanvas
        value={roots}
        adapter={mindAdapter}
        registry={registry}
        extensions={[...extensions, render]}
        onIntent={onIntent}
      />
    </div>
  );
}
function StandardHarness({
  kind,
}: {
  kind: 'mind' | 'workflow' | 'architecture';
}) {
  const [value, setValue] = useState<FrameSnapshot>(() =>
    kind === 'mind'
      ? createMindFrameSnapshot('frame', 'center')
      : kind === 'workflow'
        ? createWorkflowFrameSnapshot('frame', 'start')
        : createArchitectureFrameSnapshot('frame', 'layer'),
  );
  const { registry, extensions } = useExtensions(),
    ref = useRef<FrameCanvasController>(null);
  const add = () => {
    const store = ref.current!.runtime.store;
    void ref.current!.dispatch({
      id: crypto.randomUUID(),
      operations:
        kind === 'workflow'
          ? addWorkflowTask(store, 'start', {
              ...createWorkflowTaskCell(crypto.randomUUID()),
              content: { label: 'Added task' },
            })
          : addArchitectureModule(store, 'layer', {
              ...createArchitectureModuleCell('box-1'),
              content: { label: 'Box' },
            }),
    });
  };
  return (
    <div style={{ height: 480 }}>
      <h1>
        {kind === 'mind'
          ? 'Mind document'
          : kind === 'workflow'
            ? 'Workflow document'
            : 'Architecture document'}
      </h1>
      <pre data-testid={`${kind}-document-json`}>
        {JSON.stringify(value.store)}
      </pre>
      {kind !== 'mind' && (
        <button data-testid={`${kind}-document-add`} onClick={add}>
          add
        </button>
      )}
      <FrameCanvas
        ref={ref}
        value={value}
        registry={registry}
        extensions={extensions}
        onChange={({ snapshot }) => setValue(snapshot)}
      />
    </div>
  );
}
type ArchitectureHost = { label: string };
const architectureAdapter: FrameAdapter<ArchitectureHost> = {
  toFrameSnapshot: (host) => {
    const value = createArchitectureFrameSnapshot('frame', 'default'),
      layer = value.store.cells.default as NodeCell<{
        order: string;
        memberIds: string[];
      }>;
    layer.data!.memberIds = ['service'];
    (
      value.store.cells.frame as import('@sue/board-core').FrameCell
    ).children.push('service');
    value.store.cells.service = {
      ...createArchitectureModuleCell('service'),
      content: { label: host.label },
    };
    return value;
  },
};
function ArchitectureHarness() {
  const [host, setHost] = useState<ArchitectureHost>({ label: 'Service' }),
    { registry, extensions } = useExtensions(),
    ref = useRef<FrameCanvasController>(null);
  return (
    <div style={{ height: 480 }}>
      <h1>Architecture projection</h1>
      <pre data-testid="architecture-host-json">{JSON.stringify(host)}</pre>
      <button
        data-testid="architecture-projection-rename"
        onClick={() => {
          const cell = ref.current!.runtime.store.cells.service as NodeCell;
          void ref.current!.dispatch({
            id: crypto.randomUUID(),
            operations: [
              {
                type: 'replace_cell',
                cell: { ...cell, content: { label: 'Service!' } },
              },
            ],
          });
        }}
      >
        rename
      </button>
      <FrameCanvas
        ref={ref}
        value={host}
        adapter={architectureAdapter}
        registry={registry}
        extensions={extensions}
        onIntent={(transaction) => {
          const store = applyCellOperations(
            architectureAdapter.toFrameSnapshot(host).store,
            transaction.operations,
            registry,
          );
          setHost({ label: (store.cells.service as NodeCell).content!.label! });
          return { status: 'accepted' };
        }}
      />
    </div>
  );
}
export function ProviderHarness({ kind }: { kind: string }) {
  if (kind === 'mind') return <MindHarness />;
  if (kind === 'architecture') return <ArchitectureHarness />;
  if (kind.endsWith('-document'))
    return (
      <StandardHarness
        kind={kind.split('-')[0] as 'mind' | 'workflow' | 'architecture'}
      />
    );
  return <WorkflowHarness dual={kind === 'workflow-dual'} />;
}
