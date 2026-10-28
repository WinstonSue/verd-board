import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
export interface FrameMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  run(): void;
}
/** A menu belongs to its editor; focus and dismissal never use a global command registry. */
export function FrameMenu({
  point,
  items,
  onClose,
}: {
  point: [number, number];
  items: readonly FrameMenuItem[];
  onClose(): void;
}) {
  const root = useRef<HTMLDivElement>(null),
    previous = useRef(document.activeElement);
  const [position, setPosition] = useState(point);
  useLayoutEffect(() => {
    const bounds = root.current!.getBoundingClientRect();
    setPosition([
      Math.max(0, Math.min(point[0], window.innerWidth - bounds.width)),
      Math.max(0, Math.min(point[1], window.innerHeight - bounds.height)),
    ]);
    root.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus();
  }, [point]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [onClose]);
  const close = () => {
    onClose();
    (previous.current as HTMLElement | null)?.focus?.();
  };
  return createPortal(
    <div
      ref={root}
      role="menu"
      tabIndex={-1}
      className="frame-editor__menu"
      style={{
        position: 'fixed',
        left: position[0],
        top: position[1],
        zIndex: 1000,
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
          return;
        }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        const buttons = [
          ...root.current!.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          ),
        ];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (at + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) %
                buttons.length
        ]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          type="button"
          role="menuitem"
          key={item.id}
          disabled={item.disabled}
          onClick={() => {
            item.run();
            close();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
