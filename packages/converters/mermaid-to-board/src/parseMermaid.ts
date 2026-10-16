import mermaid, { MermaidConfig } from 'mermaid';
import { GraphImage } from './interfaces.js';
import { MERMAID_CONFIG } from './constants.js';
import { encodeEntities } from './utils.js';
import { Flowchart, parseMermaidFlowChartDiagram } from './parser/flowchart.js';
import { Sequence, parseMermaidSequenceDiagram } from './parser/sequence.js';
import { Class, parseMermaidClassDiagram } from './parser/class.js';

// Fallback to Svg
const convertSvgToGraphImage = (svgContainer: HTMLDivElement) => {
  // Extract SVG width and height
  // TODO: make width and height change dynamically based on user's screen dimension
  const svgEl = svgContainer.querySelector('svg');
  if (!svgEl) {
    throw new Error('SVG element not found');
  }
  const rect = svgEl.getBoundingClientRect();
  const box = (svgEl.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[ ,]+/)
    .map(Number);
  const bounds = svgEl.getBBox();
  const positive = (value: number) => Number.isFinite(value) && value > 0;
  const width = [rect.width, box[2], bounds.width].find(positive);
  const height = [rect.height, box[3], bounds.height].find(positive);
  if (width === undefined || height === undefined)
    throw new Error('Mermaid image has no usable dimensions');

  // Set width and height explictly since in firefox it gets set to 0
  // if the width and height are not expilcitly set
  // eg in some cases like er Diagram, gnatt, width and height is set as 100%
  // which sets the dimensions as 0 in firefox and thus the diagram isn't rendered
  svgEl.setAttribute('width', `${width}`);
  svgEl.setAttribute('height', `${height}`);

  // Convert SVG to image
  const mimeType = 'image/svg+xml';
  const decoded = unescape(encodeURIComponent(svgEl.outerHTML));
  const base64 = btoa(decoded);
  const dataURL = `data:image/svg+xml;base64,${base64}`;

  const graphImage: GraphImage = {
    type: 'graphImage',
    mimeType,
    dataURL,
    width,
    height,
  };

  return graphImage;
};

let sequence = 0;
const parseMermaidInternal = async (
  definition: string,
  config: MermaidConfig = MERMAID_CONFIG,
): Promise<Flowchart | GraphImage | Sequence | Class> => {
  mermaid.initialize({ ...MERMAID_CONFIG, ...config });
  // Parse the diagram
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(
    encodeEntities(definition),
  );

  // Render the SVG diagram
  const renderId = `verd-mermaid-${++sequence}`;
  let svgContainer: HTMLDivElement | undefined;
  try {
    const { svg } = await mermaid.render(renderId, definition);

    // Append Svg to DOM
    svgContainer = document.createElement('div');
    svgContainer.setAttribute(
      'style',
      `opacity: 0; position: absolute; top: 0; left: -100000px; pointer-events: none;`,
    );
    svgContainer.innerHTML = svg;
    svgContainer.id = `${renderId}-parsed`;
    document.body.appendChild(svgContainer);
    let data;
    switch (diagram.type) {
      case 'flowchart-v2': {
        data = parseMermaidFlowChartDiagram(diagram, svgContainer);
        break;
      }

      case 'sequence': {
        data = parseMermaidSequenceDiagram(diagram, svgContainer);

        break;
      }

      case 'classDiagram': {
        data = parseMermaidClassDiagram(diagram, svgContainer);
        break;
      }
      // fallback to image if diagram type not-supported
      default: {
        data = convertSvgToGraphImage(svgContainer);
      }
    }
    return data;
  } finally {
    svgContainer?.remove();
    document.getElementById(renderId)?.remove();
    document.getElementById(`d${renderId}`)?.remove();
  }
};

// Mermaid shares parser state and rendering DOM between diagrams. Keep each
// import together, and allow the next import to proceed after a rejected one.
let parseQueue: Promise<void> = Promise.resolve();
export const parseMermaid = (
  definition: string,
  config: MermaidConfig = MERMAID_CONFIG,
): Promise<Flowchart | GraphImage | Sequence | Class> => {
  const result = parseQueue.then(() =>
    parseMermaidInternal(definition, config),
  );
  parseQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};
