import { expect, it } from 'vitest';
import {
  colorContrast,
  resolveBoardTheme,
  type NodeCell,
} from '@sue/board-core';
import {
  resolveFrameAppearance,
  resolveFrameCellAppearance,
} from './frame-appearance';

it('resolves text after per-field custom fills and preserves runtime-only defaults through reset', () => {
  const cell: NodeCell = {
    id: 'node',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 40 },
  };
  const context = {
    cell,
    store: { rootId: 'frame', cells: { node: cell } },
    frameId: 'frame',
    theme: resolveBoardTheme(undefined, 'dark'),
  };
  const defaults = {
    fill: '#312e81',
    strokeColor: '#a5b4fc',
    textColor: '#e2e8f0',
  };
  const before = JSON.stringify(context.store);
  expect(resolveFrameAppearance(context, defaults)).toMatchObject(defaults);
  expect(JSON.stringify(context.store)).toBe(before);
  cell.appearance = { fill: '#ffffff', colorSources: { fill: 'custom' } };
  const custom = resolveFrameAppearance(context, defaults);
  expect(custom.fill).toBe('#ffffff');
  expect(colorContrast(custom.fill!, custom.textColor!)).toBeGreaterThanOrEqual(
    4.5,
  );
  expect(
    colorContrast(custom.fill!, custom.strokeColor!),
  ).toBeGreaterThanOrEqual(3);
  cell.appearance.colorSources!.fill = 'theme';
  expect(resolveFrameAppearance(context, defaults)).toMatchObject(defaults);
  expect(cell.appearance).not.toHaveProperty('textColor');
});

it('shares domain defaults with inspectors, while transparent parts use the supporting background', () => {
  const cell: NodeCell = {
    id: 'node',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 40 },
    appearance: { fill: 'transparent' },
  };
  const context = {
    cell,
    store: { rootId: 'frame', cells: { node: cell } },
    frameId: 'frame',
    theme: resolveBoardTheme(undefined, 'dark'),
    background: '#ffffff',
  };
  const visual = resolveFrameCellAppearance(context, [
    {
      kind: 'geometry',
      themeAppearance: () => ({ fill: '#312e81', textColor: '#e2e8f0' }),
    },
  ]);
  expect(visual.fill).toBe('transparent');
  expect(colorContrast('#ffffff', visual.textColor!)).toBeGreaterThanOrEqual(
    4.5,
  );
  expect(visual).toEqual(
    resolveFrameAppearance(context, { fill: '#312e81', textColor: '#e2e8f0' }),
  );
});

it('ignores adaptive role defaults when appearance is omitted', () => {
  const cell: NodeCell = {
    id: 'node',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 40 },
    appearance: { fill: '#abcdef', strokeColor: '#123456' },
  };
  const context = {
    cell,
    store: { rootId: 'frame', cells: { node: cell } },
    frameId: 'frame',
    theme: resolveBoardTheme(),
  };
  const visual = resolveFrameAppearance(context, {
    fill: '#312e81',
    strokeColor: '#a5b4fc',
    textColor: '#fff',
  });
  expect(visual).toMatchObject(cell.appearance!);
  expect(visual).not.toHaveProperty('textColor');
});
