import { createDefaultWorkflowDocument } from './legacy/workflow-document';
import {
  registerDrawCells,
  validateTableData,
  tableGrid,
  type TableCellData,
} from '@sue/board-draw';
import { isGroupCell, isNodeCell, type NodeCell } from '@sue/board-core';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { migrateLegacyCellWorkspace } from './cell-workspace';
import {
  loadCellWorkspace,
  MIGRATION_BACKUP_KEY,
} from '../frames/workspace-storage';
import { registerWorkflowCells } from '@sue/board-workflow';
import {
  createCellStore,
  createFrameCell,
  createCellRegistry,
  isEdgeCell,
  relativeAnchor,
  pathNodePoints,
  type VectorLineData,
} from '@sue/board-core';
const memory = (source: Record<string, unknown>) => {
  const values = new Map(Object.entries(source));
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
    removeItem: async (key: string) => {
      values.delete(key);
    },
    listKeys: async () => [...values.keys()],
  };
};
describe('legacy cell workspace migration', () => {
  it('migrates shared mind copies, colliding architecture identities, empty detached layers and cyclic multi-graph workflows with durable views', async () => {
    const source = JSON.parse(
      readFileSync(
        '../../../tests/fixtures/legacy/domain-workspace.json',
        'utf8',
      ),
    );
    const registry = createCellRegistry();
    registerDrawCells(registry);
    registerWorkflowCells(registry);
    const { registerMindCells } = await import('@sue/board-mind');
    const { registerArchitectureCells } =
      await import('@sue/board-architecture');
    registerMindCells(registry);
    registerArchitectureCells(registry);
    const adapter = memory(source);
    const snapshot = await migrateLegacyCellWorkspace(adapter, registry);
    const cells = Object.values(snapshot.store.cells);
    expect(cells.filter((cell) => cell.kind === 'mind-root')).toHaveLength(2);
    expect(cells.filter((cell) => cell.kind === 'mind-child')).toHaveLength(2);
    expect(
      cells.filter((cell) => cell.kind === 'architecture-layer'),
    ).toHaveLength(4);
    expect(
      cells.filter((cell) => cell.kind === 'architecture-edge'),
    ).toHaveLength(1);
    expect(cells.filter((cell) => cell.kind === 'workflow-start')).toHaveLength(
      2,
    );
    expect(cells.filter((cell) => cell.kind === 'workflow-edge')).toHaveLength(
      3,
    );
    expect(snapshot.detachedFrameIds).toHaveLength(2);
    expect(snapshot.store.cells[snapshot.store.rootId]).toMatchObject({
      view: {
        theme: source.main_board_content.theme,
      },
    });
    expect(
      cells.find(
        (cell) =>
          cell.kind === 'architecture-module' &&
          (cell as NodeCell).content?.label === 'API',
      ),
    ).toMatchObject({
      geometry: { x: 80, y: 100, derived: false },
      data: { placed: true },
    });
    expect(adapter.values.get(MIGRATION_BACKUP_KEY)).toEqual(source);
    expect(await loadCellWorkspace(adapter, registry)).toEqual(snapshot);
    expect(await migrateLegacyCellWorkspace(adapter, registry)).toEqual(
      snapshot,
    );
  });
  it('preserves legacy mind style, branches, media and manual width at the private migration boundary', async () => {
    const source = JSON.parse(
      readFileSync(
        '../../../tests/fixtures/legacy/mind-style-media.json',
        'utf8',
      ),
    );
    const adapter = memory({ main_board_content: source });
    const migrated = await migrateLegacyCellWorkspace(adapter);
    const topic = Object.values(migrated.store.cells).find(
      (cell) => cell.kind === 'mind-child',
    ) as NodeCell;
    expect(topic).toMatchObject({
      geometry: { outline: 'underline', width: 236 },
      content: { label: 'Styled topic' },
      appearance: {
        fill: '#ffeeaa',
        strokeColor: '#aa0000',
        strokeWidth: 4,
        strokeStyle: 'dotted',
      },
      data: {
        layout: 'upward',
        manualWidth: 220,
        branchShape: 'polyline',
        branchAppearance: { strokeColor: '#008800', strokeWidth: 5 },
        note: { plainText: 'Preserved note' },
        emojis: [{ name: '🚀' }],
        image: { width: 64, height: 32 },
      },
    });
    expect(topic.data).not.toHaveProperty('element');
    expect(await migrateLegacyCellWorkspace(adapter)).toEqual(migrated);
  });

  it('materializes legacy swimlane title spans, preserves text, fill and fixed headings', async () => {
    const registry = createCellRegistry();
    registerDrawCells(registry);
    for (const vertical of [false, true]) {
      const rows = vertical
        ? [
            { id: 'title', height: 42 },
            { id: 'lane', height: 42 },
            { id: 'body' },
          ]
        : [{ id: 'a' }, { id: 'b' }];
      const columns = vertical
        ? [{ id: 'a' }, { id: 'b' }]
        : [
            { id: 'title', width: 42 },
            { id: 'lane', width: 42 },
            { id: 'body' },
          ];
      const cells = [
        {
          id: 'heading',
          rowId: rows[0].id,
          columnId: columns[0].id,
          text: 'Title',
          fill: '#abcdef',
        },
        ...['a', 'b'].flatMap((id) =>
          vertical
            ? [
                { id: `lane-${id}`, rowId: 'lane', columnId: id, text: 'Lane' },
                { id: `body-${id}`, rowId: 'body', columnId: id },
              ]
            : [
                { id: `lane-${id}`, rowId: id, columnId: 'lane', text: 'Lane' },
                { id: `body-${id}`, rowId: id, columnId: 'body' },
              ],
        ),
      ];
      const adapter = memory({
        main_board_content: {
          children: [
            {
              id: 'swimlane',
              type: 'swimlane',
              shape: vertical ? 'swimlaneVertical' : 'swimlaneHorizontal',
              header: true,
              rows,
              columns,
              cells,
              points: [
                [0, 0],
                [500, 400],
              ],
            },
          ],
        },
      });
      const snapshot = await migrateLegacyCellWorkspace(adapter, registry);
      const lane = Object.values(snapshot.store.cells).find(
        (cell) => cell.kind === 'swimlane',
      ) as NodeCell<TableCellData>;
      expect(validateTableData(lane)).toBeUndefined();
      expect(lane.data!.cells[0]).toMatchObject({
        fill: '#abcdef',
        text: { kind: 'block', plainText: 'Title' },
        [vertical ? 'colspan' : 'rowspan']: 2,
        role: 'title',
      });
      expect(
        (vertical ? tableGrid(lane).rows : tableGrid(lane).columns).slice(0, 2),
      ).toEqual([42, 42]);
      expect(await loadCellWorkspace(adapter, registry)).toEqual(snapshot);
      expect(await migrateLegacyCellWorkspace(adapter, registry)).toEqual(
        snapshot,
      );
    }
  });

  it('preserves legacy vector line points, closure, curve style and rotation', async () => {
    const registry = createCellRegistry();
    registerDrawCells(registry);
    const points = [
      [10, 20],
      [120, 20],
      [120, 100],
      [10, 20],
    ];
    const adapter = memory({
      main_board_content: {
        children: [
          {
            id: 'line',
            type: 'vector-line',
            shape: 'curve',
            points,
            fill: '#abcdef',
            strokeStyle: 'dashed',
            strokeWidth: 4,
            opacity: 0.5,
            angle: Math.PI / 4,
          },
        ],
      },
    });
    const snapshot = await migrateLegacyCellWorkspace(adapter, registry);
    const line = Object.values(snapshot.store.cells).find(
      (cell) => cell.kind === 'vector-line',
    ) as NodeCell<VectorLineData>;
    expect(pathNodePoints(line)).toEqual(points);
    expect(line).toMatchObject({
      geometry: { rotation: Math.PI / 4 },
      appearance: {
        fill: '#abcdef',
        strokeStyle: 'dashed',
        strokeWidth: 4,
        opacity: 0.5,
      },
      data: { shape: 'curve' },
    });
    expect(await loadCellWorkspace(adapter, registry)).toEqual(snapshot);
  });
  it('normalizes the known transitional vector line shape at the migration boundary', async () => {
    const registry = createCellRegistry();
    registerDrawCells(registry);
    const store = createCellStore(createFrameCell('root'));
    store.cells.line = {
      id: 'line',
      kind: 'vector-line',
      cellType: 'node',
      geometry: { x: 10, y: 20, width: 100, height: 80 },
      data: {
        shape: 'feltTipPen',
        points: [
          [0, 0],
          [100, 80],
        ],
      },
    };
    (store.cells.root as import('@sue/board-core').FrameCell).children = [
      'line',
    ];
    const snapshot = await migrateLegacyCellWorkspace(
      memory({
        main_board_content: { format: 'verd-cells', version: 1, store },
      }),
      registry,
    );
    expect(snapshot.store.cells.line).toMatchObject({
      data: {
        shape: 'straight',
        points: [
          [0, 0],
          [100, 80],
        ],
      },
    });
  });
  it('preserves arrow bindings, curves, markers and positioned rich labels', async () => {
    const adapter = memory({
      main_board_content: {
        children: [
          {
            id: 'a',
            type: 'geometry',
            shape: 'rectangle',
            points: [
              [10, 20],
              [110, 70],
            ],
            angle: Math.PI / 2,
          },
          {
            id: 'b',
            type: 'geometry',
            shape: 'ellipse',
            points: [
              [200, 100],
              [300, 180],
            ],
          },
          {
            id: 'e',
            type: 'arrow-line',
            shape: 'curve',
            points: [
              [110, 45],
              [150, 90],
              [200, 140],
            ],
            source: { boundId: 'a', connection: [1, 0.5], marker: 'none' },
            target: {
              boundId: 'b',
              connection: [0, 0.5],
              marker: 'hollow-triangle',
            },
            texts: [
              { position: 0.25, text: 'First' },
              { position: 0.75, text: 'Second' },
            ],
          },
        ],
      },
    });
    const result = await migrateLegacyCellWorkspace(adapter);
    const edge = Object.values(result.store.cells).find((cell) =>
      isEdgeCell(cell),
    )!;
    if (!isEdgeCell(edge)) throw new Error('Missing migrated arrow');
    expect(edge.route.mode).toBe('curve');
    expect(edge.source).toMatchObject({ anchor: [1, 0.5] });
    expect(edge.target).toMatchObject({ anchor: [0, 0.5] });
    expect(edge.data).toMatchObject({
      sourceMarker: 'none',
      targetMarker: 'hollow-triangle',
    });
    expect(edge.labels?.map((label) => [label.text, label.position])).toEqual([
      ['First', 0.25],
      ['Second', 0.75],
    ]);
    expect(edge.labels?.[0].richText).toMatchObject({
      schemaVersion: 1,
      plainText: 'First',
    });
    if (!('cellId' in edge.source)) throw new Error('Missing binding');
    const node = result.store.cells[edge.source.cellId];
    if (!('geometry' in node)) throw new Error('Missing geometry');
    const point = relativeAnchor(node.geometry, edge.source.anchor!);
    expect(point[0]).toBeCloseTo(60);
    expect(point[1]).toBeCloseTo(95);
    expect(await migrateLegacyCellWorkspace(adapter)).toEqual(result);
  });
  it('normalizes legacy workflow in/out ports at the migration boundary', async () => {
    const document = createDefaultWorkflowDocument();
    document.nodes = [{ key: 'task', kind: 'task', label: 'Task' }];
    document.edges = [
      {
        key: 'edge',
        source: { nodeKey: '__start__', portId: 'out' },
        target: { nodeKey: 'task', portId: 'in' },
      },
    ];
    const registry = createCellRegistry();
    registerWorkflowCells(registry);
    const snapshot = await migrateLegacyCellWorkspace(
      memory({ main_workflow_content: document }),
      registry,
    );
    const edge = Object.values(snapshot.store.cells).find((cell) =>
      isEdgeCell(cell),
    );
    expect(edge).toMatchObject({
      source: { portId: 'right' },
      target: { portId: 'left' },
    });
  });
  it('accepts the original drawnix elements envelope', async () => {
    const fixture = JSON.parse(
      readFileSync('../../../tests/fixtures/legacy/drawnix-v1.json', 'utf8'),
    );
    const result = await migrateLegacyCellWorkspace(
      memory({ main_board_content: fixture }),
    );
    expect(
      Object.values(result.store.cells).some(
        (cell) => cell.kind === 'mind-child',
      ),
    ).toBe(true);
  });
  it('preserves independent frames in a current native envelope', async () => {
    const store = createCellStore(createFrameCell('root'));
    store.cells.orphan = createFrameCell('orphan');
    const result = await migrateLegacyCellWorkspace(
      memory({
        main_board_content: { format: 'verd-cells', version: 1, store },
      }),
    );
    expect(result.detachedFrameIds).toEqual(['orphan']);
  });
  it('separates workflow node, edge and root ids even when old keys collide', async () => {
    const doc = createDefaultWorkflowDocument();
    doc.nodes = [{ key: 'workflow-root', kind: 'task', label: 'Task' }];
    doc.edges = [
      {
        key: 'workflow-root',
        source: { nodeKey: '__start__', portId: 'right' },
        target: { nodeKey: 'workflow-root', portId: 'left' },
      },
    ];
    const result = await migrateLegacyCellWorkspace(
      memory({ main_workflow_content: doc }),
    );
    const cells = Object.values(result.store.cells);
    expect(cells.filter((cell) => cell.kind === 'workflow-task')).toHaveLength(
      1,
    );
    expect(cells.filter((cell) => cell.kind === 'workflow-edge')).toHaveLength(
      1,
    );
    expect(new Set(cells.map((cell) => cell.id)).size).toBe(cells.length);
  });
  it('migrates a legacy inline mind without retaining old node payloads', async () => {
    const fixture = JSON.parse(
      readFileSync('../../../tests/fixtures/legacy/drawnix-v1.json', 'utf8'),
    );
    const adapter = memory({
      main_board_content: {
        children: fixture.elements,
        viewport: fixture.viewport,
      },
    });
    const result = await migrateLegacyCellWorkspace(adapter);
    expect(
      Object.values(result.store.cells).some(
        (cell) => cell.kind === 'mind-root',
      ),
    ).toBe(true);
    expect(
      Object.values(result.store.cells).some(
        (cell) =>
          cell.kind === 'mind-child' &&
          'content' in cell &&
          cell.content?.label === 'Legacy topic',
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('boardElement');
    expect(JSON.stringify(result)).not.toContain('"element":');
    expect(adapter.values.get(MIGRATION_BACKUP_KEY)).toBeTruthy();
    expect(await migrateLegacyCellWorkspace(adapter)).toEqual(result);
  });
  it('clones shared workflow documents and retains detached documents', async () => {
    const doc = createDefaultWorkflowDocument();
    const adapter = memory({
      main_board_content: {
        children: [
          {
            id: 'one',
            type: 'workflow',
            documentId: 'shared',
            points: [
              [0, 0],
              [300, 200],
            ],
          },
          {
            id: 'two',
            type: 'workflow',
            documentId: 'shared',
            points: [
              [400, 0],
              [700, 200],
            ],
          },
        ],
      },
      main_workflow_registry: {
        activeId: 'shared',
        documents: { shared: doc, orphan: doc },
      },
    });
    const result = await migrateLegacyCellWorkspace(adapter);
    expect(
      Object.values(result.store.cells).filter(
        (cell) => cell.kind === 'workflow-start',
      ),
    ).toHaveLength(3);
    expect(result.detachedFrameIds).toHaveLength(1);
    expect(await loadCellWorkspace(adapter)).toEqual(result);
  });
  it('retains the source when a referenced legacy document is missing', async () => {
    const source = {
      children: [{ id: 'missing', type: 'architecture', documentId: 'absent' }],
    };
    const adapter = memory({ main_board_content: source });
    await expect(migrateLegacyCellWorkspace(adapter)).rejects.toThrow(
      'Missing',
    );
    expect(adapter.values.get('main_board_content')).toEqual(source);
  });
  it('keeps zero styles and group relations instead of group pseudo-nodes', async () => {
    const adapter = memory({
      main_board_content: {
        children: [
          {
            id: 'a',
            type: 'geometry',
            shape: 'rectangle',
            points: [
              [0, 0],
              [40, 20],
            ],
            opacity: 0,
            fill: '',
            strokeWidth: 0,
            groupId: 'g',
          },
          {
            id: 'b',
            type: 'geometry',
            shape: 'rectangle',
            points: [
              [50, 0],
              [90, 20],
            ],
            groupId: 'g',
          },
          {
            id: 'g',
            type: 'group',
            points: [
              [0, 0],
              [0, 0],
            ],
          },
        ],
      },
    });
    const result = await migrateLegacyCellWorkspace(adapter);
    expect(
      Object.values(result.store.cells).some(
        (cell) => cell.kind === 'group' && cell.cellType === 'node',
      ),
    ).toBe(false);
    const group = Object.values(result.store.cells).find(isGroupCell);
    expect(group?.members).toHaveLength(2);
    expect(
      Object.values(result.store.cells).some(
        (cell) =>
          isNodeCell(cell) &&
          cell.appearance?.opacity === 0 &&
          cell.appearance.fill === '' &&
          cell.appearance.strokeWidth === 0,
      ),
    ).toBe(true);
  });
  it('upgrades a valid v1 workspace once and can reset when a record is gone', async () => {
    const adapter = memory({ main_board_content: { children: [] } });
    const first = await migrateLegacyCellWorkspace(adapter);
    const manifest = adapter.values.get('main_board_content') as {
      version: number;
      frames: Record<string, string>;
    };
    manifest.version = 1;
    const again = await migrateLegacyCellWorkspace(adapter);
    expect(
      (again.store.cells['board-root'] as { children: string[] }).children,
    ).toEqual([]);
    expect(
      (adapter.values.get('main_board_content') as { version: number }).version,
    ).toBe(2);
    const third = await migrateLegacyCellWorkspace(adapter);
    expect(third.store.cells['board-root']).toMatchObject({ children: [] });
    const current = adapter.values.get('main_board_content') as {
      version: number;
      frames: Record<string, string>;
    };
    current.version = 1;
    adapter.values.delete('legacy_workspace_backup');
    adapter.values.delete(Object.values(current.frames)[0]);
    await expect(migrateLegacyCellWorkspace(adapter)).rejects.toThrow(
      'Reset the test workspace',
    );
  });
  it('keeps legal zero shell appearance and fills only a missing view field', async () => {
    const shell = await migrateLegacyCellWorkspace(
      memory({
        main_board_content: {
          children: [
            {
              id: 'center',
              type: 'mind',
              children: [],
              data: { label: 'Center' },
              points: [
                [0, 0],
                [120, 60],
              ],
              backgroundColor: '#111111',
              opacity: 1,
              borderWidth: 4,
              frame: {
                appearance: {
                  fill: '',
                  strokeColor: '#000000',
                  strokeWidth: 0,
                  strokeStyle: 'solid',
                  shadow: 'none',
                  opacity: 0,
                },
                aspectRatio: 0,
              },
            },
          ],
        },
      }),
    );
    const frame = Object.values(shell.store.cells).find(
      (cell) => cell.kind === 'frame' && cell.id !== shell.store.rootId,
    );
    expect(frame).toMatchObject({
      aspectRatio: 0,
      appearance: {
        fill: '',
        strokeWidth: 0,
        opacity: 0,
      },
    });
    const store = createCellStore(createFrameCell('root'));
    store.cells.root = {
      ...store.cells.root,
      view: { viewport: { zoom: 2, origination: [0, 0] } },
    };
    const partial = await migrateLegacyCellWorkspace(
      memory({
        main_board_content: {
          format: 'verd-cells',
          version: 1,
          store,
          viewport: { zoom: 9, origination: [1, 1] },
          theme: { themeColorMode: 'dark' },
        },
      }),
    );
    expect(partial.store.cells.root).toMatchObject({
      view: {
        theme: { themeColorMode: 'dark' },
      },
    });
  });
  it('rebuilds a broken v1 record from its backup and leaves a later launch alone', async () => {
    const adapter = memory({
      main_board_content: {
        children: [
          {
            id: 'kept',
            type: 'geometry',
            shape: 'rectangle',
            points: [
              [0, 0],
              [40, 20],
            ],
          },
        ],
      },
    });
    const first = await migrateLegacyCellWorkspace(adapter);
    const backup = structuredClone(adapter.values.get(MIGRATION_BACKUP_KEY));
    const manifest = adapter.values.get('main_board_content') as {
      version: number;
      frames: Record<string, string>;
    };
    manifest.version = 1;
    adapter.values.set(Object.values(manifest.frames)[0], {
      format: 'verd-frame',
      version: 1,
      broken: true,
    });
    const rebuilt = await migrateLegacyCellWorkspace(adapter);
    expect(
      Object.values(rebuilt.store.cells).some(
        (cell) => isNodeCell(cell) && cell.id.includes('kept'),
      ),
    ).toBe(true);
    expect(adapter.values.get(MIGRATION_BACKUP_KEY)).toEqual(backup);
    const again = await migrateLegacyCellWorkspace(adapter);
    expect(again).toEqual(rebuilt);
    expect(adapter.values.get(MIGRATION_BACKUP_KEY)).toEqual(backup);
    expect(first.store.rootId).toBe(rebuilt.store.rootId);
  });
  it('upgrades valid v1 data when no backup exists', async () => {
    const adapter = memory({ main_board_content: { children: [] } });
    const first = await migrateLegacyCellWorkspace(adapter);
    adapter.values.delete(MIGRATION_BACKUP_KEY);
    const live = adapter.values.get('main_board_content') as {
      version: number;
    };
    live.version = 1;
    const again = await migrateLegacyCellWorkspace(adapter);
    expect(
      (again.store.cells['board-root'] as { children: string[] }).children,
    ).toEqual(
      (first.store.cells['board-root'] as { children: string[] }).children,
    );
    expect(
      (adapter.values.get('main_board_content') as { version: number }).version,
    ).toBe(2);
    expect(adapter.values.has(MIGRATION_BACKUP_KEY)).toBe(false);
    const second = await migrateLegacyCellWorkspace(adapter);
    expect(second.store).toEqual(again.store);
  });
});
