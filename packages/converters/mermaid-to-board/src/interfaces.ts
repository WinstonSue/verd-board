export enum VERTEX_TYPE {
  ROUND = 'round',
  STADIUM = 'stadium',
  DOUBLECIRCLE = 'doublecircle',
  CIRCLE = 'circle',
  DIAMOND = 'diamond',
}
export enum LABEL_STYLE_PROPERTY {
  COLOR = 'color',
}
export enum CONTAINER_STYLE_PROPERTY {
  FILL = 'fill',
  STROKE = 'stroke',
  STROKE_WIDTH = 'stroke-width',
  STROKE_DASHARRAY = 'stroke-dasharray',
}
/** Explicit Mermaid declarations, excluding renderer/theme defaults. */
export interface AuthoredStyle {
  fill?: string;
  stroke?: string;
  color?: string;
  'stroke-width'?: string;
  'stroke-dasharray'?: string;
}
export interface Vertex {
  authoredStyle?: AuthoredStyle;
  id: string;
  type: VERTEX_TYPE;
  labelType: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  link?: string;
  containerStyle: { [key in CONTAINER_STYLE_PROPERTY]?: string };
  labelStyle: { [key in LABEL_STYLE_PROPERTY]?: string };
}

export interface SubGraph {
  authoredStyle?: AuthoredStyle;
  id: string;
  nodeIds: string[];
  text: string;
  labelType: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Position {
  x: number;
  y: number;
}

export interface GraphImage {
  type: 'graphImage';
  mimeType: string;
  dataURL: string;
  width: number;
  height: number;
}
