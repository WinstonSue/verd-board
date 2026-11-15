import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef, Ref } from 'react';
import type { Placement } from '@floating-ui/react';
import { FrameTooltip } from './frame-tooltip';

/** Icon control whose accessible name stays the short label used by tests. */
export function FrameIconButton({
  label,
  title,
  pressed,
  disabled,
  onClick,
  icon: Icon,
  testId,
  actionId,
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
  actionId?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  buttonProps?: ComponentPropsWithoutRef<'button'>;
  hasPopup?: boolean;
  tooltipDisabled?: boolean;
  tooltipPlacement?: Placement;
}) {
  return (
    <FrameTooltip
      content={title ?? label}
      disabled={disabled}
      suppressed={tooltipDisabled}
      placement={tooltipPlacement}
      delay={disabled ? 120 : 400}
      className="frame-tool-control"
    >
      <button
        ref={buttonRef}
        type="button"
        className="frame-tool-button"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        data-testid={testId}
        data-action-id={actionId}
        onClick={onClick}
        {...buttonProps}
      >
        <Icon size={18} strokeWidth={1.75} aria-hidden />
        {hasPopup && (
          <ChevronDown
            strokeWidth={1.75}
            className="frame-tool-menu-caret"
            size={8}
            aria-hidden
          />
        )}
      </button>
    </FrameTooltip>
  );
}
