import { createFrameCell, createCellStore } from '@sue/board-core';
import { describe, expect, it } from 'vitest';
import { cloneFrameImageSvg, frameSnapshotToImage } from './frame-export';
const svg = (contents: string) => {
  const host = document.createElement('div');
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" role="application" tabindex="0">${contents}</svg>`;
  document.body.append(host);
  return host.querySelector('svg')!;
};
describe('native frame image clone', () => {
  it('freezes document reading offsets without changing the live viewport', () => {
    const source = svg(
      '<foreignObject><div data-document-preview-scroll="" style="height:100px;overflow:auto"><p>Full source text</p></div></foreignObject>',
    );
    const reader = source.querySelector<HTMLElement>(
      '[data-document-preview-scroll]',
    )!;
    reader.scrollTop = 150;
    reader.scrollLeft = 12;
    const cloned = cloneFrameImageSvg(source).querySelector<HTMLElement>(
      '[data-document-preview-scroll]',
    )!;
    expect(cloned.style.overflow).toBe('hidden');
    expect((cloned.firstElementChild as HTMLElement).style.transform).toBe(
      'translate(-12px, -150px)',
    );
    expect(reader.scrollTop).toBe(150);
    source.parentElement!.remove();
  });
  it('restores temporarily hidden authored strokes and arrow bodies only in the export clone', () => {
    const source = svg(
      '<g opacity="0.2"><g opacity="0" data-frame-original-opacity="1"><path stroke="#000" stroke-width="8" d="M0 0L100 0"/><path fill="#000" d="M90 -5L100 0L90 5Z"/></g></g><rect stroke="#000" style="stroke-opacity:0" data-frame-original-stroke-opacity="0.7"/><g data-frame-export-exclude="interaction-stroke"><path stroke="#6366f1"/></g>',
    );
    const clone = cloneFrameImageSvg(source);
    expect(clone.querySelector<SVGElement>('g > g')!.style.opacity).toBe('1');
    expect(clone.querySelector<SVGElement>('rect')!.style.strokeOpacity).toBe(
      '0.7',
    );
    expect(clone.querySelector('[data-frame-export-exclude]')).toBeNull();
    expect(clone.querySelector('[data-frame-original-opacity]')).toBeNull();
    expect(source.querySelector('g > g')!.getAttribute('opacity')).toBe('0');
    expect(source.querySelector<SVGElement>('rect')!.style.strokeOpacity).toBe(
      '0',
    );
    source.parentElement!.remove();
  });
  it('restores ordinary ranks independently in nested frames without reordering the source', () => {
    const source = svg(
      '<g data-frame-content-id="root"><g data-frame-normal-rank="1" data-cell-id="node"><g data-frame-content-id="inner"><g data-frame-normal-rank="1" data-cell-id="child"/><g data-frame-normal-rank="0" data-cell-id="inner-edge"/></g></g><g data-frame-normal-rank="0" data-cell-id="edge"/><g data-frame-export-exclude="controls"/></g>',
    );
    const order = (root: Element, frame: string) =>
      [...root.querySelector(`[data-frame-content-id="${frame}"]`)!.children]
        .map((el) => el.getAttribute('data-cell-id'))
        .filter(Boolean);
    const clone = cloneFrameImageSvg(source);
    expect(order(clone, 'root')).toEqual(['edge', 'node']);
    expect(order(clone, 'inner')).toEqual(['inner-edge', 'child']);
    expect(order(source, 'root')).toEqual(['node', 'edge']);
    expect(order(source, 'inner')).toEqual(['child', 'inner-edge']);
    expect(clone.querySelector('[data-frame-normal-rank]')).toBeNull();
    source.parentElement!.remove();
  });
  it('rejects invalid export options before mounting a renderer', async () => {
    const snapshot = { store: createCellStore(createFrameCell('root')) };
    const before = document.body.childElementCount;
    await expect(frameSnapshotToImage(snapshot, { ratio: 0 })).rejects.toThrow(
      'Invalid image export',
    );
    await expect(
      frameSnapshotToImage(snapshot, { padding: -1 }),
    ).rejects.toThrow('Invalid image export');
    await expect(
      frameSnapshotToImage(snapshot, { quality: 2 }),
    ).rejects.toThrow('Invalid image export');
    expect(document.body.childElementCount).toBe(before);
  });
  it('preserves nested frame transforms while exporting only selected descendants', () => {
    const source = svg(
      '<g><g data-cell-id="frame" transform="translate(40 30)"><rect data-shell="true" width="200" height="100"/><g transform="scale(.5)"><g data-cell-id="selected"><path d="M0 0L20 20"/></g><g data-cell-id="other"><rect width="50" height="40"/></g></g></g></g>',
    );
    const clone = cloneFrameImageSvg(source, new Set(['selected']));
    expect(clone.querySelector('[data-cell-id="selected"]')).toBeTruthy();
    expect(clone.querySelector('[data-cell-id="other"]')).toBeNull();
    expect(clone.querySelector('[data-shell]')).toBeNull();
    expect(
      clone.querySelector('[data-cell-id="frame"]')!.getAttribute('transform'),
    ).toBe('translate(40 30)');
    expect(source.querySelector('[data-cell-id="other"]')).toBeTruthy();
    source.parentElement!.remove();
  });
  it('inlines custom SVG paint and clipping styles for portable custom nodes', () => {
    const style = document.createElement('style');
    style.textContent =
      '.export-custom {fill:rgb(255,0,0);clip-path:url("#clip");text-anchor:middle}';
    document.head.append(style);
    const source = svg(
      '<defs><clipPath id="clip"><rect width="20" height="20"/></clipPath></defs><g><path class="export-custom" d="M0 0L40 40"/></g>',
    );
    const clone = cloneFrameImageSvg(source);
    const path = clone.querySelector('path')!;
    expect(path.style.fill).toBe('rgb(255,0,0)');
    expect(path.style.clipPath).toContain('#clip');
    expect(path.style.textAnchor).toBe('middle');
    source.parentElement!.remove();
    style.remove();
  });
  it('retains visible content and strips interactive handles, ports and event attributes', () => {
    const source = svg(
      '<g data-cell-id="cell"><path data-art="true" stroke="red" d="M0 0L40 40"/><path data-edge-hit="cell" stroke="transparent"/><circle data-port-id="out"/><g data-selection-handles="cell"/><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" contenteditable="true" onclick="alert(1)" style="font-size:24px;font-weight:bold">Rich text</div></foreignObject></g>',
    );
    const clone = cloneFrameImageSvg(source);
    expect(clone.querySelector('[data-art]')).toBeTruthy();
    expect(clone.querySelector('[data-port-id]')).toBeNull();
    expect(clone.querySelector('[data-edge-hit]')).toBeNull();
    expect(clone.querySelector('[data-selection-handles]')).toBeNull();
    expect(clone.querySelector('div')!.getAttribute('style')).toContain(
      'font-size: 24px',
    );
    expect(clone.querySelector('[onclick]')).toBeNull();
    expect(clone.querySelector('[contenteditable]')).toBeNull();
    const rich = svg(
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><strong>Export rich text</strong></div></foreignObject>',
    );
    expect(cloneFrameImageSvg(rich).querySelector('strong')?.textContent).toBe(
      'Export rich text',
    );
    rich.parentElement!.remove();
    expect(clone.hasAttribute('tabindex')).toBe(false);
    expect(source.querySelector('[data-port-id]')).toBeTruthy();
    source.parentElement!.remove();
  });
});

