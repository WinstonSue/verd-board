import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  size,
  useFloating,
} from '@floating-ui/react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { usePortalRoot } from '../../shared/components/portal-root';

export interface FrameCommandMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  group: string;
  disabled?: boolean;
  reason?: string;
  shortcut?: string;
  danger?: boolean;
  children?: FrameCommandMenuItem[];
  onSelect?(): void;
}

const enabledButtons = (menu: HTMLElement | null) =>
  menu
    ? [
        ...menu.querySelectorAll<HTMLButtonElement>(
          ':scope > button:not(:disabled)',
        ),
      ]
    : [];
const focusFirst = (menu: HTMLElement | null) =>
  (enabledButtons(menu)[0] ?? menu)?.focus({ preventScroll: true });

/** One command menu and one portaled child; neither owns canvas selection or Actions. */
export function FrameCommandMenu({
  point,
  label,
  items,
  onClose,
}: {
  point: [number, number];
  label: string;
  items: FrameCommandMenuItem[];
  onClose(): void;
}) {
  const portalRoot = usePortalRoot();
  const id = useId();
  const previousFocus = useRef(document.activeElement);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [childId, setChildId] = useState<string | null>(null);
  const focusChild = useRef(false);
  const parentButton = useRef<HTMLButtonElement | null>(null);
  const childItem = items.find((item) => item.id === childId);
  const viewportSize = size({
    padding: 8,
    apply({ elements }) {
      elements.floating.style.maxHeight = `${window.innerHeight - 16}px`;
    },
  });
  const root = useFloating({
    open: true,
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [shift({ padding: 8, crossAxis: true }), viewportSize],
    whileElementsMounted: autoUpdate,
  });
  const child = useFloating({
    open: !!childItem,
    placement: 'right-start',
    strategy: 'fixed',
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8, crossAxis: true }),
      viewportSize,
    ],
    whileElementsMounted: autoUpdate,
  });
  useLayoutEffect(() => {
    root.refs.setPositionReference({
      getBoundingClientRect: () => new DOMRect(point[0], point[1], 0, 0),
    });
  }, [point, root.refs]);
  useEffect(() => {
    focusFirst(root.elements.floating);
  }, [root.elements.floating]);
  useEffect(() => {
    if (child.elements.floating && focusChild.current) {
      focusFirst(child.elements.floating);
      focusChild.current = false;
    }
  }, [child.elements.floating, childId]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (
        path.includes(root.refs.floating.current as EventTarget) ||
        path.includes(child.refs.floating.current as EventTarget)
      )
        return;
      // Preserve the outside target's focus and original pointer gesture.
      closeRef.current();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [root.refs.floating, child.refs.floating]);
  const close = (restoreFocus: boolean) => {
    if (restoreFocus && previousFocus.current?.isConnected)
      (previousFocus.current as HTMLElement | SVGElement).focus?.({
        preventScroll: true,
      });
    onClose();
  };
  const closeChild = () => {
    setChildId(null);
    parentButton.current?.focus({ preventScroll: true });
  };
  const openChild = (
    item: FrameCommandMenuItem,
    button: HTMLButtonElement,
    keyboard: boolean,
  ) => {
    parentButton.current = button;
    child.refs.setReference(button);
    focusChild.current = keyboard;
    setChildId(item.id);
    if (keyboard && childId === item.id && child.elements.floating) {
      focusFirst(child.elements.floating);
      focusChild.current = false;
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>, isChild: boolean) => {
    event.stopPropagation();
    if (event.key === 'Tab') {
      close(false);
      return;
    }
    if (event.key === 'Escape' || (isChild && event.key === 'ArrowLeft')) {
      event.preventDefault();
      if (childId) closeChild();
      else close(true);
      return;
    }
    const buttons = enabledButtons(event.currentTarget);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!isChild) setChildId(null);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) %
              buttons.length;
      buttons[next]?.focus();
      return;
    }
    if (event.key === 'ArrowRight' && !isChild) {
      const item = items.find(
        (item) => item.id === buttons[index]?.dataset['itemId'],
      );
      if (item?.children) {
        event.preventDefault();
        openChild(item, buttons[index], true);
      }
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      buttons[index]?.click();
    }
  };
  const renderItems = (entries: FrameCommandMenuItem[], isChild: boolean) =>
    entries.map((item, index) => (
      <button
        type="button"
        role="menuitem"
        key={item.id}
        data-item-id={item.id}
        data-action-id={item.onSelect ? item.id : undefined}
        data-group-start={
          index > 0 && item.group !== entries[index - 1].group ? '' : undefined
        }
        data-danger={item.danger || undefined}
        aria-label={item.label}
        aria-haspopup={item.children ? 'menu' : undefined}
        aria-expanded={item.children ? childId === item.id : undefined}
        aria-controls={
          item.children && childId === item.id ? `${id}-child` : undefined
        }
        disabled={item.disabled}
        title={item.reason}
        tabIndex={-1}
        onPointerEnter={(event) => {
          if (isChild) return;
          if (item.children && !item.disabled)
            openChild(item, event.currentTarget, false);
          else setChildId(null);
        }}
        onFocus={() => {
          if (!isChild && childId !== item.id) setChildId(null);
        }}
        onClick={(event) => {
          if (item.children) openChild(item, event.currentTarget, true);
          else {
            close(true);
            item.onSelect?.();
          }
        }}
      >
        <item.icon size={16} aria-hidden />
        <span>{item.label}</span>
        {item.children ? (
          <ChevronRight size={14} aria-hidden />
        ) : item.shortcut ? (
          <kbd aria-hidden>{item.shortcut}</kbd>
        ) : null}
      </button>
    ));
  return (
    <FloatingPortal root={portalRoot}>
      <div
        ref={root.refs.setFloating}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        className="frame-actions-popover"
        style={root.floatingStyles}
        onKeyDown={(event) => keyDown(event, false)}
        onContextMenu={(event) => event.preventDefault()}
        onScroll={() => setChildId(null)}
      >
        {renderItems(items, false)}
      </div>
      {childItem?.children && (
        <div
          ref={child.refs.setFloating}
          id={`${id}-child`}
          role="menu"
          aria-label={childItem.label}
          tabIndex={-1}
          className="frame-actions-popover frame-actions-popover--submenu"
          style={child.floatingStyles}
          onKeyDown={(event) => keyDown(event, true)}
          onContextMenu={(event) => event.preventDefault()}
        >
          {renderItems(childItem.children, true)}
        </div>
      )}
    </FloatingPortal>
  );
}
