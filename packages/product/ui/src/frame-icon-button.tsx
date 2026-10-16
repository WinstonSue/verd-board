import { ChevronDown, type LucideIcon } from 'lucide-react';
import {
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type Ref,
} from 'react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  type Placement,
} from '@floating-ui/react';

/** Icon control whose accessible name stays the short label used by tests. */
export function FrameIconButton({
  label,
  title,
  pressed,
  disabled,
  onClick,
  icon: Icon,
  testId,
  buttonRef,
  buttonProps,
  hasPopup,
  tooltipDisabled = false,
  tooltipPlacement = 'top',
}: {
  label: string;
  title?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick(): void;
  icon: LucideIcon;
  testId?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  buttonProps?: ComponentPropsWithoutRef<'button'>;
  hasPopup?: boolean;
  tooltipDisabled?: boolean;
  tooltipPlacement?: Placement;
}) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const { refs, floatingStyles, context } = useFloating({
    open: open && !tooltipDisabled,
    onOpenChange: setOpen,
    placement: tooltipPlacement,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, {
    delay: { open: 400, close: 0 },
    move: false,
    enabled: !tooltipDisabled,
  });
  const focus = useFocus(context, { enabled: !tooltipDisabled });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
  ]);
  return (
    <span
      className="frame-tool-control"
      ref={refs.setReference}
      {...getReferenceProps()}
    >
      <button
        ref={buttonRef}
        type="button"
        className="frame-tool-button"
        aria-label={label}
        aria-pressed={pressed}
        aria-describedby={open && !tooltipDisabled ? tooltipId : undefined}
        disabled={disabled}
        data-testid={testId}
        onClick={onClick}
        {...buttonProps}
      >
        <Icon size={16} aria-hidden />
        {hasPopup && (
          <ChevronDown className="frame-tool-menu-caret" size={8} aria-hidden />
        )}
      </button>
      {open && !tooltipDisabled && (
        <FloatingPortal>
          <div
            id={tooltipId}
            role="tooltip"
            className="frame-icon-tooltip"
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {title ?? label}
          </div>
        </FloatingPortal>
      )}
    </span>
  );
}
