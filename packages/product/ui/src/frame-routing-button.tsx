import { useActionSource } from '@sue/board-react-actions';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { ChevronDown } from 'lucide-react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  FloatingFocusManager,
  offset,
  shift,
  useFloating,
} from '@floating-ui/react';
import type { FrameCanvasController } from '@sue/board-react';
import { useI18n } from './i18n';
import { FrameTooltip, frameDisabledReason } from './frame-tooltip';

type Mode = 'optimize' | 'reset';
const initialState = { mode: 'optimize' as Mode, executing: false };
const sessions = new WeakMap<
  object,
  { value: typeof initialState; listeners: Set<() => void> }
>();
const fallback = {};
export function FrameRoutingButton({
  controller,
}: {
  controller?: FrameCanvasController | null;
}) {
  const { language } = useI18n();
  useActionSource(controller?.actionSource);
  const zh = language === 'zh';
  const owner = controller?.runtime ?? controller ?? fallback;
  let session = sessions.get(owner);
  if (!session) {
    session = { value: initialState, listeners: new Set() };
    sessions.set(owner, session);
  }
  const current = session;
  const { mode, executing } = useSyncExternalStore(
    (listener) => {
      current.listeners.add(listener);
      return () => {
        current.listeners.delete(listener);
      };
    },
    () => current.value,
    () => initialState,
  );
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const setReference = refs.setReference;
  const setTrigger = useCallback(
    (node: HTMLButtonElement | null) => {
      trigger.current = node;
      setReference(node);
    },
    [setReference],
  );
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !trigger.current?.contains(target) &&
        !refs.floating.current?.contains(target)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, refs.floating]);
  const choices = [
    {
      mode: 'optimize' as const,
      id: 'canvas.edges.optimize',
      label: zh ? '优化全部连线' : 'Optimize all edges',
      description: zh
        ? '重新计算路线，保存为可编辑折线'
        : 'Recalculate routes and save editable paths',
    },
    {
      mode: 'reset' as const,
      id: 'canvas.edges.reroute',
      label: zh ? '重置手工走线' : 'Reset manual paths',
      description: zh
        ? '清除已有折点，恢复普通自动走线'
        : 'Clear path points and restore automatic routing',
    },
  ];
  const selected = choices.find((choice) => choice.mode === mode)!;
  const state = controller?.getActionState(selected.id);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const publish = (value: typeof initialState) => {
    current.value = value;
    [...current.listeners].forEach((listener) => listener());
  };
  const run = async (choice: (typeof choices)[number], remember: boolean) => {
    if (
      current.value.executing ||
      !controller?.getActionState(choice.id).enabled
    )
      return;
    publish({
      mode: remember ? choice.mode : current.value.mode,
      executing: true,
    });
    if (remember) close();
    try {
      await controller.executeAction(choice.id);
    } finally {
      publish({ ...current.value, executing: false });
    }
  };
  const disabled = executing || !state?.enabled;
  const disabledReason = executing ? 'pending' : state?.reason;
  return (
    <div
      className="frame-routing-button"
      role="group"
      aria-label={zh ? '连线整理' : 'Edge routing'}
      aria-busy={executing}
    >
      <FrameTooltip
        disabled={disabled}
        content={
          disabled ? frameDisabledReason(disabledReason, language) : undefined
        }
        className="frame-tooltip-block"
      >
        <button
          type="button"
          data-testid="frame-reroute-edges"
          data-routing-mode={mode}
          disabled={disabled}
          onClick={() => void run(selected, false)}
        >
          {selected.label}
        </button>
      </FrameTooltip>
      <button
        type="button"
        className="frame-routing-toggle"
        ref={setTrigger}
        aria-label={zh ? '选择连线整理方式' : 'Choose routing method'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ChevronDown strokeWidth={1.75} size={16} aria-hidden />
      </button>
      {open && (
        <FloatingPortal
          root={
            trigger.current?.closest<HTMLElement>('.frame-actions-popover') ??
            undefined
          }
        >
          <FloatingFocusManager
            context={context}
            modal={false}
            initialFocus={mode === 'optimize' ? 0 : 1}
            returnFocus={trigger}
          >
            <div
              className="frame-tool-menu frame-routing-menu"
              role="menu"
              tabIndex={-1}
              aria-label={zh ? '连线整理方式' : 'Routing method'}
              ref={refs.setFloating}
              style={floatingStyles}
              onKeyDownCapture={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  close();
                }
                if (
                  ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
                ) {
                  event.preventDefault();
                  const at = items.current.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? 1
                        : (at + (event.key === 'ArrowUp' ? -1 : 1) + 2) % 2;
                  items.current[next]?.focus();
                }
                if (event.key === 'Tab') setOpen(false);
              }}
            >
              {choices.map((choice, index) => {
                const available = controller?.getActionState(choice.id);
                const unavailable = executing || !available?.enabled;
                const reason = executing ? 'pending' : available?.reason;
                return (
                  <FrameTooltip
                    key={choice.mode}
                    content={
                      unavailable
                        ? frameDisabledReason(reason, language)
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={choice.mode === mode}
                      aria-disabled={unavailable}
                      ref={(node) => {
                        items.current[index] = node;
                      }}
                      onClick={() => void run(choice, true)}
                    >
                      <span>{choice.label}</span>
                      <small>{choice.description}</small>
                      {unavailable && (
                        <small>{frameDisabledReason(reason, language)}</small>
                      )}
                    </button>
                  </FrameTooltip>
                );
              })}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </div>
  );
}
