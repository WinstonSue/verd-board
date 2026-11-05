import { ChevronDown, ChevronRight, createElement } from 'lucide';

/** Decorations and static previews share Lucide without mounting React roots. */
export function setFoldIcon(button: HTMLElement, collapsed: boolean) {
  if (
    button.dataset['foldCollapsed'] === String(collapsed) &&
    button.firstElementChild
  )
    return;
  const icon = createElement(collapsed ? ChevronRight : ChevronDown, {
    width: '14',
    height: '14',
    'stroke-width': '1.75',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  icon.classList.add('document-fold-icon');
  button.replaceChildren(icon);
  button.dataset['foldCollapsed'] = String(collapsed);
}
