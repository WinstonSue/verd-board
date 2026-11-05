import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  X,
  createElement,
  type IconNode,
} from 'lucide';

/** Decorate the Web Component's public controls without replacing its buttons. */
export function applyWorkspaceTabIcons(shadow: ShadowRoot) {
  const icons: readonly [string, IconNode, number][] = [
    ['[part="add-button"]', Plus, 16],
    ['[part="close-button"]', X, 14],
    ['[part="scroll-left-button"]', ChevronLeft, 14],
    ['[part="scroll-right-button"]', ChevronRight, 14],
    ['[part="group-toggle"]', ChevronDown, 14],
    ['.group-row-action:first-child', Pencil, 14],
    ['.group-row-action:last-child', Trash2, 14],
  ];
  for (const [selector, node, size] of icons) {
    for (const control of shadow.querySelectorAll<HTMLElement>(selector)) {
      if (control.firstElementChild?.hasAttribute('data-workspace-lucide'))
        continue;
      const icon = createElement(node, {
        width: size,
        height: size,
        'stroke-width': 1.75,
        'aria-hidden': 'true',
        focusable: 'false',
      });
      icon.setAttribute('data-workspace-lucide', '');
      // The component's original icon rules live inside the shadow boundary.
      Object.assign(icon.style, {
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.75',
        pointerEvents: 'none',
      });
      control.replaceChildren(icon);
    }
  }
}
