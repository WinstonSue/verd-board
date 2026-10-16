import { expect, it } from 'vitest';
import { drawCellShapePaths } from './cell-shape';
import { createGeometryCell } from './cell-commands';
it('draws deterministic Rough paths from native geometry and preserves styles', () => {
  const cell = createGeometryCell('database', 'database', [
    [10, 20],
    [170, 120],
  ]);
  cell.data = { roughness: 2, fillStyle: 'hachure' };
  cell.appearance = {
    fill: '#ff0000',
    strokeColor: '#0000ff',
    strokeWidth: 4,
    strokeStyle: 'dashed',
  };
  const paths = drawCellShapePaths(cell);
  expect(paths).toEqual(drawCellShapePaths(cell));
  expect(paths.every((p) => p.d.length > 0 && !/NaN|Infinity/.test(p.d))).toBe(
    true,
  );
  expect(paths.some((p) => p.stroke === '#ff0000')).toBe(true);
  expect(
    paths
      .filter((p) => p.stroke === '#0000ff')
      .every((p) => p.strokeDasharray === '8 4'),
  ).toBe(true);
  const other = drawCellShapePaths({ ...cell, id: 'other' });
  expect(other).not.toEqual(paths);
});
it('does not fill open symbols or erase native text identity', () => {
  const cell = createGeometryCell('brace', 'noteCurlyRight', [
    [0, 0],
    [160, 100],
  ]);
  expect(
    drawCellShapePaths(cell).every(
      (path) => !path.fill || path.fill === 'none',
    ),
  ).toBe(true);
  const text = createGeometryCell('text', 'text', [[0, 0]]);
  expect(
    drawCellShapePaths(text).some((path) => path.fill && path.fill !== 'none'),
  ).toBe(false);
  expect(text.content?.label).toBe('Text');
});
