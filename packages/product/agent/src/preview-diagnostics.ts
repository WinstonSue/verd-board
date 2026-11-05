interface PreviewWarning {
  code: string;
  cellId: string;
  message: string;
}

type Bounds = Pick<DOMRectReadOnly, 'left' | 'top' | 'right' | 'bottom'>;
type Direction = 'left' | 'top' | 'right' | 'bottom';
const tolerance = 3;
const directions: Direction[] = ['left', 'top', 'right', 'bottom'];

function overflowDirections(visible: Bounds, content: Bounds[]): Direction[] {
  return directions.filter((side) =>
    content.some((rect) =>
      side === 'left' || side === 'top'
        ? visible[side] - rect[side] > tolerance
        : rect[side] - visible[side] > tolerance,
    ),
  );
}

/** Measure the exported HTML at its native size, outside SVG rotation/scaling. */
function measureTextOverflow(layout: HTMLElement): Direction[] {
  const foreignObject = layout.closest('foreignObject');
  if (!foreignObject) return [];
  const width = Number(foreignObject.getAttribute('width'));
  const height = Number(foreignObject.getAttribute('height'));
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return [];
  const document = layout.ownerDocument;
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
  probe.style.width = `${width}px`;
  probe.style.height = `${height}px`;
  // Export has already frozen computed styles, including inherited typography.
  for (const child of foreignObject.childNodes)
    probe.append(child.cloneNode(true));
  const index = [
    ...foreignObject.querySelectorAll('[data-frame-rich-text]'),
  ].indexOf(layout);
  const measured = probe.querySelectorAll<HTMLElement>(
    '[data-frame-rich-text]',
  )[index];
  const body = measured?.querySelector<HTMLElement>(
    ':scope > .board-text-body',
  );
  if (!measured || !body) return [];
  document.body.append(probe);
  try {
    const visible = measured.getBoundingClientRect();
    if (visible.width <= 0 || visible.height <= 0) return [];
    const range = document.createRange();
    range.selectNodeContents(body);
    // The body detects centered vertical clipping; text ranges also catch
    // horizontal overflow that a full-width block's rectangle would conceal.
    const content = [body.getBoundingClientRect(), ...range.getClientRects()];
    return overflowDirections(visible, content);
  } finally {
    probe.remove();
  }
}

/** Diagnostics for native node text, not intentionally scrollable documents. */
export function collectTextOverflowWarnings(
  root: Element,
  nodeIds: ReadonlySet<string>,
): PreviewWarning[] {
  const overflows = new Map<string, Set<Direction>>();
  for (const layout of root.querySelectorAll<HTMLElement>(
    '[data-frame-rich-text]',
  )) {
    if (
      layout.closest(
        '[data-document-preview-body], [data-document-preview-scroll]',
      )
    )
      continue;
    const cellId = layout
      .closest('[data-cell-id]')
      ?.getAttribute('data-cell-id');
    if (!cellId || !nodeIds.has(cellId)) continue;
    const overflow = measureTextOverflow(layout);
    if (!overflow.length) continue;
    const found = overflows.get(cellId) ?? new Set<Direction>();
    overflow.forEach((side) => found.add(side));
    overflows.set(cellId, found);
  }
  return [...overflows].map(([cellId, found]) => ({
    code: 'visual.text-overflow',
    cellId,
    message: `Rendered text exceeds its visible area (${directions.filter((side) => found.has(side)).join(', ')})`,
  }));
}
