import { useRef, useState, type RefObject, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
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
  useListNavigation,
  useRole,
} from '@floating-ui/react';
import { FrameIconButton } from './frame-icon-button';
import {
  formatActionShortcut,
  useActionSource,
  type ActionSource,
} from '@sue/board-react-actions';
import { useI18n } from './i18n';

export interface FrameAppMenuItem {
  id: string;
  actionId?: string;
  label: string;
  icon: LucideIcon;
  group: string;
  disabled?: boolean;
  shortcut?: string;
  onSelect(): void | Promise<void>;
}

export function FrameAppMenu({
  items,
  buttonRef,
  onOpen,
  source,
}: {
  items: readonly FrameAppMenuItem[];
  source?: ActionSource;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onOpen(): void;
}) {
  const { t } = useI18n();
  useActionSource(source);
  items = items.map((item) => {
    const action = item.actionId
      ? source?.actions().find((action) => action.id === item.actionId)
      : undefined;
    if (!action) return item;
    const state = action.getState();
    return {
      ...item,
      disabled: !state.visible || !state.enabled,
      shortcut:
        action.shortcuts
          ?.map((shortcut) => formatActionShortcut(shortcut))
          .join(' / ') || item.shortcut,
    };
  });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [returnFocus, setReturnFocus] = useState(true);
  const listRef = useRef<Array<HTMLButtonElement | null>>([]);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange(next) {
      if (next) {
        setReturnFocus(true);
        onOpen();
      }
      setOpen(next);
    },
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [
      offset(8),
      flip(),
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
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });
  const navigation = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    focusItemOnOpen: true,
    disabledIndices: items.flatMap((item, index) =>
      item.disabled ? [index] : [],
    ),
    loop: true,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [click, dismiss, role, navigation],
  );
  return (
    <>
      <FrameIconButton
        label={t('general.more')}
        icon={MoreHorizontal}
        testId="app-menu-trigger"
        hasPopup
        tooltipDisabled={open}
        onClick={() => {}}
        buttonRef={(node) => {
          buttonRef.current = node;
          refs.setReference(node);
        }}
        buttonProps={getReferenceProps({
          onMouseDown: (event: MouseEvent) => event.preventDefault(),
        })}
      />
      {open && (
        <FloatingPortal>
          <FloatingFocusManager
            context={context}
            modal={false}
            initialFocus={-1}
            returnFocus={returnFocus}
          >
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="frame-app-menu"
              {...getFloatingProps({ 'aria-label': t('general.more') })}
            >
              {items.map(
                (
                  {
                    id,
                    label,
                    icon: Icon,
                    disabled,
                    shortcut,
                    group,
                    onSelect,
                  },
                  index,
                ) => (
                  <button
                    key={id}
                    ref={(node) => {
                      listRef.current[index] = node;
                    }}
                    type="button"
                    role="menuitem"
                    disabled={disabled}
                    data-group-start={
                      index > 0 && group !== items[index - 1].group
                        ? ''
                        : undefined
                    }
                    aria-label={label}
                    tabIndex={activeIndex === index ? 0 : -1}
                    {...getItemProps({
                      onClick: () => {
                        // Commit before unmount so the menu's focus manager
                        // cannot steal focus from the action's newly opened panel.
                        // Keep execution in this event stack for user activation.
                        flushSync(() => setReturnFocus(false));
                        setOpen(false);
                        onSelect();
                      },
                    })}
                  >
                    <Icon size={16} aria-hidden />
                    <span>{label}</span>
                    {shortcut && <kbd aria-hidden>{shortcut}</kbd>}
                  </button>
                ),
              )}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
