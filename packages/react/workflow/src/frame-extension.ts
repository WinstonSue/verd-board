import { resolveThemeRole, type CellRegistry } from '@sue/board-core';
import type {
  FrameRenderExtension,
  FrameThemeAppearanceContext,
} from '@sue/board-react';

const workflowNodeTone = ({ cell, theme }: FrameThemeAppearanceContext) =>
  cell.kind === 'workflow-start'
    ? resolveThemeRole(theme, 'secondary', 'strong')
    : cell.kind === 'workflow-decision'
      ? resolveThemeRole(theme, 'tertiary')
      : resolveThemeRole(theme, 'primary');

const workflowThemeAppearance = (context: FrameThemeAppearanceContext) => {
  const { cell, store, theme } = context;
  if (cell.cellType !== 'edge') return workflowNodeTone(context);
  const source =
    'cellId' in cell.source ? store.cells[cell.source.cellId] : undefined;
  return {
    strokeColor: source
      ? workflowNodeTone({ ...context, cell: source }).strokeColor
      : resolveThemeRole(theme, 'neutral').strokeColor,
  };
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
