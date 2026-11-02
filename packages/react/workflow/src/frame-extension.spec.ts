import {
  createCellRegistry,
  createFrameCell,
  resolveBoardTheme,
  resolveThemeRole,
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
        resolveThemeRole(theme, 'secondary', 'strong'),
      );
      expect(visual('task')).toMatchObject(resolveThemeRole(theme, 'primary'));
      expect(visual('decision')).toMatchObject({
        fill: '#ffffff',
        strokeColor: '#aabbcc',
      });
      expect(visual('edge').strokeColor).toBe(
        resolveThemeRole(theme, 'tertiary').strokeColor,
      );
      expect(visual('loop').strokeColor).toBe(
        resolveThemeRole(theme, 'primary').strokeColor,
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
