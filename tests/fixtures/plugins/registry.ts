import { createArchitecturePlugin } from '../../../packages/engine/architecture/src/public-api';
import { createCellRegistry } from '../../../packages/engine/core/src/public-api';
import { createDrawPlugin } from '../../../packages/engine/draw/src/public-api';
import { createMindPlugin } from '../../../packages/engine/mind/src/public-api';
import { createUmlPlugin } from '../../../packages/engine/uml/src/public-api';
import { createWorkflowPlugin } from '../../../packages/engine/workflow/src/public-api';
export const createTestCellRegistry = () =>
  createCellRegistry({
    plugins: [
      createDrawPlugin(),
      createMindPlugin(),
      createWorkflowPlugin(),
      createArchitecturePlugin(),
      createUmlPlugin(),
    ],
  });