it('keeps the source cells of a selected reference while excluding other occurrences', () => {
  const source = svg(
    '<g data-cell-id="selected-ref"><g data-reference-preview="target"><g data-cell-id="source-cell"><text>Referenced content</text></g></g></g><g data-cell-id="other-ref"><g data-cell-id="source-cell"><text>Other occurrence</text></g></g>',
  );
  try {
    const clone = cloneFrameImageSvg(source, new Set(['selected-ref']));
    expect(clone.querySelectorAll('[data-cell-id="source-cell"]')).toHaveLength(
      1,
    );
    expect(clone.textContent).toBe('Referenced content');
    expect(
      source.querySelectorAll('[data-cell-id="source-cell"]'),
    ).toHaveLength(2);
  } finally {
    source.parentElement!.remove();
  }
});

it('freezes concrete styles without retaining ambient application custom properties', () => {
  const source = svg(
    '<foreignObject><div style="--vm-background:#000;color:#ffffff">Text</div></foreignObject>',
  );
  source.style.setProperty('--board-text', '#ffffff');
  try {
    const clone = cloneFrameImageSvg(source);
    expect(clone.style.getPropertyValue('--board-text')).toBe('');
    expect(
      (clone.querySelector('div') as HTMLElement).style.getPropertyValue(
        '--vm-background',
      ),
    ).toBe('');
    expect((clone.querySelector('div') as HTMLElement).style.color).toBe(
      'rgb(255, 255, 255)',
    );
    expect(source.style.getPropertyValue('--board-text')).toBe('#ffffff');
  } finally {
    source.parentElement!.remove();
  }
});

it('freezes automatic overlay paints per occurrence without flattening authored transparency', () => {
  const source = svg(
    '<g data-cell-id="reference"><g data-cell-id="external-task" fill="#7c3aed3d" style="fill:rgba(124,58,237,0.24)" data-frame-export-fill="#e0cffb"><rect data-overlay-child style="fill:rgba(124,58,237,0.24)" width="100" height="60"/></g><g data-cell-id="external-class"><rect data-uml-class-body fill="#7c3aed1a" data-frame-export-fill="#eee6fd"/><rect data-uml-class-header fill="#7c3aed3d" data-frame-export-fill="#e0cffb"/></g><rect data-authored fill="#ff000080"/></g>',
  );
  try {
    const clone = cloneFrameImageSvg(source);
    expect(
      clone
        .querySelector('[data-cell-id="external-task"]')
        ?.getAttribute('fill'),
    ).toBe('#e0cffb');
    expect(
      clone.querySelector<SVGElement>('[data-uml-class-header]')?.style.fill,
    ).toBe('#e0cffb');
    expect(
      clone.querySelector('[data-uml-class-body]')?.getAttribute('fill'),
    ).toBe('#eee6fd');
    expect(
      clone.querySelector<SVGElement>('[data-overlay-child]')?.style.fill,
    ).toBe('#e0cffb');
    expect(clone.querySelector('[data-authored]')?.getAttribute('fill')).toBe(
      '#ff000080',
    );
    expect(clone.querySelector('[data-frame-export-fill]')).toBeNull();
    expect(
      source
        .querySelector('[data-cell-id="external-task"]')
        ?.getAttribute('fill'),
    ).toBe('#7c3aed3d');
  } finally {
    source.parentElement!.remove();
  }
});
