import { useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { FrameIconButton } from './frame-icon-button';

/** Parameter forms stay outside the scrollable tool rail. */
export function FrameToolPopover({
  label,
  title,
  icon,
  disabled,
  actionId,
  children,
}: {
  label: string;
  title?: string;
  icon: LucideIcon;
  disabled?: boolean;
  actionId?: string;
  children(close: () => void): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'right-start',
    strategy: 'fixed',
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, availableWidth, elements }) {
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
          elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });
  const click = useClick(context, { enabled: !disabled });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <>
      <FrameIconButton
        label={label}
        title={title}
        icon={icon}
        actionId={actionId}
        disabled={disabled}
        hasPopup
        tooltipPlacement="right"
        tooltipDisabled={open}
        buttonRef={refs.setReference}
        buttonProps={getReferenceProps()}
        onClick={() => {}}
      />
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              className="frame-tool-popover"
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps({
                'aria-label': label,
                onKeyDown: (event) => event.stopPropagation(),
              })}
            >
              <div className="frame-tool-popover__title">{label}</div>
              {children(() => setOpen(false))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
