import type { CellRegistry } from '@sue/board-core';
import type { FrameRenderExtension } from '@sue/board-react';
export const createWorkflowFrameExtensions = (
  registry: CellRegistry,
): FrameRenderExtension[] => {
  if (!registry.plugins.some((plugin) => plugin.id === 'workflow'))
    throw new Error(
      'Install createWorkflowPlugin() through createCellRegistry before creating render extensions',
    );
  return [];
};
