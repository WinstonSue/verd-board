import { type CellRegistry } from '@sue/board-core';
import {
  frameThemeAppearance,
  type FrameRenderExtension,
  type FrameThemeAppearanceContext,
} from '@sue/board-react';

const workflowNodeTone = (context: FrameThemeAppearanceContext) =>
  frameThemeAppearance(
    context,
    context.cell.kind === 'workflow-start'
      ? 'secondary'
      : context.cell.kind === 'workflow-decision'
        ? 'tertiary'
        : 'neutral',
    context.cell.kind === 'workflow-task' ? 'node' : 'emphasis',
  );

const workflowThemeAppearance = (context: FrameThemeAppearanceContext) => {
  const { cell, store } = context;
  if (cell.cellType !== 'edge') return workflowNodeTone(context);
  const source =
    'cellId' in cell.source ? store.cells[cell.source.cellId] : undefined;
  const tone = source
    ? workflowNodeTone({ ...context, cell: source })
    : frameThemeAppearance(context, 'neutral');
  return { ...tone, fill: 'none' };
};
export const createWorkflowFrameExtensions = (
  registry: CellRegistry,
): FrameRenderExtension[] => {
  if (!registry.plugins.some((plugin) => plugin.id === 'workflow'))
    throw new Error(
      'Install createWorkflowPlugin() through createCellRegistry before creating render extensions',
    );
  return [
    'workflow-start',
    'workflow-task',
    'workflow-decision',
    'workflow-edge',
  ].map((kind) => ({ kind, themeAppearance: workflowThemeAppearance }));
};
