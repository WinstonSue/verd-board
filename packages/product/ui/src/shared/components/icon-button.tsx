import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FrameTooltip } from '../../canvas/toolbar/frame-tooltip';
export function IconButton({
  icon: Icon,
  'aria-label': label,
  className = '',
  tooltip = true,
  ...props
}: Omit<ComponentProps<'button'>, 'aria-label' | 'children'> & {
  'aria-label': string;
  tooltip?: boolean;
  icon: LucideIcon;
}) {
  return (
    <FrameTooltip
      content={label}
      disabled={props.disabled}
      suppressed={!tooltip}
    >
      <button
        type="button"
        {...props}
        aria-label={label}
        className={`vm-icon-btn ${className}`}
      >
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </button>
    </FrameTooltip>
  );
}
