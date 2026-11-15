import { createArchitecturePlugin } from '@sue/board-architecture';
import { createCellRegistry } from '@sue/board-core';
import { createDrawPlugin } from '@sue/board-draw';
import { createMindPlugin } from '@sue/board-mind';
import { createUmlPlugin } from '@sue/board-uml';
import { createWorkflowPlugin } from '@sue/board-workflow';
import { mapStandardCellLinks, remapWorkspaceLink } from '@sue/board-common';
/** Full-product default only; callers can supply a deliberately smaller registry. */
export const createWorkspaceCellRegistry = () =>
  createCellRegistry({
    links: {
      rewriteHref: remapWorkspaceLink,
      mapStandard: mapStandardCellLinks,
    },
    plugins: [
      createDrawPlugin(),
      createMindPlugin(),
      createWorkflowPlugin(),
      createArchitecturePlugin(),
      createUmlPlugin(),
    ],
  });
