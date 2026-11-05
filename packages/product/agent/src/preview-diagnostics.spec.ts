// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectTextOverflowWarnings } from './preview-diagnostics';

function rect(values: number[]): DOMRect {
  const [left, top, right, bottom] = values;
  return DOMRect.fromRect({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

function text(cellId = 'decision', body = [0, 10, 100, 30]) {
  return `<g data-cell-id="${cellId}"><foreignObject width="100" height="40"><div data-frame-rich-text class="board-text-layout" data-visible="0,0,100,40" data-body="${body}"><div class="board-text-body"><div class="board-text-content">输入有效？</div></div></div></foreignObject></g>`;
}

let root: HTMLDivElement;
let rangeRects: DOMRect[];
beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  rangeRects = [];
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const layout = this.closest<HTMLElement>('[data-frame-rich-text]');
      const value = this.matches('[data-frame-rich-text]')
        ? layout?.dataset.visible
        : layout?.dataset.body;
      return rect((value ?? '0,0,0,0').split(',').map(Number));
    },
  );
  vi.spyOn(document, 'createRange').mockImplementation(
    () =>
      ({
        selectNodeContents: vi.fn(),
        getClientRects: () => rangeRects,
      }) as unknown as Range,
  );
});
afterEach(() => {
  root.remove();
  vi.restoreAllMocks();
});

describe('exported node text overflow diagnostics', () => {
  const collect = (ids = ['decision']) =>
    collectTextOverflowWarnings(root, new Set(ids));

  it('finds static rich text without contenteditable and measures outside SVG transforms', () => {
    root.innerHTML = `<svg><g transform="rotate(45) scale(.5)">${text('decision', [0, -10, 100, 50])}</g></svg>`;
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    expect(collect()).toEqual([
      {
        code: 'visual.text-overflow',
        cellId: 'decision',
        message: 'Rendered text exceeds its visible area (top, bottom)',
      },
    ]);
    const measured = measure.mock.instances[0];
    expect(measured.closest('svg')).toBeNull();
    expect(measured.parentElement?.style.width).toBe('100px');
    expect(measured.parentElement?.style.height).toBe('40px');
    expect(document.body.children).toHaveLength(1);
  });

  it.each([
    ['left', [-4, 0, 100, 40]],
    ['top', [0, -4, 100, 40]],
    ['right', [0, 0, 104, 40]],
    ['bottom', [0, 0, 100, 44]],
  ])('reports overflow at the %s edge', (side, body) => {
    root.innerHTML = `<svg>${text('decision', body as number[])}</svg>`;
    expect(collect()[0].message).toBe(
      `Rendered text exceeds its visible area (${side})`,
    );
  });

  it('accepts fitting text and the existing three-pixel tolerance', () => {
    root.innerHTML = `<svg>${text('decision', [-3, -3, 103, 43])}</svg>`;
    expect(collect()).toEqual([]);
  });

  it('uses text ranges to detect horizontal overflow inside a fitting body', () => {
    root.innerHTML = `<svg>${text()}</svg>`;
    rangeRects = [rect([-5, 10, 106, 30])];
    expect(collect()[0].message).toBe(
      'Rendered text exceeds its visible area (left, right)',
    );
  });

  it('aggregates multiple text areas into one warning per node', () => {
    root.innerHTML = `<svg>${text('decision', [0, -8, 100, 40])}${text('decision', [0, 0, 100, 48])}</svg>`;
    expect(collect()).toHaveLength(1);
    expect(collect()[0].message).toContain('(top, bottom)');
  });

  it.each(['data-document-preview-body', 'data-document-preview-scroll'])(
    'excludes intentionally clipped %s content',
    (attribute) => {
      root.innerHTML = `<svg><g ${attribute}>${text('decision', [0, -100, 100, 140])}</g>${text('title', [0, -8, 100, 48])}</svg>`;
      expect(collect(['decision', 'title']).map((w) => w.cellId)).toEqual([
        'title',
      ]);
    },
  );

  it('attributes nested text to its nearest cell and ignores unrequested nodes', () => {
    root.innerHTML = `<svg><g data-cell-id="parent">${text('child', [0, -8, 100, 48])}</g></svg>`;
    expect(collect(['parent'])).toEqual([]);
    expect(collect(['parent', 'child']).map((w) => w.cellId)).toEqual([
      'child',
    ]);
  });

  it('ignores text without a measurable visible area', () => {
    root.innerHTML = `<svg>${text('decision', [0, -8, 100, 48])}</svg>`;
    root.querySelector<HTMLElement>('[data-frame-rich-text]')!.dataset.visible =
      '0,0,0,0';
    expect(collect()).toEqual([]);
  });

  it('removes the measurement probe when measuring fails', () => {
    root.innerHTML = `<svg>${text()}</svg>`;
    vi.mocked(document.createRange).mockImplementation(() => {
      throw new Error('measurement failed');
    });
    expect(() => collect()).toThrow('measurement failed');
    expect(document.body.children).toHaveLength(1);
  });
});
