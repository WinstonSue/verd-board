import type { Point } from '../interfaces/point';
import type { RectangleClient } from '../interfaces/rectangle-client';
import type { ShapeGeometry } from './registry';
import { pathGeometry, ShapePath } from './shape-path';

const textArea =
  (left = 0, top = 0, width = 1, height = 1) =>
  (b: RectangleClient): RectangleClient => ({
    x: b.x + b.width * left,
    y: b.y + b.height * top,
    width: b.width * width,
    height: b.height * height,
  });
const polygon = (points: Point[], text = textArea()) =>
  pathGeometry((b, p) => {
    points.forEach(([x, y], i) =>
      i
        ? p.line(b.x + x * b.width, b.y + y * b.height)
        : p.move(b.x + x * b.width, b.y + y * b.height),
    );
    p.close();
  }, text);
const roundRect = (p: ShapePath, b: RectangleClient, radius: number) => {
  const { x, y, width: w, height: h } = b,
    r = Math.max(0, Math.min(radius, w / 2, h / 2));
  p.move(x + r, y)
    .line(x + w - r, y)
    .arc(r, r, false, true, x + w, y + r)
    .line(x + w, y + h - r)
    .arc(r, r, false, true, x + w - r, y + h)
    .line(x + r, y + h)
    .arc(r, r, false, true, x, y + h - r)
    .line(x, y + r)
    .arc(r, r, false, true, x + r, y)
    .close();
};
const rectangle = pathGeometry((b, p) => p.rect(b.x, b.y, b.width, b.height));
const ellipse = pathGeometry(
  (b, p) =>
    p.ellipse(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, b.height / 2),
  textArea(0.15, 0.15, 0.7, 0.7),
);
const diamond = polygon(
  [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  textArea(0.25, 0.25, 0.5, 0.5),
);
const parallelogram = polygon(
  [
    [0.25, 0],
    [1, 0],
    [0.75, 1],
    [0, 1],
  ],
  textArea(0.25, 0, 0.5, 1),
);
const componentPath = (b: RectangleClient, p: ShapePath) => {
  const { x, y, width: w, height: h } = b;
  const left = x + Math.min(12, w / 5),
    bw = w > 70 ? 24 : w * 0.2,
    bh = h > 44 ? 14 : h * 0.175;
  const top = y + h * 0.175,
    bottom = y + h * 0.825 - bh;
  p.rect(left, y, x + w - left, h);
  p.rect(left - bw / 2, top, bw, bh).rect(left - bw / 2, bottom, bw, bh);
};
const curly = (left: boolean) =>
  pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      const side = left ? x + w : x,
        inward = left ? side - w * 0.09 : side + w * 0.09;
      p.move(side, y, false)
        .cubic(inward, y, side, y + h / 2, inward, y + h / 2)
        .cubic(side, y + h / 2, inward, y + h, side, y + h);
    },
    left ? textArea(0, 0, 0.88, 1) : textArea(0.12, 0, 0.88, 1),
  );

