import { cloneElement, useId, useState, type ReactElement } from 'react';
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

/** A real disabled control stays disabled; its wrapper receives hover and focus. */
export function FrameTooltip({
  content,
  children,
  disabled = false,
  suppressed = false,
  placement = 'top',
  className = '',
  delay = 120,
}: {
  content?: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  disabled?: boolean;
  suppressed?: boolean;
  placement?: Placement;
  className?: string;
  delay?: number;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const enabled = !!content && !suppressed;
  const visible = open && enabled;
  const { refs, floatingStyles, context } = useFloating({
    open: visible,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, {
      enabled,
      delay: { open: delay, close: 0 },
      move: false,
    }),
    useFocus(context, { enabled, visibleOnly: !disabled }),
    useDismiss(context),
  ]);
  return (
    <span
      className={`frame-tooltip-control ${className}`}
      ref={refs.setReference}
      aria-describedby={disabled && visible ? id : undefined}
      {...getReferenceProps({
        tabIndex: disabled && enabled ? 0 : undefined,
        onKeyDown: (event: React.KeyboardEvent) => {
          if (visible && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        },
      })}
    >
      {cloneElement(children, { 'aria-describedby': visible ? id : undefined })}
      {visible && (
        <FloatingPortal>
          <div
            id={id}
            role="tooltip"
            className="frame-icon-tooltip"
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </span>
  );
}

export function frameDisabledReason(
  reason: string | undefined,
  language: 'zh' | 'en',
): string {
  const messages: Record<string, [string, string]> = {
    pending: ['正在处理，请稍候', 'An operation is in progress; please wait'],
    readonly: ['当前画布为只读', 'This canvas is read-only'],
    locked: [
      '当前对象或所属容器已锁定',
      'The object or its container is locked',
    ],
    'scope-disposed': ['当前画布已关闭', 'This canvas has been closed'],
    'stale-context': [
      '操作目标已改变，请重新打开菜单',
      'The target changed; reopen the menu',
    ],
    disabled: ['当前没有可操作的对象', 'There are no eligible objects'],
  };
  return messages[reason ?? 'disabled']?.[language === 'zh' ? 0 : 1] ?? reason!;
}
