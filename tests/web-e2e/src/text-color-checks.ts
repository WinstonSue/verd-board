import { expect, type Locator } from '@playwright/test';

// Browser-only checks inspect the final HTML leaf color, rather than the
// palette/resolver values that missed the original inline-mark regression.
export function textColorSamples(root: Element) {
  const rgb = (value: string): number[] => {
    if (value.startsWith('#')) {
      const hex =
        value.length === 4
          ? value
              .slice(1)
              .split('')
              .map((c) => c + c)
              .join('')
          : value.slice(1);
      return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
    }
    return (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  };
  const opaque = (value: string) =>
    !!value &&
    value !== 'transparent' &&
    value !== 'none' &&
    !/rgba\([^)]*,\s*0\s*\)/.test(value);
  const luminance = (channels: number[]) =>
    channels
      .map((c) => c / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, at) => sum + c * [0.2126, 0.7152, 0.0722][at], 0);
  return [
    ...root.querySelectorAll<HTMLElement>('span[data-board-original-color]'),
  ]
    .filter(
      (leaf) =>
        leaf.getClientRects().length > 0 &&
        getComputedStyle(leaf).visibility !== 'hidden',
    )
    .map((leaf) => {
      const svg = leaf.closest('svg');
      let background = '';
      for (
        let node: Element | null = leaf;
        node && node !== svg;
        node = node.parentElement
      ) {
        const value = getComputedStyle(node).backgroundColor;
        if (opaque(value)) {
          background = value;
          break;
        }
      }
      if (!background && svg) {
        const tableEntry = leaf.closest('[data-table-entry]');
        const cell = leaf.closest('[data-cell-id]');
        const shape =
          tableEntry?.querySelector('rect') ??
          leaf.closest('[data-frame-header]')?.querySelector('rect') ??
          cell?.querySelector(
            '[data-frame-shell], [data-frame-node-outline], [data-uml-class] > rect, [data-uml-lifeline] > rect',
          );
        const fill = shape
          ? getComputedStyle(shape).fill
          : cell?.getAttribute('fill');
        if (!leaf.closest('[data-edge-label]') && fill && opaque(fill))
          background = fill;
        else {
          const rootBackground = getComputedStyle(svg).backgroundColor;
          const exportPlate = svg.querySelector(':scope > rect');
          background = opaque(rootBackground)
            ? rootBackground
            : exportPlate
              ? getComputedStyle(exportPlate).fill
              : '#ffffff';
        }
      }
      background ||= '#ffffff';
      let opacity = 1;
      for (let node: Element | null = leaf; node; node = node.parentElement)
        opacity *= Number(getComputedStyle(node).opacity || 1);
      const foreground = rgb(getComputedStyle(leaf).color),
        bg = rgb(background);
      const visible = foreground.map(
        (c, at) => c * opacity + bg[at] * (1 - opacity),
      );
      const a = luminance(visible),
        b = luminance(bg);
      return {
        text: leaf.textContent?.slice(0, 45),
        color: getComputedStyle(leaf).color,
        background,
        opacity,
        source: leaf.getAttribute('data-board-color-source'),
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    })
    .filter((sample) => sample.opacity > 0);
}
export async function readable(root: Locator) {
  await expect
    .poll(async () => {
      const samples = await root.evaluate(textColorSamples);
      if (!samples.length) return ['No actual text leaves'];
      return samples.filter(
        (sample) =>
          sample.source !== 'custom' &&
          (!Number.isFinite(sample.ratio) || sample.ratio < 4.5),
      );
    })
    .toEqual([]);
}
