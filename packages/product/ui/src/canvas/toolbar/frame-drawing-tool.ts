import { createArchitectureFrameSnapshot } from '@sue/board-architecture';
import { createMindFrameSnapshot } from '@sue/board-mind';
import { createFrameDrawingTool as createDrawingTool } from '@sue/board-react-draw';
import {
  createUmlClassFrameSnapshot,
  createUmlSequenceFrameSnapshot,
} from '@sue/board-uml';
import { createWorkflowFrameSnapshot } from '@sue/board-workflow';
export const createFrameDrawingTool = (
  options: Parameters<typeof createDrawingTool>[0],
) =>
  createDrawingTool({
    ...options,
    frameFactories: {
      mind: createMindFrameSnapshot,
      workflow: createWorkflowFrameSnapshot,
      architecture: createArchitectureFrameSnapshot,
      'uml-class': createUmlClassFrameSnapshot,
      'uml-sequence': createUmlSequenceFrameSnapshot,
    },
  });
