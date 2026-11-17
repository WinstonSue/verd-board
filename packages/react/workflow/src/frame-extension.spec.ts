import {
  createCellRegistry,
  createFrameCell,
  resolveBoardTheme,
  resolveThemeRole,
  resolveThemeSeries,
  ThemeColorMode,
  type CellStore,
  type EdgeCell,
} from '@sue/board-core';
import { resolveFrameCellAppearance } from '@sue/board-react';
import {
  createWorkflowPlugin,
  createWorkflowStartCell,
  createWorkflowTaskCell,
} from '@sue/board-workflow';
import { expect, it } from 'vitest';
import { createWorkflowFrameExtensions } from './frame-extension';

it('uses role defaults in cyclic workflows and keeps edge colors independent of source edits', () => {
  const registry = createCellRegistry({ plugins: [createWorkflowPlugin()] });
  const extensions = createWorkflowFrameExtensions(registry);
  const frame = createFrameCell('frame');
  frame.children = ['start', 'task', 'decision', 'edge', 'loop'];
  const start = createWorkflowStartCell('start');
  start.data!.memberIds = ['start', 'task', 'decision'];
  const task = createWorkflowTaskCell('task');
  const decision = createWorkflowTaskCell('decision', true);
  decision.appearance = {
    fill: '#ffffff',
    strokeColor: '#aabbcc',
    colorSources: { fill: 'custom', strokeColor: 'custom' },
  };
  const edge: EdgeCell = {
    id: 'edge',
    kind: 'workflow-edge',
    cellType: 'edge',
    source: { cellId: decision.id },
    target: { cellId: task.id },
    route: { mode: 'auto' },
  };
  const store: CellStore = {
    rootId: frame.id,
    cells: {
      frame,
      start,
      task,
      decision,
      edge,
      loop: {
        ...edge,
        id: 'loop',
        source: { cellId: task.id },
        target: { cellId: decision.id },
      },
    },
  };
  const original = JSON.stringify(store);
  for (const mode of Object.values(ThemeColorMode)) {
    for (const appearance of ['light', 'dark'] as const) {
      const theme = resolveBoardTheme({ themeColorMode: mode }, appearance);
      const visual = (id: string) =>
        resolveFrameCellAppearance(
          { cell: store.cells[id], store, frameId: frame.id, theme },
          extensions,
        );
      expect(visual('start')).toMatchObject(
        resolveThemeRole(theme, 'secondary', 'strong', 'overlay'),
      );
      expect(visual('task')).toMatchObject(
        resolveThemeRole(theme, 'neutral', 'node', 'overlay'),
      );
      expect(visual('decision')).toMatchObject({
        fill: '#ffffff',
        strokeColor: '#aabbcc',
      });
      expect(visual('edge').strokeColor).toBe(
        resolveThemeRole(theme, 'tertiary', 'emphasis', 'overlay').strokeColor,
      );
      expect(visual('loop').strokeColor).toBe(
        resolveThemeRole(theme, 'neutral', 'node', 'overlay').strokeColor,
      );
      expect(visual('task').fill).not.toBe(visual('start').fill);
    }
  }
  const theme = resolveBoardTheme();
  task.appearance = { fill: '#f00', strokeColor: '#0f0' };
  expect(
    resolveFrameCellAppearance(
      { cell: task, store, frameId: frame.id, theme },
      extensions,
    ),
  ).toMatchObject(task.appearance);
  delete task.appearance;
  expect(JSON.stringify(store)).toBe(original);
});

it('keeps a task-only chain neutral and permits an explicit family', () => {
  const registry = createCellRegistry({ plugins: [createWorkflowPlugin()] });
  const extensions = createWorkflowFrameExtensions(registry);
  const frame = createFrameCell('frame');
  const tasks = ['a', 'b', 'c', 'd'].map((id) => createWorkflowTaskCell(id));
  const edges: EdgeCell[] = tasks.slice(1).map((task, at) => ({
    id: `e${at}`,
    kind: 'workflow-edge',
    cellType: 'edge',
    source: { cellId: tasks[at].id },
    target: { cellId: task.id },
    route: { mode: 'auto' },
  }));
  frame.children = [...tasks, ...edges].map((cell) => cell.id);
  const store: CellStore = {
    rootId: frame.id,
    cells: Object.fromEntries(
      [frame, ...tasks, ...edges].map((cell) => [cell.id, cell]),
    ),
  };
  const theme = resolveBoardTheme(undefined, 'light');
  const visual = (cell: (typeof tasks)[number]) =>
    resolveFrameCellAppearance(
      { cell, store, frameId: frame.id, theme },
      extensions,
    );
  expect(new Set(tasks.map((cell) => visual(cell).fill)).size).toBe(1);
  tasks[1].appearance = { styleColor: 'series-4' };
  expect(visual(tasks[1]).fill).toBe(
    resolveThemeSeries(theme, 3, 'node', 'overlay').fill,
  );
  expect(visual(tasks[0]).fill).toBe(
    resolveThemeRole(theme, 'neutral', 'node', 'overlay').fill,
  );
  const edge = resolveFrameCellAppearance(
    { cell: edges[1], store, frameId: frame.id, theme },
    extensions,
  );
  expect(edge.styleFamily).toBe('series-4');
});
