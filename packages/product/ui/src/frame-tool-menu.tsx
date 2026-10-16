import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from '@floating-ui/react';
import { FrameIconButton } from './frame-icon-button';

export interface FrameToolMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

export function FrameToolMenu({
  label,
  icon,
  items,
  value,
  disabled,
  onChange,
}: {
  label: string;
  icon: LucideIcon;
  items: readonly FrameToolMenuItem[];
  value: string;
  disabled?: boolean;
  onChange(tool: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = items.findIndex((item) => item.id === value);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'right-start',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const click = useClick(context, { enabled: !disabled });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });
  const navigation = useListNavigation(context, {
    listRef,
    activeIndex,
    selectedIndex: selectedIndex < 0 ? null : selectedIndex,
    onNavigate: setActiveIndex,
    focusItemOnOpen: true,
    loop: true,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [click, dismiss, role, navigation],
  );
  useEffect(() => {
    setOpen(false);
  }, [value, disabled]);
  return (
    <>
      <FrameIconButton
        label={label}
        icon={icon}
        pressed={selectedIndex >= 0}
        disabled={disabled}
        onClick={() => {}}
        buttonRef={refs.setReference}
        buttonProps={getReferenceProps()}
        hasPopup
        tooltipDisabled={open}
        tooltipPlacement="right"
      />
      {open && (
        <FloatingPortal>
          <FloatingFocusManager
            context={context}
            modal={false}
            initialFocus={-1}
          >
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="frame-tool-menu"
              {...getFloatingProps({ 'aria-label': label })}
            >
              {items.map(({ id, label, icon: Icon, shortcut }, index) => (
                <button
                  key={id}
                  ref={(node) => {
                    listRef.current[index] = node;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-label={label}
                  aria-keyshortcuts={shortcut}
                  aria-checked={id === value}
                  tabIndex={activeIndex === index ? 0 : -1}
                  {...getItemProps({
                    onClick: () => {
                      onChange(id);
                      setOpen(false);
                    },
                  })}
                >
                  <Icon size={16} aria-hidden />
                  <span>{label}</span>
                  {shortcut && <kbd aria-hidden>{shortcut}</kbd>}
                </button>
              ))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
