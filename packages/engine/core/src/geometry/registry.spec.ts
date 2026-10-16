import { describe, expect, it } from 'vitest';
import { createDefaultShapeGeometryRegistry } from './registry';
import { hitNodeShape, nodeShapeGeometry } from './node';
import { portAnchor } from './edge';
import type { NodeCell } from '../cell/types';

const registry = createDefaultShapeGeometryRegistry();
const bounds = { x: 10, y: 20, width: 160, height: 100 };
const productShapes =
  'rectangle roundRectangle ellipse diamond triangle parallelogram trapezoid leftArrow rightArrow cross star pentagon hexagon octagon pentagonArrow processArrow twoWayArrow comment roundComment cloud process decision data connector terminal manualInput preparation manualLoop merge delay storedData or summingJunction predefinedProcess offPage document multiDocument database hardDisk internalStorage noteCurlyRight noteCurlyLeft noteSquare display actor useCase container note simpleClass activityClass branchMerge port package combinedFragment class interface object component componentBox template activation deletion assembly providedInterface requiredInterface'.split(
    ' ',
  );
describe('native whiteboard geometry', () => {
  it.each(productShapes)(
    '%s has a finite path, hit contour and boundary anchors at different sizes',
    (kind) => {
      const geometry = registry.get(kind);
      expect(geometry).toBeDefined();
      for (const size of [
        [160, 100],
        [12, 8],
        [0, 0],
      ]) {
        const b = { ...bounds, width: size[0], height: size[1] };
        expect(geometry!.path(b)).toMatch(/^M /);
        expect(geometry!.path(b)).not.toMatch(/NaN|Infinity/);
        expect(geometry!.hit(b, [b.x - 100, b.y - 100], true, 0)).toBe(false);
        const anchor = geometry!.anchor!(b, 'left', 0.5);
        expect(anchor.every(Number.isFinite)).toBe(true);
        expect(geometry!.hit(b, anchor, false, 0.01)).toBe(true);
      }
    },
  );
  it('hits contours rather than bounding boxes, including open UML symbols and braces', () => {
    expect(registry.get('diamond')!.hit(bounds, [12, 22], true, 0)).toBe(false);
    expect(registry.get('diamond')!.hit(bounds, [90, 70], true, 0)).toBe(true);
    expect(registry.get('ellipse')!.hit(bounds, [90, 70], false, 1)).toBe(
      false,
    );
    expect(registry.get('actor')!.hit(bounds, [90, 82], true, 1)).toBe(true);
    expect(registry.get('actor')!.hit(bounds, [50, 100], true, 1)).toBe(false);
    expect(registry.get('noteSquare')!.hit(bounds, [10, 70], true, 1)).toBe(
      true,
    );
    expect(registry.get('noteSquare')!.hit(bounds, [90, 70], true, 1)).toBe(
      false,
    );
    expect(registry.get('document')!.hit(bounds, [12, 118], true, 0)).toBe(
      false,
    );
  });
  it('keeps internal strokes open and gives labels their usable text region', () => {
    const parts = registry.get('database')!.parts!(bounds);
    expect(parts).toHaveLength(2);
    expect(parts[0].fill).toBeUndefined();
    expect(parts[1].fill).toBe('none');
    expect(registry.get('or')!.parts!(bounds)).toHaveLength(3);
    expect(registry.get('store')!.parts!(bounds)).toHaveLength(2);
    expect(registry.get('actor')!.textBounds!(bounds).y).toBeGreaterThan(
      bounds.y + bounds.height,
    );
    expect(registry.get('comment')!.textBounds!(bounds).height).toBe(75);
    expect(registry.get('template')!.parts!(bounds)[0].strokeDasharray).toBe(
      '10 10',
    );
  });
  it('shares actual boundary ports with rotated routing and honors custom corner radii', () => {
    const geometry = {
      x: 0,
      y: 0,
      width: 160,
      height: 100,
      outline: 'manualInput',
    };
    const anchor = portAnchor(geometry, { side: 'top', offset: 0.5 });
    expect(anchor.point[0]).toBeCloseTo(80);
    expect(anchor.point[1]).toBeCloseTo(12.5);
    const rotated = portAnchor(
      { ...geometry, rotation: Math.PI / 2 },
      { side: 'top', offset: 0.5 },
    );
    expect(rotated.point[0]).toBeCloseTo(117.5);
    expect(rotated.point[1]).toBeCloseTo(50);
    expect(rotated.side).toBe('right');
    const round = nodeShapeGeometry({ kind: 'roundRectangle', radius: 30 })!;
    expect(round.hit(geometry, [1, 1], true, 0)).toBe(false);
    expect(round.path(geometry)).toContain('A 30 30');
  });
  it('rotates hit points into the same shape space as rendering', () => {
    const cell: NodeCell = {
      id: 'a',
      cellType: 'node',
      kind: 'geometry',
      geometry: {
        x: 0,
        y: 0,
        width: 160,
        height: 20,
        outline: 'rectangle',
        rotation: Math.PI / 2,
      },
    };
    expect(hitNodeShape(cell, [80, 70], 0)).toBe(true);
    expect(hitNodeShape(cell, [10, 10], 0)).toBe(false);
  });
});
