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
