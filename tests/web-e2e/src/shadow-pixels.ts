import { expect, type Locator, type Page } from '@playwright/test';

/** Rasterize the live interaction filter on isolated primitives, without app state changes. */
export async function interactionShadowPixels(
  outline: Locator,
  background: string,
  opacity: number,
) {
  return outline.evaluate(
    async (element, { background, opacity }) => {
      const shape = element as SVGGraphicsElement;
      const matrix = shape.getScreenCTM()!;
      const scale = Math.hypot(matrix.a, matrix.b);
      const filter = document
        .getElementById(shape.getAttribute('filter')!.slice(5, -1))!
        .cloneNode(true) as SVGFilterElement;
      const ns = 'http://www.w3.org/2000/svg';
      const make = (tag: string, attrs: Record<string, string | number>) => {
        const node = document.createElementNS(ns, tag);
        for (const [key, value] of Object.entries(attrs))
          node.setAttribute(key, String(value));
        return node;
      };
      const svg = make('svg', { xmlns: ns, width: 300, height: 340 });
      filter.id = 'shadow-probe';
      for (const [name, value] of Object.entries({
        x: -12 / scale,
        y: -12 / scale,
        width: 324 / scale,
        height: 364 / scale,
      }))
        filter.setAttribute(name, String(value));
      const defs = make('defs', {});
      defs.append(filter);
      svg.append(
        defs,
        make('rect', { width: 300, height: 340, fill: background }),
      );
      const group = make('g', {
        transform: `scale(${scale})`,
        fill: 'none',
        stroke: '#6366f1',
      });
      svg.append(group);
      const samples: { width: number; state: string; x: number; y: number }[] =
        [];
      for (const [at, width] of [1, 1.5, 2, 8].entries()) {
        const y = at * 80;
        const primitives = [
          {
            tag: 'rect',
            state: 'selected',
            stroke: width + 1,
            x: 60,
            attrs: {
              x: 20 / scale,
              y: (y + 22.5 + ((width + 1) * scale) / 2) / scale,
              width: 80 / scale,
              height: 40 / scale,
            },
          },
          {
            tag: 'path',
            state: 'related',
            stroke: width,
            x: 200,
            attrs: {
              d: `M${140 / scale} ${(y + 22.5 + (width * scale) / 2) / scale} L${260 / scale} ${(y + 22.5 + (width * scale) / 2) / scale}`,
            },
          },
        ];
        for (const primitive of primitives) {
          group.append(
            make(primitive.tag, {
              ...primitive.attrs,
              'stroke-width': width,
              opacity,
            }),
          );
          group.append(
            make(primitive.tag, {
              ...primitive.attrs,
              'stroke-width': primitive.stroke,
              filter: 'url(#shadow-probe)',
              'data-shadow-probe': '',
            }),
          );
          // Both outer stroke boundaries sit at y + 22.5. Pixel centers at
          // y + 20.5 are exactly 2 CSS pixels beyond those boundaries.
          samples.push({
            width,
            state: primitive.state,
            x: primitive.x,
            y: y + 20,
          });
        }
      }
      const raster = async () => {
        const image = new Image();
        const loaded = new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () =>
            reject(new Error('Cannot rasterize interaction shadow probe'));
        });
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
        await loaded;
        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 340;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, 0);
        return samples.map(({ x, y }) =>
          Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3),
        );
      };
      const on = await raster();
      svg
        .querySelectorAll('[data-shadow-probe]')
        .forEach((node) => node.removeAttribute('filter'));
      const off = await raster();
      return samples.map((sample, at) => ({
        ...sample,
        scale,
        on: on[at],
        off: off[at],
        difference: Math.max(
          ...on[at].map((channel, color) => Math.abs(channel - off[at][color])),
        ),
      }));
    },
    { background, opacity },
  );
}

export async function setCanvasZoom(page: Page, percentage: number) {
  const label = page.getByTestId('canvas-zoom-label').locator('visible=true');
  const current = parseInt((await label.textContent())!, 10);
  const steps = Math.round((percentage - current) / 10);
  const button = page
    .getByTestId(steps > 0 ? 'canvas-zoom-in' : 'canvas-zoom-out')
    .locator('visible=true');
  for (let at = 0; at < Math.abs(steps); at++) await button.click();
  await expect(label).toHaveText(`${percentage}%`);
}
