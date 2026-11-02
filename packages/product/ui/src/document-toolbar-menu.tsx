import { ChevronDown } from 'lucide-react';
import { usePortalRoot } from './components/portal-root';
import { flushSync } from 'react-dom';
import { useState, useRef, useCallback, type ReactNode } from 'react';
import {
  autoUpdate,
  flip,
  shift,
  offset,
  useFloating,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  FloatingFocusManager,
} from '@floating-ui/react';
export function DocumentToolbarMenu({
  label,
  children,
  onOpen,
  buttonRef,
}: {
  label: string;
  children(close: () => void): ReactNode;
  onOpen?(): void;
  buttonRef?(node: HTMLButtonElement | null): void;
}) {
  const portalRoot = usePortalRoot();
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange(value) {
      if (value) onOpen?.();
      setOpen(value);
    },
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip(), shift({ padding: 8 })],
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
    useDismiss(context),
    useRole(context, { role: 'dialog' }),
  ]);
  return (
    <>
      <button
        type="button"
        className="doc-toolbar__menu-trigger"
        aria-label={label}
        ref={setReference}
        {...getReferenceProps()}
      >
        {label}
        <ChevronDown size={14} aria-hidden />
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
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    flushSync(() => setOpen(false));
                    (refs.domReference.current as HTMLElement | null)?.focus();
                  }
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    const controls = [
                      ...event.currentTarget.querySelectorAll<HTMLElement>(
                        'button:not(:disabled), input, select',
                      ),
                    ];
                    const index = controls.indexOf(
                      document.activeElement as HTMLElement,
                    );
                    if ((event.target as Element).tagName === 'SELECT') return;
                    event.preventDefault();
                    controls[
                      (index +
                        (event.key === 'ArrowDown' ? 1 : -1) +
                        controls.length) %
                        controls.length
                    ]?.focus();
                  }
                },
              })}
            >
              {children(() => flushSync(() => setOpen(false)))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