/** All existing whiteboard symbols use these native paths, text regions and hit contours. */
export const builtinShapeGeometries: Record<string, ShapeGeometry> = {
  underline: pathGeometry(({ x, y, width, height }, p) =>
    p.move(x, y + height, false).line(x + width, y + height),
  ),
  rectangle,
  text: rectangle,
  process: rectangle,
  simpleClass: rectangle,
  object: rectangle,
  port: rectangle,
  activation: rectangle,
  ellipse,
  connector: ellipse,
  useCase: ellipse,
  diamond,
  decision: diamond,
  branchMerge: diamond,
  parallelogram,
  data: parallelogram,
  triangle: polygon(
    [
      [0.5, 0],
      [1, 1],
      [0, 1],
    ],
    textArea(0.25, 0.5, 0.5, 0.5),
  ),
  trapezoid: polygon(
    [
      [0.15, 0],
      [0.85, 0],
      [1, 1],
      [0, 1],
    ],
    textArea(0.15, 0, 0.7, 1),
  ),
  leftArrow: polygon(
    [
      [0, 0.5],
      [0.32, 0],
      [0.32, 0.2],
      [1, 0.2],
      [1, 0.8],
      [0.32, 0.8],
      [0.32, 1],
    ],
    textArea(0.32, 0.2, 0.68, 0.6),
  ),
  rightArrow: polygon(
    [
      [0, 0.2],
      [0.68, 0.2],
      [0.68, 0],
      [1, 0.5],
      [0.68, 1],
      [0.68, 0.8],
      [0, 0.8],
    ],
    textArea(0, 0.2, 0.68, 0.6),
  ),
  twoWayArrow: polygon(
    [
      [0, 0.5],
      [0.32, 0],
      [0.32, 0.2],
      [0.68, 0.2],
      [0.68, 0],
      [1, 0.5],
      [0.68, 1],
      [0.68, 0.8],
      [0.32, 0.8],
      [0.32, 1],
    ],
    textArea(0.32, 0.2, 0.36, 0.6),
  ),
  cross: polygon(
    [
      [0.25, 0],
      [0.75, 0],
      [0.75, 0.25],
      [1, 0.25],
      [1, 0.75],
      [0.75, 0.75],
      [0.75, 1],
      [0.25, 1],
      [0.25, 0.75],
      [0, 0.75],
      [0, 0.25],
      [0.25, 0.25],
    ],
    textArea(0.25, 0.25, 0.5, 0.5),
  ),
  pentagon: polygon(
    [
      [0.5, 0],
      [1, 0.4],
      [0.8, 1],
      [0.2, 1],
      [0, 0.4],
    ],
    textArea(0.2, 0.25, 0.6, 0.75),
  ),
  hexagon: polygon(
    [
      [0.25, 0],
      [0.75, 0],
      [1, 0.5],
      [0.75, 1],
      [0.25, 1],
      [0, 0.5],
    ],
    textArea(0.25, 0, 0.5, 1),
  ),
  octagon: polygon(
    [
      [0.3, 0],
      [0.7, 0],
      [1, 0.3],
      [1, 0.7],
      [0.7, 1],
      [0.3, 1],
      [0, 0.7],
      [0, 0.3],
    ],
    textArea(0.2, 0.2, 0.6, 0.6),
  ),
  star: polygon(
    [
      [0.5, 75 / 91],
      [18.61 / 96, 1],
      [24.2235871 / 96, 57.7254249 / 91],
      [0, 34.5491503 / 91],
      [33.3053687 / 96, 29.7745751 / 91],
      [0.5, 0],
      [62.6946313 / 96, 29.7745751 / 91],
      [1, 34.5491503 / 91],
      [71.7764129 / 96, 57.7254249 / 91],
      [77.3892626 / 96, 1],
    ],
    textArea(0.3, 0.35, 0.4, 0.4),
  ),
  roundRectangle: pathGeometry((b, p) =>
    roundRect(p, b, Math.min(b.width, b.height) * 0.1),
  ),
  terminal: pathGeometry(
    (b, p) => roundRect(p, b, b.height / 2),
    textArea(0.15, 0, 0.7, 1),
  ),
  store: pathGeometry(
    (b, p) => {
      roundRect(p, b, 6);
      p.move(b.x, b.y + b.height - Math.min(12, b.height / 4), false).line(
        b.x + b.width,
        b.y + b.height - Math.min(12, b.height / 4),
      );
    },
    textArea(0, 0, 1, 0.8),
  ),
  pentagonArrow: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      const shoulder = x + Math.max(0, w - h / 2);
      p.move(x, y)
        .line(shoulder, y)
        .line(x + w, y + h / 2)
        .line(shoulder, y + h)
        .line(x, y + h)
        .close();
    },
    textArea(0, 0, 0.75, 1),
  ),
  processArrow: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      const shoulder = x + Math.max(0, w - h / 2);
      p.move(x, y)
        .line(shoulder, y)
        .line(x + w, y + h / 2)
        .line(shoulder, y + h)
        .line(x, y + h)
        .line(x + Math.min(h / 2, w), y + h / 2)
        .close();
    },
    textArea(0.25, 0, 0.5, 1),
  ),
  comment: polygon(
    [
      [0, 0],
      [1, 0],
      [1, 0.75],
      [0.6, 0.75],
      [0.5, 1],
      [0.4, 0.75],
      [0, 0.75],
    ],
    textArea(0, 0, 1, 0.75),
  ),
  roundComment: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      const r = Math.min(w, h) * 0.1,
        bottom = y + 0.75 * h;
      p.move(x + r, y)
        .line(x + w - r, y)
        .arc(r, r, false, true, x + w, y + r)
        .line(x + w, bottom - r)
        .arc(r, r, false, true, x + w - r, bottom)
        .line(x + w / 2, bottom)
        .line(x + w / 4, y + h)
        .line(x + w / 4, bottom)
        .line(x + r, bottom)
        .arc(r, r, false, true, x, bottom - r)
        .line(x, y + r)
        .arc(r, r, false, true, x + r, y)
        .close();
    },
    textArea(0, 0, 1, 0.75),
  ),
  cloud: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      const dw = w / 7,
        dh = h / 3.2,
        rx = dw / 8.5,
        ry = dh / 20;
      p.move(x + dw, y + dh);
      [
        [2, 0.5, 1.2],
        [4.2, 1 / 2.2, 1],
        [5.8, 1, 1],
        [6, 2.2, 1.3],
        [5, 2.8, 1.2],
        [2.8, 2.8, 1 / 1.2],
        [1, 2.2, 1],
        [1, 1, 1.42],
      ].forEach(([a, b, ratio]) =>
        p.arc(rx, ry * ratio, true, true, x + dw * a, y + dh * b),
      );
      p.close();
    },
    textArea(0.2, 0.25, 0.6, 0.5),
  ),
  manualInput: polygon(
    [
      [0, 0.25],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    textArea(0, 0.25, 1, 0.75),
  ),
  preparation: polygon(
    [
      [0.2, 0],
      [0.8, 0],
      [1, 0.5],
      [0.8, 1],
      [0.2, 1],
      [0, 0.5],
    ],
    textArea(0.2, 0, 0.6, 1),
  ),
  manualLoop: polygon(
    [
      [0, 0],
      [1, 0],
      [0.875, 1],
      [0.125, 1],
    ],
    textArea(0.125, 0, 0.75, 1),
  ),
  merge: polygon(
    [
      [0, 0],
      [1, 0],
      [0.5, 1],
    ],
    textArea(0.25, 0, 0.5, 0.5),
  ),
  offPage: polygon(
    [
      [0, 0],
      [1, 0],
      [1, 0.65],
      [0.5, 1],
      [0, 0.65],
    ],
    textArea(0, 0, 1, 0.65),
  ),
  delay: pathGeometry(
    ({ x, y, width: w, height: h }, p) =>
      p
        .move(x, y)
        .line(x + 0.75 * w, y)
        .arc(w / 4, h / 2, false, true, x + 0.75 * w, y + h)
        .line(x, y + h)
        .close(),
    textArea(0, 0, 0.75, 1),
  ),
  storedData: pathGeometry(
    ({ x, y, width: w, height: h }, p) =>
      p
        .move(x + 0.1 * w, y)
        .line(x + w, y)
        .arc(w / 10, h / 2, false, false, x + w, y + h)
        .line(x + 0.1 * w, y + h)
        .arc(w / 10, h / 2, false, true, x + 0.1 * w, y)
        .close(),
    textArea(0.1, 0, 0.8, 1),
  ),
  or: pathGeometry((b, p) => {
    p.ellipse(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, b.height / 2);
    p.move(b.x + b.width / 2, b.y, false).line(
      b.x + b.width / 2,
      b.y + b.height,
    );
    p.move(b.x, b.y + b.height / 2, false).line(
      b.x + b.width,
      b.y + b.height / 2,
    );
  }),
  summingJunction: pathGeometry((b, p) => {
    const dx = b.width / (2 * Math.sqrt(2)),
      dy = b.height / (2 * Math.sqrt(2)),
      cx = b.x + b.width / 2,
      cy = b.y + b.height / 2;
    p.ellipse(cx, cy, b.width / 2, b.height / 2);
    p.move(cx - dx, cy - dy, false)
      .line(cx + dx, cy + dy)
      .move(cx + dx, cy - dy, false)
      .line(cx - dx, cy + dy);
  }),
  predefinedProcess: pathGeometry(
    (b, p) => {
      p.rect(b.x, b.y, b.width, b.height);
      [0.1, 0.9].forEach((ratio) =>
        p
          .move(b.x + b.width * ratio, b.y, false)
          .line(b.x + b.width * ratio, b.y + b.height),
      );
    },
    textArea(0.1, 0, 0.8, 1),
  ),
  document: pathGeometry(
    ({ x, y, width: w, height: h }, p) =>
      p
        .move(x, y + (h * 8) / 9)
        .line(x, y)
        .line(x + w, y)
        .line(x + w, y + (h * 8) / 9)
        .quad(x + 0.75 * w, y + (h * 2) / 3, x + 0.5 * w, y + (h * 8) / 9)
        .quad(x + 0.25 * w, y + (h * 10) / 9, x, y + (h * 8) / 9)
        .close(),
    textArea(0, 0, 1, 0.8),
  ),
  multiDocument: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      const gap = Math.min(5, w / 8, h / 8),
        bottom = y + (h * 8) / 9;
      p.move(x, bottom)
        .line(x, y + gap * 2)
        .line(x + gap, y + gap * 2)
        .line(x + gap, y + gap)
        .line(x + gap * 2, y + gap)
        .line(x + gap * 2, y)
        .line(x + w, y)
        .line(x + w, bottom - gap * 2 - 3)
        .line(x + w - gap, bottom - gap * 2 - 7)
        .line(x + w - gap, bottom - gap - 3)
        .line(x + w - gap * 2, bottom - gap - 7)
        .line(x + w - gap * 2, bottom)
        .quad(
          x + (w - gap * 2) * 0.75,
          y + (h * 2) / 3,
          x + (w - gap * 2) / 2,
          bottom,
        )
        .quad(x + (w - gap * 2) / 4, y + (h * 10) / 9, x, bottom)
        .close();
      p.move(x + gap, y + gap * 2, false)
        .line(x + w - gap * 2, y + gap * 2)
        .line(x + w - gap * 2, bottom);
      p.move(x + gap * 2, y + gap, false)
        .line(x + w - gap, y + gap)
        .line(x + w - gap, bottom - gap * 2 - 3);
    },
    textArea(0.05, 0.15, 0.85, 0.65),
  ),
  database: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      const r = h * 0.15;
      p.move(x, y + r)
        .arc(w / 2, r, false, true, x + w, y + r)
        .line(x + w, y + h - r)
        .arc(w / 2, r, false, true, x, y + h - r)
        .close();
      p.move(x, y + r, false).arc(w / 2, r, false, false, x + w, y + r);
    },
    textArea(0, 0.3, 1, 0.55),
  ),
  hardDisk: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      const r = w * 0.15;
      p.move(x + w - r, y)
        .line(x + r, y)
        .arc(r, h / 2, false, false, x + r, y + h)
        .line(x + w - r, y + h)
        .arc(r, h / 2, false, false, x + w - r, y)
        .close();
      p.move(x + w - r, y, false).arc(r, h / 2, false, true, x + w - r, y + h);
    },
    textArea(0.15, 0, 0.55, 1),
  ),
  internalStorage: pathGeometry(
    (b, p) => {
      p.rect(b.x, b.y, b.width, b.height);
      p.move(b.x, b.y + b.height / 10, false).line(
        b.x + b.width,
        b.y + b.height / 10,
      );
      p.move(b.x + b.width / 10, b.y, false).line(
        b.x + b.width / 10,
        b.y + b.height,
      );
    },
    textArea(0.1, 0.1, 0.9, 0.9),
  ),
  noteCurlyLeft: curly(true),
  noteCurlyRight: curly(false),
  noteSquare: pathGeometry(
    ({ x, y, width: w, height: h }, p) =>
      p
        .move(x + w * 0.075, y + h, false)
        .line(x, y + h)
        .line(x, y)
        .line(x + w * 0.075, y),
    textArea(0.1, 0, 0.9, 1),
  ),
  display: pathGeometry(
    ({ x, y, width: w, height: h }, p) =>
      p
        .move(x + w * 0.15, y)
        .line(x + w * 0.9, y)
        .arc(w * 0.1, h / 2, false, true, x + w * 0.9, y + h)
        .line(x + w * 0.15, y + h)
        .line(x, y + h / 2)
        .close(),
    textArea(0.15, 0, 0.75, 1),
  ),
  actor: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      p.ellipse(x + w / 2, y + h / 8, w / 6, h / 8, false);
      p.move(x + w / 2, y + h / 4, false).line(x + w / 2, y + h * 0.75);
      p.move(x, y + h / 2, false).line(x + w, y + h / 2);
      p.move(x + w / 12, y + h, false)
        .line(x + w / 2, y + h * 0.75)
        .line(x + (w * 11) / 12, y + h);
    },
    (b) => ({
      x: b.x - 20,
      y: b.y + b.height + 4,
      width: b.width + 40,
      height: 40,
    }),
  ),
  container: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      p.rect(x, y, w, h)
        .move(x + Math.min(40, w / 3), y, false)
        .line(x + Math.min(40, w / 3), y + h);
    },
    (b) => {
      const header = Math.min(40, b.width / 3);
      return {
        x: b.x + header,
        y: b.y,
        width: b.width - header,
        height: b.height,
      };
    },
  ),
  note: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      const fold = Math.min(16, w / 3, h / 3);
      p.move(x, y)
        .line(x + w - fold, y)
        .arc(fold, fold, false, true, x + w, y + fold)
        .line(x + w, y + h)
        .line(x, y + h)
        .close();
      p.move(x + w - fold, y, false)
        .line(x + w - fold, y + fold)
        .line(x + w, y + fold);
    },
    textArea(0, 0.15, 1, 0.85),
  ),
  activityClass: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      p.rect(x, y, w, h);
      [0.125, 0.875].forEach((a) =>
        p.move(x + w * a, y, false).line(x + w * a, y + h),
      );
    },
    textArea(0.125, 0, 0.75, 1),
  ),
  package: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      const header = Math.min(25, h / 3);
      p.move(x, y + header)
        .line(x, y)
        .line(x + w * 0.7, y)
        .line(x + w * 0.8, y + header)
        .line(x + w, y + header)
        .line(x + w, y + h)
        .line(x, y + h)
        .close();
      p.move(x, y + header, false).line(x + w * 0.8, y + header);
    },
    (b) => {
      const header = Math.min(25, b.height / 3);
      return {
        x: b.x,
        y: b.y + header,
        width: b.width,
        height: b.height - header,
      };
    },
  ),
  combinedFragment: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      const header = Math.min(25, h / 3);
      p.rect(x, y, w, h)
        .move(x, y + header, false)
        .line(x + w / 3 - Math.min(8, w / 12), y + header)
        .line(x + w / 3, y + header * 0.64)
        .line(x + w / 3, y);
    },
    textArea(0, 0.3, 1, 0.7),
  ),
  class: pathGeometry((b, p) => {
    p.rect(b.x, b.y, b.width, b.height);
    [1 / 3, 2 / 3].forEach((a) =>
      p
        .move(b.x, b.y + b.height * a, false)
        .line(b.x + b.width, b.y + b.height * a),
    );
  }),
  interface: pathGeometry((b, p) => {
    p.rect(b.x, b.y, b.width, b.height);
    p.move(b.x, b.y + b.height / 2, false).line(
      b.x + b.width,
      b.y + b.height / 2,
    );
  }),
  component: pathGeometry(componentPath, textArea(0.2, 0, 0.8, 1)),
  componentBox: pathGeometry(
    (b, p) => {
      p.rect(b.x, b.y, b.width, b.height);
      const width = b.width > 109 ? 45 : b.width * 0.25,
        height = b.height > 47 ? 30 : b.height * 0.2;
      componentPath(
        {
          x: b.x + b.width - Math.min(18, b.width * 0.1) - width,
          y: b.y + Math.min(8, b.height * 0.1),
          width,
          height,
        },
        p,
      );
    },
    textArea(0, 0.4, 1, 0.6),
  ),
  template: pathGeometry((b, p) => roundRect(p, b, 4), undefined, '10 10'),
  deletion: pathGeometry(({ x, y, width: w, height: h }, p) =>
    p
      .move(x, y, false)
      .line(x + w, y + h)
      .move(x + w, y, false)
      .line(x, y + h),
  ),
  providedInterface: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      p.move(x, y + h / 2, false).line(x + w * 0.54, y + h / 2);
      p.ellipse(x + w * 0.77, y + h / 2, w * 0.23, h / 2);
    },
    (b) => ({ ...b, y: b.y + b.height + 4, height: 40 }),
  ),
  requiredInterface: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      p.move(x, y, false).arc(w * 0.39, h / 2, false, true, x, y + h);
      p.move(x + w * 0.41, y + h / 2, false).line(x + w, y + h / 2);
    },
    (b) => ({ ...b, y: b.y + b.height + 4, height: 40 }),
  ),
  assembly: pathGeometry(
    ({ x, y, width: w, height: h }, p) => {
      p.move(x, y + h / 2, false).line(x + w * 0.3, y + h / 2);
      p.ellipse(x + w * 0.43, y + h / 2, w * 0.13, h * 0.285);
      p.move(x + w * 0.43, y, false).arc(
        w * 0.233,
        h / 2,
        false,
        true,
        x + w * 0.43,
        y + h,
      );
      p.move(x + w * 0.663, y + h / 2, false).line(x + w, y + h / 2);
    },
    (b) => ({ ...b, y: b.y + b.height + 4, height: 40 }),
  ),
};
