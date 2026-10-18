import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  copyCellFragment,
  isFrameCell,
  type CellRegistry,
  type FrameSnapshot,
} from '@sue/board-core';
import {
  FrameCanvas,
  type FrameRenderExtension,
  type FrameDocumentReferences,
} from './frame-canvas';

export interface FrameImageOptions {
  format?: 'svg' | 'png' | 'jpeg';
  /** Omit to export the whole mounted frame; selection expands through its relations. */
  ids?: readonly string[];
  ratio?: number;
  padding?: number;
  background?: string;
  quality?: number;
}
export interface FrameImageRenderOptions extends FrameImageOptions {
  documentReferences?: FrameDocumentReferences;
  frameId?: string;
  registry?: CellRegistry;
  extensions?: readonly FrameRenderExtension[];
  renderStyle?: CSSProperties;
  className?: string;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
const excluded =
  '[data-eraser-preview], [data-port-id], [data-edge-hit], [data-vector-hit], [data-selection-handles], [data-vector-controls], [data-table-resize], [data-table-move], [data-drawing-preview], [data-selection-marquee], [data-vector-close], [data-frame-export-exclude]';
const svgStyles = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
  'color',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'visibility',
  'display',
  'paint-order',
  'vector-effect',
  'clip-path',
  'mask',
  'filter',
  'stop-color',
  'stop-opacity',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'letter-spacing',
  'word-spacing',
  'writing-mode',
  'white-space',
  'shape-rendering',
  'image-rendering',
  'stroke-miterlimit',
  'marker-start',
  'marker-mid',
  'marker-end',
];
export function cloneFrameImageSvg(
  source: SVGSVGElement,
  included?: ReadonlySet<string>,
): SVGSVGElement {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const originals = [source, ...source.querySelectorAll('*')],
    copies = [clone, ...clone.querySelectorAll('*')];
  originals.forEach((node, index) => {
    const target = copies[index] as HTMLElement | SVGElement;
    const style = getComputedStyle(node);
    const properties =
      node.namespaceURI === SVG_NS ? svgStyles : Array.from(style);
    properties.forEach((property) =>
      target.style.setProperty(property, style.getPropertyValue(property)),
    );
    for (const attribute of Array.from(target.attributes))
      if (
        attribute.name.startsWith('on') ||
        ['tabindex', 'contenteditable'].includes(attribute.name)
      )
        target.removeAttribute(attribute.name);
  });
  // DOM cloning drops scroll offsets. Freeze each document viewport into its
  // own clipped, translated content without touching the live reader.
  originals.forEach((node, index) => {
    if (!node.hasAttribute('data-document-preview-scroll')) return;
    const target = copies[index] as HTMLElement;
    const viewport = node as HTMLElement;
    const content = document.createElement('div');
    while (target.firstChild) content.append(target.firstChild);
    content.style.transform = `translate(${-viewport.scrollLeft}px, ${-viewport.scrollTop}px)`;
    target.style.overflow = 'hidden';
    target.append(content);
  });
  clone.querySelectorAll('[data-erase-dim]').forEach((node) => {
    node.setAttribute('opacity', '1');
    (node as SVGElement).style.opacity = '1';
  });
  clone.querySelectorAll(excluded).forEach((node) => node.remove());
  if (included) {
    const contains = (node: Element) =>
      included.has(node.getAttribute('data-cell-id') ?? '') ||
      Array.from(node.querySelectorAll('[data-cell-id]')).some((child) =>
        included.has(child.getAttribute('data-cell-id')!),
      );
    for (const cell of Array.from(clone.querySelectorAll('[data-cell-id]'))) {
      if (included.has(cell.getAttribute('data-cell-id')!)) continue;
      if (!contains(cell)) cell.remove();
      else
        for (const child of Array.from(cell.children))
          if (child.tagName.toLowerCase() !== 'defs' && !contains(child))
            child.remove();
    }
  }
  clone.removeAttribute('role');
  clone.removeAttribute('aria-label');
  clone.removeAttribute('class');
  clone.style.background = 'transparent';
  clone.style.touchAction = 'auto';
  return clone;
}
const blobDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read export resource'));
    reader.readAsDataURL(blob);
  });
