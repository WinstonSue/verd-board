import { useWorkspaceDesignVariables } from './workspace-design';
import { usePortalRoot } from './components/portal-root';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useActionSource, type ActionSource } from '@sue/board-react-actions';
import type { WorkspaceActionBinding } from './workspace-action-bindings';
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
  checked?: boolean;
  groupStart?: boolean;
  groupLabel?: string;
  disabled?: boolean;
  testId?: string;
  title?: string;
  onSelect(): void;
  action?: WorkspaceActionBinding;
}

export function FileTreeMenu({
  label,
  anchor,
  items,
  onClose,
  placement,
  actionSource,
  locale = 'zh',
  onError,
  preserveItemLabels = false,
  className,
  portalRoot,
}: {
  label: string;
  anchor: HTMLElement | { x: number; y: number };
  items: FileTreeMenuItem[];
  onClose(): void;
  placement?: 'bottom-start' | 'bottom-end';
  actionSource?: ActionSource;
  locale?: 'zh' | 'en';
  onError?(message: string): void;
  /** Contextual navigation labels may include the source and instance name. */
  preserveItemLabels?: boolean;
  className?: string;
  portalRoot?: HTMLElement | null;
}) {
  const inheritedRoot = usePortalRoot();
  const designVariables = useWorkspaceDesignVariables();
  useActionSource(actionSource);
  items = items.flatMap((item) => {
    if (!item.action) return [item];
    const state = item.action.getState();
    return state.visible
      ? [
          {
            ...item,
            label: preserveItemLabels ? item.label : item.action.label(locale),
            disabled: !state.enabled,
          },
        ]
      : [];
  });
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
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (
        path.includes(refs.floating.current as EventTarget) ||
        (anchor instanceof HTMLElement && path.includes(anchor))
      )
        return;
      flushSync(() => setReturnFocus(false));
      closeRef.current();
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    return () =>
      document.removeEventListener('pointerdown', dismissOutside, true);
  }, [anchor, refs.floating]);
  const dismiss = useDismiss(context, { outsidePress: false });
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
    <FloatingPortal
      root={portalRoot !== undefined ? portalRoot : inheritedRoot}
    >
      <FloatingFocusManager
        context={context}
        modal={false}
        initialFocus={-1}
        returnFocus={returnFocus}
      >
        <div
          ref={refs.setFloating}
          style={{ ...designVariables, ...floatingStyles }}
          className={['workspace-menu', className].filter(Boolean).join(' ')}
          {...getFloatingProps({ 'aria-label': label })}
        >
          {items.map((item, index) => (
            <Fragment key={item.id}>
              {item.groupLabel ? (
                <div
                  className="workspace-menu-group-label"
                  title={item.groupLabel}
                >
                  {item.groupLabel}
                </div>
              ) : null}
              <button
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                key={item.id}
                disabled={item.disabled}
                data-testid={item.testId}
                title={item.title}
                data-action-id={item.action?.id}
                ref={(node) => {
                  listRef.current[index] = node;
                }}
                tabIndex={activeIndex === index ? 0 : -1}
                data-danger={item.danger || undefined}
                data-group-start={item.groupStart ? '' : undefined}
                {...getItemProps({
                  onClick: () => {
                    if (item.disabled) return;
                    flushSync(() => setReturnFocus(false));
                    onClose();
                    if (item.action)
                      void item.action.execute().then((result) => {
                        if ('code' in result && result.status !== 'cancelled')
                          onError?.(result.message ?? result.code);
                      });
                    else item.onSelect();
                  },
                })}
              >
                <item.icon
                  size={16}
                  aria-hidden
                  className={
                    item.checked === false
                      ? 'workspace-menu-icon--unchecked'
                      : undefined
                  }
                />
                <span>{item.label}</span>
              </button>
            </Fragment>
          ))}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
