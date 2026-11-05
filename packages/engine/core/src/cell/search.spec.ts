import { describe, expect, it } from 'vitest';
import { createFrameCell, type Cell, type CellStore } from './types';
import { cellSearchTexts, findFrameCells } from './search';

const node = (id: string, extra: object = {}) =>
  ({
    id,
    kind: 'geometry',
    cellType: 'node',
    name: id,
    geometry: { x: 0, y: 0, width: 100, height: 50 },
    ...extra,
  }) as Cell;

describe('canvas search', () => {
  it('extracts rich text, labels and diagram fields without cached text or addresses', () => {
    const cell = node('opaque-id', {
      name: 'Customer',
      content: {
        text: {
          plainText: 'stale-cache',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Hello ' },
                  { type: 'text', text: 'world' },
                ],
              },
              {
                type: 'frameReference',
                attrs: { targetFrameId: 'private-target' },
              },
            ],
          },
        },
      },
      data: {
        attributes: [{ name: 'Customer', type: 'string' }],
        methods: [{ signature: 'save()' }],
        operands: [{ guard: 'ready' }],
        targetFrameId: 'private-target',
        href: 'https://secret.example',
      },
    });
    expect(cellSearchTexts(cell)).toEqual([
      'Customer',
      'Hello world',
      'string',
      'save()',
      'ready',
    ]);
  });

  it('searches only owned descendants, excludes hidden ancestors and deduplicates elements', () => {
    const root = {
      ...createFrameCell('board'),
      children: ['a', 'nested', 'ref', 'hidden', 'hidden-frame', 'grouped'],
      groups: ['hidden-group'],
    };
    const nested = {
      ...createFrameCell('nested'),
      name: 'Needle chart',
      children: ['b'],
    };
    const store: CellStore = {
      rootId: 'board',
      cells: {
        board: root,
        a: node('a', { name: 'Needle', data: { label: 'Needle' } }),
        nested,
        b: node('b', { name: 'needle' }),
        ref: node('ref', {
          kind: 'frame-reference',
          name: 'Needle reference',
          data: { targetFrameId: 'external' },
        }),
        external: {
          ...createFrameCell('external'),
          children: ['external-child'],
        },
        'external-child': node('external-child', { name: 'Needle' }),
        hidden: node('hidden', { hidden: true, name: 'Needle' }),
        'hidden-frame': {
          ...createFrameCell('hidden-frame'),
          hidden: true,
          children: ['hidden-child'],
        },
        'hidden-child': node('hidden-child', { name: 'Needle' }),
        grouped: node('grouped', { name: 'Needle' }),
        'hidden-group': {
          id: 'hidden-group',
          kind: 'group',
          cellType: 'group',
          hidden: true,
          members: ['grouped'],
        },
      },
    };
    expect(findFrameCells(store, 'board', 'needle')).toEqual([
      'a',
      'nested',
      'b',
      'ref',
    ]);
    expect(findFrameCells(store, 'board', 'Needle', true)).toEqual([
      'a',
      'nested',
      'ref',
    ]);
    expect(findFrameCells(store, 'board', '')).toEqual([]);
    expect(findFrameCells(store, 'board', 'private-target')).toEqual([]);
  });
});
