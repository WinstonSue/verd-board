import { registerWorkflowCells } from '@sue/board-workflow';
import type { CellRegistry } from '@sue/board-core';
import type { FrameRenderExtension } from '@sue/board-react';
export const createWorkflowFrameExtensions = (
  registry: CellRegistry,
): FrameRenderExtension[] => {
  registerWorkflowCells(registry);
  return [];
};
