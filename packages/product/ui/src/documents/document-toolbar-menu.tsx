import { ChevronDown, ChevronRight, Ellipsis, Plus } from 'lucide-react';
import { usePortalRoot } from '../shared/components/portal-root';
import { flushSync } from 'react-dom';
import {
  useState,
  useRef,
  useCallback,
  useId,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  autoUpdate,
  flip,
  shift,
  offset,
  size,
  useFloating,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  FloatingFocusManager,
} from '@floating-ui/react';

function moveMenuFocus(event: KeyboardEvent<HTMLElement>) {
  if (
    (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') ||
    (event.target as Element).tagName === 'SELECT'
  )
    return;
  const controls = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input, select',
    ),
  ];
  if (!controls.length) return;
  event.preventDefault();
  event.stopPropagation();
  const index = controls.indexOf(document.activeElement as HTMLElement);
  const next =
    index === -1
      ? event.key === 'ArrowDown'
        ? 0
        : controls.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) %
        controls.length;
  controls[next]?.focus();
}

export function DocumentToolbarMenu({
  label,
  iconOnly = false,
  children,
  onOpen,
  buttonRef,
  secondary,
}: {
  label: string;
  iconOnly?: boolean;
  children(close: () => void): ReactNode;
  onOpen?(): void;
  buttonRef?(node: HTMLButtonElement | null): void;
  secondary?: {
    label: string;
    render(close: () => void): ReactNode;
  };
}) {
  const portalRoot = usePortalRoot();
  const [open, setOpen] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const secondaryId = useId();
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange(value) {
      if (value) onOpen?.();
      setSecondaryOpen(false);
      setOpen(value);
    },
    placement: iconOnly ? 'bottom-end' : 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip(), shift({ padding: 8 })],
  });
  const submenu = useFloating({
    open: secondaryOpen,
    placement: 'right-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ padding: 8, fallbackAxisSideDirection: 'end' }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, availableWidth, elements }) {
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
          elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
        },
      }),
    ],
  });
  const latestButtonRef = useRef(buttonRef);
  latestButtonRef.current = buttonRef;
  const setFloatingReference = refs.setReference;
  const setReference = useCallback(
    (node: HTMLButtonElement | null) => {
      setFloatingReference(node);
      latestButtonRef.current?.(node);
    },
    [setFloatingReference],
  );
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context, { escapeKey: !secondaryOpen }),
    useRole(context, { role: 'dialog' }),
  ]);
  const close = () =>
    flushSync(() => {
      setOpen(false);
      setSecondaryOpen(false);
    });
  const closeSecondary = () => {
    flushSync(() => setSecondaryOpen(false));
    (submenu.refs.domReference.current as HTMLElement | null)?.focus();
  };
  return (
    <>
      <button
        type="button"
        className="doc-toolbar__menu-trigger"
        aria-label={label}
        title={iconOnly ? label : undefined}
        ref={setReference}
        {...getReferenceProps({
          onMouseDown: (event: MouseEvent) => event.preventDefault(),
        })}
      >
        {iconOnly ? (
          <Ellipsis strokeWidth={1.75} size={16} aria-hidden />
        ) : (
          <>
            {label}
            <ChevronDown strokeWidth={1.75} size={14} aria-hidden />
          </>
        )}
      </button>
      {open && (
        <FloatingPortal root={portalRoot}>
          <FloatingFocusManager
            context={context}
            modal={false}
            returnFocus={false}
          >
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="doc-toolbar-menu"
              {...getFloatingProps({
                'aria-label': label,
                onKeyDown(event) {
                  if (
                    event.key === 'Escape' ||
                    (event.key === 'ArrowLeft' && secondaryOpen)
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (secondaryOpen) closeSecondary();
                    else {
                      close();
                      (
                        refs.domReference.current as HTMLElement | null
                      )?.focus();
                    }
                    return;
                  }
                  moveMenuFocus(event);
                },
              })}
            >
              {secondary && (
                <button
                  ref={submenu.refs.setReference}
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={secondaryOpen}
                  aria-controls={secondaryOpen ? secondaryId : undefined}
                  onClick={() =>
                    secondaryOpen ? closeSecondary() : setSecondaryOpen(true)
                  }
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    if (secondaryOpen)
                      submenu.refs.floating.current
                        ?.querySelector<HTMLElement>('button:not(:disabled)')
                        ?.focus();
                    else setSecondaryOpen(true);
                  }}
                >
                  <Plus strokeWidth={1.75} size={16} aria-hidden />
                  <span>{secondary.label}</span>
                  <ChevronRight strokeWidth={1.75} size={14} aria-hidden />
                </button>
              )}
              {children(close)}
              {secondary && secondaryOpen && (
                <FloatingPortal>
                  <FloatingFocusManager
                    context={submenu.context}
                    modal={false}
                    returnFocus={false}
                    closeOnFocusOut={false}
                  >
                    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The dialog routes keyboard navigation between its child controls. */}
                    <div
                      id={secondaryId}
                      ref={submenu.refs.setFloating}
                      style={submenu.floatingStyles}
                      className="doc-toolbar-menu doc-toolbar-submenu"
                      role="dialog"
                      aria-label={secondary.label}
                      onKeyDown={(event) => {
                        if (
                          event.key === 'Escape' ||
                          event.key === 'ArrowLeft'
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                          closeSecondary();
                          return;
                        }
                        moveMenuFocus(event);
                      }}
                    >
                      {secondary.render(close)}
                    </div>
                  </FloatingFocusManager>
                </FloatingPortal>
              )}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
