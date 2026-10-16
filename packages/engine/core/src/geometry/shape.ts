import type { RectangleClient } from '../interfaces/rectangle-client';

export type NodeOutlineKind =
  | 'rectangle'
  | 'roundRectangle'
  | 'ellipse'
  | 'diamond'
  | 'terminal'
  | 'store'
  | (string & {});

export type NodeOutline =
  NodeOutlineKind | { kind: NodeOutlineKind; radius?: number };

export type NodeShapeSpec =
  | { kind: 'polygon'; points: string }
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      rx: number;
      ry: number;
    };

const diamondPoints = (rectangle: RectangleClient) => {
  const midX = rectangle.x + rectangle.width / 2;
  const midY = rectangle.y + rectangle.height / 2;
  return [
    `${midX},${rectangle.y}`,
    `${rectangle.x + rectangle.width},${midY}`,
    `${midX},${rectangle.y + rectangle.height}`,
    `${rectangle.x},${midY}`,
  ].join(' ');
};

/** 把节点轮廓换成可直接画的矩形或多边形。store 的底线由调用方另画。 */
export const nodeShapeSpec = (
  outline: NodeOutline,
  rectangle: RectangleClient,
): NodeShapeSpec => {
  const customRadius = typeof outline === 'object' ? outline.radius : undefined;
  outline = typeof outline === 'object' ? outline.kind : outline;
  if (outline === 'diamond') {
    return { kind: 'polygon', points: diamondPoints(rectangle) };
  }
  const radius =
    outline === 'terminal' || outline === 'ellipse'
      ? Math.min(rectangle.width, rectangle.height) / 2
      : outline === 'roundRectangle'
        ? Math.min(rectangle.width, rectangle.height) * 0.1
        : outline === 'store'
          ? 6
          : 0;
  return {
    kind: 'rect',
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height,
    rx: customRadius ?? radius,
    ry: customRadius ?? radius,
  };
};
