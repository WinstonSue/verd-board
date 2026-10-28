import { createFramePluginSet } from '@sue/board-react';
import { createArchitectureUIPlugin } from '@sue/board-react-architecture';
import { createDrawUIPlugin } from '@sue/board-react-draw';
import {
  createMindUIPlugin,
  type MindUIPluginOptions,
} from '@sue/board-react-mind';
import { createUmlUIPlugin } from '@sue/board-react-uml';
import { createWorkflowUIPlugin } from '@sue/board-react-workflow';
export const createVerdFramePlugins = (
  options: { mind?: MindUIPluginOptions } = {},
) => [
  createDrawUIPlugin(),
  createMindUIPlugin(options.mind),
  createWorkflowUIPlugin(),
  createArchitectureUIPlugin(),
  createUmlUIPlugin(),
];
export const createVerdFramePluginSet = (
  options: { mind?: MindUIPluginOptions } = {},
) => createFramePluginSet(createVerdFramePlugins(options));
