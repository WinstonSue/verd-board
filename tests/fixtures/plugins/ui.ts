import { createArchitectureUIPlugin } from '../../../packages/react/architecture/src/index';
import { createFramePluginSet } from '../../../packages/react/board/src/index';
import { createDrawUIPlugin } from '../../../packages/react/draw/src/index';
import { createMindUIPlugin } from '../../../packages/react/mind/src/index';
import { createUmlUIPlugin } from '../../../packages/react/uml/src/index';
import { createWorkflowUIPlugin } from '../../../packages/react/workflow/src/index';
export const createTestFramePluginSet = () =>
  createFramePluginSet([
    createDrawUIPlugin(),
    createMindUIPlugin(),
    createWorkflowUIPlugin(),
    createArchitectureUIPlugin(),
    createUmlUIPlugin(),
  ]);
