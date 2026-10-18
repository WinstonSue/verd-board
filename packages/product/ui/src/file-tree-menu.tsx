import { useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from '@floating-ui/react';

export interface FileTreeMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  groupStart?: boolean;
  disabled?: boolean;
  testId?: string;
  onSelect(): void;
}

export function FileTreeMenu({
  label,
  anchor,
  items,
  onClose,
  placement,
}: {
  label: string;
  anchor: HTMLElement | { x: number; y: number };
  items: FileTreeMenuItem[];
  onClose(): void;
  placement?: 'bottom-start' | 'bottom-end';
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [returnFocus, setReturnFocus] = useState(true);
  const listRef = useRef<Array<HTMLButtonElement | null>>([]);
  const elementAnchor = anchor instanceof HTMLElement;
  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    placement: placement ?? (elementAnchor ? 'bottom-end' : 'bottom-start'),
    strategy: 'fixed',
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });
  useLayoutEffect(() => {
    if (anchor instanceof HTMLElement) refs.setReference(anchor);
    else
      refs.setPositionReference({
        getBoundingClientRect: () => ({
          x: anchor.x,
          y: anchor.y,
          top: anchor.y,
          bottom: anchor.y,
          left: anchor.x,
          right: anchor.x,
          width: 0,
          height: 0,
        }),
      });
  }, [anchor, refs]);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });
  const navigation = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
    disabledIndices: items.flatMap((item, index) =>
      item.disabled ? [index] : [],
    ),
    focusItemOnOpen: true,
  });
  const { getFloatingProps, getItemProps } = useInteractions([
    dismiss,
    role,
    navigation,
  ]);
  return (
    <FloatingPortal>
      <FloatingFocusManager
        context={context}
        modal={false}
        initialFocus={-1}
        returnFocus={returnFocus}
      >
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          className="workspace-menu"
          {...getFloatingProps({ 'aria-label': label })}
        >
          {items.map((item, index) => (
            <button
              type="button"
              role="menuitem"
              key={item.id}
              disabled={item.disabled}
              data-testid={item.testId}
              ref={(node) => {
                listRef.current[index] = node;
              }}
              tabIndex={activeIndex === index ? 0 : -1}
              data-danger={item.danger || undefined}
              data-group-start={item.groupStart ? '' : undefined}
              {...getItemProps({
                onClick: () => {
                  if (item.disabled) return;
                  setReturnFocus(false);
                  onClose();
                  item.onSelect();
                },
              })}
            >
              <item.icon size={15} aria-hidden />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
