import { AllSelection, TextSelection, type Selection } from '@tiptap/pm/state';

export function hasDocumentTextSelection(selection: Selection): boolean {
  return (
    !selection.empty &&
    (selection instanceof TextSelection || selection instanceof AllSelection) &&
    selection.$from.doc.textBetween(selection.from, selection.to).length > 0
  );
}

const contexts = new WeakMap<Document, CanvasRenderingContext2D>();
function markerWidth(text: string, font: string, document: Document) {
  let context = contexts.get(document);
  if (!context) {
    context = document.createElement('canvas').getContext('2d') ?? undefined;
    if (context) contexts.set(document, context);
  }
  if (!context) return text.length * 16;
  context.font = font;
  return context.measureText(text).width;
}

/** Keep list markers and fold widgets outside the block handle's hit area. */
export function documentBlockHandleLeft(
  element: HTMLElement,
  measure: typeof markerWidth = markerWidth,
): number {
  let left = element.getBoundingClientRect().left;
  const item = element.closest('li');
  const list = item?.parentElement;
  if (item && list?.matches('ul, ol')) {
    left = Math.min(left, list.getBoundingClientRect().left);
    const fold = item.querySelector<HTMLElement>(
      ':scope > .document-list-fold',
    );
    if (fold?.getBoundingClientRect().width)
      left = Math.min(left, fold.getBoundingClientRect().left);
    if (list instanceof HTMLOListElement) {
      const index = [...list.children]
        .filter((child) => child.tagName === 'LI')
        .indexOf(item);
      const number = item.hasAttribute('value')
        ? item.value
        : list.start + (list.reversed ? -index : index);
      const style = getComputedStyle(item, '::marker');
      const inherited = getComputedStyle(item);
      const font = style.font || inherited.font;
      const gap = parseFloat(style.fontSize || inherited.fontSize) / 2;
      left = Math.min(
        left,
        item.getBoundingClientRect().left -
          measure(`${number}.`, font, element.ownerDocument) -
          gap,
      );
    }
  }
  return Math.max(4, left - 24 - 4);
}