async function inlineResources(svg: SVGSVGElement) {
  const cache = new Map<string, Promise<string>>();
  const embed = (url: string, base = document.baseURI) => {
    if (url.startsWith('data:')) return Promise.resolve(url);
    const absolute = new URL(url, base).href;
    let result = cache.get(absolute);
    if (!result) {
      result = fetch(absolute)
        .then((response) => {
          if (!response.ok)
            throw new Error(
              `Cannot export resource: ${absolute} (${response.status})`,
            );
          return response.blob();
        })
        .then(blobDataUrl);
      cache.set(absolute, result);
    }
    return result;
  };
  const inlineUrls = async (value: string, base = document.baseURI) => {
    const matches = Array.from(value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g));
    for (const match of matches) {
      if (match[2].startsWith('#')) continue;
      value = value.replace(match[0], `url("${await embed(match[2], base)}")`);
    }
    return value;
  };
  await Promise.all(
    Array.from(svg.querySelectorAll('image,img')).map(async (node) => {
      const attribute = node.tagName.toLowerCase() === 'img' ? 'src' : 'href';
      const url =
        node.getAttribute(attribute) ??
        node.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (url) {
        node.setAttribute(attribute, await embed(url));
        node.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
      }
    }),
  );
  await Promise.all(
    Array.from(svg.querySelectorAll('[style]')).map(async (node) => {
      const style = (node as HTMLElement | SVGElement).style;
      for (const property of Array.from(style)) {
        const value = style.getPropertyValue(property);
        if (value.includes('url('))
          style.setProperty(property, await inlineUrls(value));
      }
    }),
  );
  const families = new Set(
    Array.from(svg.querySelectorAll('*')).flatMap((node) =>
      (node as HTMLElement | SVGElement).style.fontFamily
        .split(',')
        .map((value) =>
          value
            .trim()
            .replace(/^['"]|['"]$/g, '')
            .toLowerCase(),
        ),
    ),
  );
  const faces: string[] = [];
  const visit = async (rules: CSSRuleList, base: string) => {
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const font = rule as CSSFontFaceRule,
          family = font.style.fontFamily
            .replace(/^['"]|['"]$/g, '')
            .toLowerCase();
        if (families.has(family))
          faces.push(await inlineUrls(font.cssText, base));
      } else if ('cssRules' in rule)
        await visit((rule as CSSGroupingRule).cssRules, base);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    await visit(rules, sheet.href ?? document.baseURI);
  }
  if (faces.length) {
    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = faces.join('\n');
    svg.prepend(style);
  }
}
function remapSvgIds(svg: SVGSVGElement) {
  const prefix = `export-${crypto.randomUUID()}-`,
    ids = new Map<string, string>();
  svg.querySelectorAll('[id]').forEach((node) => {
    const old = node.id;
    const next = prefix + ids.size;
    ids.set(old, next);
    node.id = next;
  });
  for (const node of [svg, ...svg.querySelectorAll('*')])
    for (const attr of Array.from(node.attributes)) {
      let value = attr.value;
      for (const [old, next] of ids) {
        value = value
          .split(`url(#${old})`)
          .join(`url(#${next})`)
          .split(`url("#${old}")`)
          .join(`url("#${next}")`)
          .split(`url('#${old}')`)
          .join(`url('#${next}')`);
        if (value === `#${old}`) value = `#${next}`;
      }
      if (value !== attr.value) node.setAttribute(attr.name, value);
    }
}
function validateOptions(options: FrameImageOptions) {
  const ratio = options.ratio ?? 4,
    padding = options.padding ?? 20,
    quality = options.quality ?? 0.92;
  if (
    !Number.isFinite(ratio) ||
    ratio <= 0 ||
    !Number.isFinite(padding) ||
    padding < 0 ||
    !Number.isFinite(quality) ||
    quality < 0 ||
    quality > 1
  )
    throw new Error('Invalid image export dimensions or quality');
  return { ratio, padding, quality };
}
/** Uses the canonical renderer and layouts; exporting never edits the live runtime. */
export async function frameSnapshotToImage(
  snapshot: FrameSnapshot,
  options: FrameImageRenderOptions = {},
): Promise<Blob> {
  const { ratio, padding, quality } = validateOptions(options),
    frameId = options.frameId ?? snapshot.store.rootId;
  const frame = snapshot.store.cells[frameId];
  if (!isFrameCell(frame)) throw new Error('Export frame is missing');
  const store = snapshot.store;
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:-100000px;top:0;width:4096px;height:4096px;pointer-events:none;';
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        <FrameCanvas
          documentReferences={options.documentReferences}
          exporting
          value={{ store }}
          autoFit={false}
          frameId={frameId}
          registry={options.registry}
          extensions={options.extensions}
          readonly
          className={options.className}
          style={{ ...options.renderStyle, width: 4096, height: 4096 }}
        />,
      ),
    );
    await document.fonts?.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    const started = performance.now();
    while (host.querySelector('[data-reference-pending="true"]')) {
      if (performance.now() - started > 10000)
        throw new Error('Document preview did not finish rendering for export');
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    const source = host.querySelector('svg');
    if (!source) throw new Error('Frame renderer did not produce SVG');
    const included = options.ids?.length
      ? new Set(
          Object.keys(copyCellFragment(snapshot.store, options.ids).cells),
        )
      : undefined;
    const svg = cloneFrameImageSvg(source, included);
    remapSvgIds(svg);
    host.append(svg);
    await inlineResources(svg);
    const content = svg.querySelector('g') as SVGGElement | null,
      bounds = content?.getBBox() ?? { x: 0, y: 0, width: 0, height: 0 };
    const stroke =
      Math.max(
        0,
        ...Array.from(
          svg.querySelectorAll(
            'path,rect,line,circle,ellipse,polygon,polyline',
          ),
        ).map((node) => {
          const width = parseFloat((node as SVGElement).style.strokeWidth) || 0,
            matrix = (node as SVGGraphicsElement).getCTM();
          return (
            width *
            (matrix
              ? Math.max(
                  Math.hypot(matrix.a, matrix.b),
                  Math.hypot(matrix.c, matrix.d),
                )
              : 1)
          );
        }),
      ) / 2;
    const margin = padding + stroke,
      width = Math.max(1, bounds.width + 2 * margin),
      height = Math.max(1, bounds.height + 2 * margin);
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute(
      'viewBox',
      `${bounds.x - margin} ${bounds.y - margin} ${width} ${height}`,
    );
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    const background =
      options.background ??
      (options.format === 'jpeg' ? '#fff' : 'transparent');
    if (background !== 'transparent' && background !== 'none') {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(bounds.x - margin));
      rect.setAttribute('y', String(bounds.y - margin));
      rect.setAttribute('width', String(width));
      rect.setAttribute('height', String(height));
      rect.setAttribute('fill', background);
      svg.prepend(rect);
    }
    const data = new XMLSerializer().serializeToString(svg);
    if (!options.format || options.format === 'svg')
      return new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
    const rasterWidth = Math.ceil(width * ratio),
      rasterHeight = Math.ceil(height * ratio);
    if (
      rasterWidth > 32767 ||
      rasterHeight > 32767 ||
      rasterWidth * rasterHeight > 100_000_000
    )
      throw new Error('Image is too large; reduce export scale');
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = rasterWidth;
    canvas.height = rasterHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas image export is unavailable');
    context.drawImage(image, 0, 0, rasterWidth, rasterHeight);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Image encoding failed')),
        options.format === 'jpeg' ? 'image/jpeg' : 'image/png',
        quality,
      ),
    );
  } finally {
    root.unmount();
    host.remove();
  }
}
