import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { frameScene, type FrameSnapshot } from '@sue/board-core';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameCanvasProps,
} from '@sue/board-react';
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  Keyboard,
  LogOut,
  Pointer,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { ShortcutHelp } from '../shortcut-help';
import { shortcutLabels } from '../shortcut-catalog';
import { exitPresentationFullscreen } from './fullscreen-owner';
import {
  clampPresentationIndex,
  presentationSteps,
  presentationTargetIds,
  type PresentationScene,
} from './presentation-targets';
import './presentation.scss';

export interface PresentationModeProps {
  value: FrameSnapshot;
  frameId?: string;
  registry?: FrameCanvasProps['registry'];
  extensions?: FrameCanvasProps['extensions'];
  instanceHost?: FrameCanvasProps['instanceHost'];
  documentReferences?: FrameCanvasProps['documentReferences'];
  interactionSettings?: FrameCanvasProps['interactionSettings'];
  scene?:
    PresentationScene | 'mind-root' | 'workflow-start' | 'architecture-layer';
  /** The owner requests fullscreen before mounting; null supports a CSS fallback. */
  fullscreenRoot: HTMLElement | null | RefObject<HTMLElement | null>;
  onExit(): void;
}

const hand = { mode: 'hand' } as const;
const insets = { top: 48, right: 48, bottom: 48, left: 48 };
const HUD_DELAY = 2500;

