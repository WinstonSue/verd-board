import { DEFAULT_FONT_SIZE } from './constants.js';
import { graphToFrameSnapshot } from './graph-to-frame.js';
import {
  flowchartToDomainFrame,
  type DomainFrameImportConfig,
} from './documents.js';
import { parseMermaid } from './parseMermaid.js';

export interface MermaidConfig {
  /**
   * Whether to start the diagram automatically when the page loads.
   * @default false
   */
  startOnLoad?: boolean;
  /**
   * The flowchart curve style.
   * @default "linear"
   */
  flowchart?: {
    curve?: 'linear' | 'basis';
  };
  /**
   * Theme variables
   * @default { fontSize: "25px" }
   */
  themeVariables?: {
    fontSize?: string;
  };
  /**
   * Maximum number of edges to be rendered.
   * @default 1000
   */
  maxEdges?: number;
  /**
   * Maximum number of characters to be rendered.
   * @default 1000
   */
  maxTextSize?: number;
}

export interface MermaidFrameImportConfig
  extends MermaidConfig, DomainFrameImportConfig {
  scene?: 'whiteboard' | 'workflow' | 'architecture';
}

export const parseMermaidToFrameSnapshot = async (
  definition: string,
  config?: MermaidFrameImportConfig,
) => {
  const mermaidConfig = config || {};
  const fontSize =
    parseInt(mermaidConfig.themeVariables?.fontSize ?? '') || DEFAULT_FONT_SIZE;
  const parsedMermaidData = await parseMermaid(definition, {
    ...mermaidConfig,
    themeVariables: {
      ...mermaidConfig.themeVariables,
      // Multiplying by 1.25 to increase the font size by 25% and render correctly in VerdBoard
      fontSize: `${fontSize * 1.25}px`,
    },
  });
  if (config?.scene && config.scene !== 'whiteboard') {
    if (parsedMermaidData.type !== 'flowchart')
      throw new Error('Domain Frames require a Mermaid flowchart');
    return flowchartToDomainFrame(
      parsedMermaidData,
      config.scene,
      definition,
      config,
    );
  }
  return graphToFrameSnapshot(parsedMermaidData, { fontSize });
};

export { graphToFrameSnapshot, parseMermaid };
export type { FrameImportConfig } from './graph-to-frame.js';
export {
  MERMAID_LOSSY_FIELDS,
  parseMermaidToArchitectureFrame,
  parseMermaidToWorkflowFrame,
  serializeFrameToMermaid,
} from './documents.js';