export function PresentationMode(props: PresentationModeProps) {
  const { value, registry, extensions, instanceHost, interactionSettings } =
    props;
  const frameId = props.frameId ?? value.store.rootId;
  const sourceScene = props.scene ?? frameScene(value.store, frameId);
  const scene: PresentationScene =
    sourceScene === 'mind-root'
      ? 'mind'
      : sourceScene === 'workflow-start'
        ? 'workflow'
        : sourceScene === 'architecture-layer'
          ? 'architecture'
          : (sourceScene ?? 'whiteboard');
  const { t, language } = useI18n();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsButton = useRef<HTMLButtonElement>(null);
  const shortcutsVisible = useRef(false);
  shortcutsVisible.current = shortcutsOpen;
  const steps = useMemo(
    () => presentationSteps(value.store, frameId, scene),
    [value, frameId, scene],
  );
  const canvas = useRef<FrameCanvasController>(null);
  const surface = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const target = useRef<string | null>(null);
  const navigation = useRef(0);
  const [index, setIndex] = useState(0);
  const [focusedTarget, setFocusedTarget] = useState<string | null>(null);
  const [laser, setLaser] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const [hudVisible, setHudVisible] = useState(true);
  const hudShown = useRef(true);
  const hudTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fitFrame = useRef<number | undefined>(undefined);
  const exiting = useRef(false);
  const latest = useRef({ value, frameId, steps, onExit: props.onExit });

  useLayoutEffect(() => {
    latest.current = { value, frameId, steps, onExit: props.onExit };
    const next = clampPresentationIndex(navigation.current, steps.length);
    if (next !== navigation.current) {
      navigation.current = next;
      setIndex(next);
    }
  }, [value, frameId, steps, props.onExit]);

  const exit = useCallback(() => {
    if (exiting.current) return;
    exiting.current = true;
    latest.current.onExit();
  }, []);

  const refit = useCallback((animate = false) => {
    const controller = canvas.current;
    if (!controller) return;
    const current = latest.current;
    const ids = target.current
      ? presentationTargetIds(
          current.value.store,
          current.frameId,
          target.current,
        )
      : [];
    const options = { animate, insets, maxZoom: 2 };
    if (ids.length && controller.fitCells(ids, options)) return;
    controller.fitBounds(controller.getContentBounds(), options);
  }, []);

  const scheduleRefit = useCallback(() => {
    if (fitFrame.current !== undefined) cancelAnimationFrame(fitFrame.current);
    fitFrame.current = requestAnimationFrame(() => {
      fitFrame.current = undefined;
      refit();
    });
  }, [refit]);

  const showHud = useCallback(() => {
    if (!hudShown.current) {
      hudShown.current = true;
      setHudVisible(true);
    }
    clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => {
      if (shortcutsVisible.current) return;
      if (hud.current?.contains(document.activeElement)) return;
      hudShown.current = false;
      setHudVisible(false);
    }, HUD_DELAY);
  }, []);

  const focusTarget = useCallback(
    (id: string | null) => {
      target.current = id;
      setFocusedTarget(id);
      refit(true);
      // A navigation button may become disabled at the next boundary. Return
      // focus before that happens so subsequent keys still reach this surface.
      if (hud.current?.contains(document.activeElement))
        surface.current?.focus({ preventScroll: true });
      showHud();
    },
    [refit, showHud],
  );

  const overview = useCallback(() => {
    navigation.current = 0;
    setIndex(0);
    focusTarget(null);
  }, [focusTarget]);

  const step = useCallback(
    (delta: number) => {
      const currentSteps = latest.current.steps;
      const next = clampPresentationIndex(
        navigation.current + delta,
        currentSteps.length,
      );
      navigation.current = next;
      setIndex(next);
      focusTarget(currentSteps[next - 1] ?? null);
    },
    [focusTarget],
  );

  const onPresentTap = useCallback(
    (id: string | null) => {
      if (id === null) overview();
      else {
        const stepIndex = latest.current.steps.indexOf(id);
        if (stepIndex !== -1) {
          navigation.current = stepIndex + 1;
          setIndex(stepIndex + 1);
        }
        focusTarget(id);
      }
    },
    [focusTarget, overview],
  );

  useLayoutEffect(() => {
    scheduleRefit();
  }, [value, frameId, extensions, registry, instanceHost, scheduleRefit]);

  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(scheduleRefit);
    observer?.observe(node);
    window.addEventListener('resize', scheduleRefit);
    const fonts = document.fonts;
    let active = true;
    void fonts?.ready.then(() => {
      if (active) scheduleRefit();
    });
    fonts?.addEventListener('loadingdone', scheduleRefit);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', scheduleRefit);
      fonts?.removeEventListener('loadingdone', scheduleRefit);
      if (fitFrame.current !== undefined)
        cancelAnimationFrame(fitFrame.current);
    };
  }, [scheduleRefit]);

  // Deferring cleanup by a microtask lets StrictMode reacquire the same owner.
  // Data/camera changes never recreate this fullscreen lease.
  const fullscreenLease = useRef<{
    root: HTMLElement | null;
    active: boolean;
  } | null>(null);
  useEffect(() => {
    const owner = props.fullscreenRoot;
    const root = owner && 'current' in owner ? owner.current : owner;
    const lease = { root, active: true };
    fullscreenLease.current = lease;
    let entered = !!root && document.fullscreenElement === root;
    const changed = () => {
      if (!root) return;
      if (document.fullscreenElement === root) entered = true;
      else if (entered) exit();
    };
    document.addEventListener('fullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      lease.active = false;
      queueMicrotask(() => {
        const current = fullscreenLease.current;
        if (current?.active && current.root === root) return;
        exitPresentationFullscreen(root);
      });
    };
  }, [props.fullscreenRoot, exit]);

  useEffect(() => {
    surface.current?.focus({ preventScroll: true });
    showHud();
    const focusin = (event: FocusEvent) => {
      if (!surface.current?.contains(event.target as Node))
        surface.current?.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', focusin);
    return () => {
      clearTimeout(hudTimer.current);
      document.removeEventListener('focusin', focusin);
    };
  }, [showHud]);

  useEffect(() => {
    const timer = setTimeout(() => setHintVisible(false), HUD_DELAY);
    return () => clearTimeout(timer);
  }, []);

  const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (shortcutsOpen) return;
    if (
      event.key !== 'Escape' &&
      (event.target as Element).closest?.('[data-document-preview-body]')
    )
      return;
    if (event.code === 'Space' || event.key === ' ') return;
    event.stopPropagation();
    showHud();
    if (event.key === 'Escape') {
      event.preventDefault();
      exit();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const buttons = [
        ...(hud.current?.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)',
        ) ?? []),
      ];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.shiftKey
        ? at <= 0
          ? buttons.length - 1
          : at - 1
        : (at + 1) % buttons.length;
      buttons[next]?.focus();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const handled = [
      'ArrowRight',
      'ArrowDown',
      'PageDown',
      'ArrowLeft',
      'ArrowUp',
      'PageUp',
      'Enter',
      '0',
      'Home',
      'l',
      'L',
    ].includes(event.key);
    if (event.key === 'Enter' && hud.current?.contains(event.target as Node))
      return;
    if (handled) event.preventDefault();
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
        step(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        step(-1);
        break;
      case 'Enter':
        step(1);
        break;
      case '0':
      case 'Home':
        overview();
        break;
      case 'l':
      case 'L':
        if (!event.repeat) setLaser((current) => !current);
        break;
    }
  };

  const overviewLabel = t('presentation.overview');
  const previousLabel = t('presentation.previous');
  const nextLabel = t('presentation.next');
  const laserLabel = t('presentation.laser');
  const exitLabel = t('presentation.exit');
  return (
    // The dialog owns keyboard navigation for its canvas and toolbar descendants.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={surface}
      className={`presentation-mode${laser ? ' is-laser' : ''}`}
      data-testid="presentation-mode"
      role="dialog"
      aria-modal="true"
      aria-label={overviewLabel}
      tabIndex={-1}
      onClickCapture={(event) => {
        const target = event.target as Element;
        if (!target.closest?.('[data-document-preview-body]')) return;
        const link = target.closest('a[href]');
        if (
          target.closest('button') ||
          (link && !link.getAttribute('href')?.startsWith('#'))
        )
          exit();
      }}
      onKeyDownCapture={onKeyDownCapture}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUpCapture={(event) => {
        if (shortcutsOpen) return;
        if (event.code !== 'Space' && event.key !== ' ')
          event.stopPropagation();
      }}
      onKeyUp={(event) => event.stopPropagation()}
      onPointerMove={showHud}
      onPointerDown={showHud}
    >
      <FrameCanvas
        documentReferences={props.documentReferences}
        ref={canvas}
        value={value}
        frameId={frameId}
        registry={registry}
        extensions={extensions}
        instanceHost={instanceHost}
        interactionSettings={interactionSettings}
        readonly
        suspended={shortcutsOpen}
        inputMode="present"
        tool={hand}
        autoFit={false}
        viewportInsets={insets}
        onPresentTap={onPresentTap}
        className="presentation-mode-canvas"
      />
      {hintVisible && (
        <div className="presentation-hint" role="status">
          {t('presentation.hint')}
          {steps.length > 0 && <span>{t('presentation.hintSteps')}</span>}
        </div>
      )}
      <div
        ref={hud}
        className={`presentation-hud${hudVisible || shortcutsOpen ? '' : ' is-hidden'}`}
        data-testid="presentation-hud"
        role="toolbar"
        aria-label={overviewLabel}
        onFocus={showHud}
        onBlur={showHud}
      >
        <button
          type="button"
          title={`${overviewLabel} (0 / Home)`}
          aria-label={overviewLabel}
          aria-pressed={focusedTarget === null}
          onClick={overview}
        >
          <Expand size={18} aria-hidden="true" />
        </button>
        {steps.length > 0 && (
          <>
            <button
              type="button"
              title={`${previousLabel} (←)`}
              aria-label={previousLabel}
              disabled={index === 0}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <span
              className="presentation-step"
              data-testid="presentation-step"
              aria-live="polite"
              aria-atomic="true"
            >
              {index === 0 ? overviewLabel : `${index} / ${steps.length}`}
            </span>
            <button
              type="button"
              title={`${nextLabel} (→ / Enter)`}
              aria-label={nextLabel}
              disabled={index >= steps.length}
              onClick={() => step(1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </>
        )}
        <span className="presentation-hud-divider" />
        <button
          type="button"
          title={`${laserLabel} (L)`}
          aria-label={laserLabel}
          aria-pressed={laser}
          onClick={() => setLaser((current) => !current)}
        >
          <Pointer size={18} aria-hidden="true" />
        </button>
        <button
          ref={shortcutsButton}
          type="button"
          title={shortcutLabels[language].title}
          aria-label={shortcutLabels[language].title}
          onClick={() => setShortcutsOpen(true)}
        >
          <Keyboard size={18} aria-hidden />
        </button>
        <button
          type="button"
          title={`${exitLabel} (Esc)`}
          aria-label={exitLabel}
          onClick={exit}
        >
          <LogOut size={18} aria-hidden="true" />
        </button>
      </div>
      {shortcutsOpen && (
        <ShortcutHelp
          scene="presentation"
          locale={language}
          returnFocusRef={shortcutsButton}
          onClose={() => setShortcutsOpen(false)}
        />
      )}
    </div>
  );
}
