import { frameScene, type FrameSnapshot } from '@sue/board-core';
import { createActionRegistry } from '@sue/board-common';
import { ActionHelp, resolveActionShortcut } from '@sue/board-react-actions';
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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { createVerdFramePluginSet } from '../frame-plugins';
import { useI18n } from '../../i18n';
import { shortcutLabels } from '../../shared/shortcut-labels';
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
  pluginSet?: FrameCanvasProps['pluginSet'];
  registry?: FrameCanvasProps['registry'];
  extensions?: FrameCanvasProps['extensions'];
  instanceHost?: FrameCanvasProps['instanceHost'];
  linkHost?: FrameCanvasProps['linkHost'];
  documentReferences?: FrameCanvasProps['documentReferences'];
  interactionSettings?: FrameCanvasProps['interactionSettings'];
  scene?:
    PresentationScene | 'mind-root' | 'workflow-start' | 'architecture-layer';
  /** The owner requests fullscreen before mounting; null supports a CSS fallback. */
  fullscreenRoot: HTMLElement | null | RefObject<HTMLElement | null>;
  ownsFullscreen?: boolean;
  navigation?: {
    requestId: number;
    target: import('@sue/board-common').WorkspaceFileTarget;
    signal?: AbortSignal;
  };
  onNavigationResult?(
    id: number,
    result: { status: 'revealed' | 'unavailable' | 'cancelled'; code?: string },
  ): void;
  onBack?(): void;
  onExit(): void;
}

const hand = { mode: 'hand' } as const;
const insets = { top: 48, right: 48, bottom: 48, left: 48 };
const HUD_DELAY = 2500;

export function PresentationMode(props: PresentationModeProps) {
  const {
    value,
    instanceHost,
    interactionSettings,
    navigation: requestNavigation,
    onNavigationResult,
  } = props;
  const defaultPlugins = useMemo(() => createVerdFramePluginSet(), []);
  const registry =
    props.pluginSet?.registry ?? props.registry ?? defaultPlugins.registry;
  const extensions =
    props.pluginSet?.extensions ??
    props.extensions ??
    defaultPlugins.extensions;
  const frameId = props.frameId ?? value.store.rootId;
  const sourceScene = props.scene ?? frameScene(value.store, frameId, registry);
  const scene: PresentationScene =
    sourceScene === 'mind-root'
      ? 'mind'
      : sourceScene === 'workflow-start'
        ? 'workflow'
        : sourceScene === 'architecture-layer'
          ? 'architecture'
          : sourceScene === 'uml-class-root' || sourceScene === 'uml-class'
            ? 'uml-class'
            : sourceScene === 'uml-sequence-root' ||
                sourceScene === 'uml-sequence'
              ? 'uml-sequence'
              : sourceScene === 'mind' ||
                  sourceScene === 'workflow' ||
                  sourceScene === 'architecture'
                ? sourceScene
                : 'whiteboard';
  const { t, language } = useI18n();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const navigationRequest = useRef(requestNavigation);
  navigationRequest.current = requestNavigation;
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
      if (
        !navigationRequest.current ||
        navigationRequest.current.target.kind !== 'cell'
      )
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

  const actionContext = useRef({ frameId, index, steps, laser });
  actionContext.current = { frameId, index, steps, laser };
  const actionServices = useRef({ overview, step, exit });
  actionServices.current = { overview, step, exit };
  const actions = useMemo(() => {
    const actions = createActionRegistry({
      getContext: () => actionContext.current,
      refresh: (captured) =>
        captured.frameId === actionContext.current.frameId
          ? actionContext.current
          : null,
    });
    const add = actions.register.bind(actions);
    add({
      id: 'presentation.overview',
      label: { zh: '总览', en: 'Overview' },
      category: 'presentation',
      effect: 'view',
      shortcuts: [{ key: '0' }, { key: 'Home' }],
      execute: () => {
        actionServices.current.overview();
        return { status: 'completed' };
      },
    });
    for (const [direction, delta, keys, label] of [
      [
        'next',
        1,
        ['ArrowRight', 'ArrowDown', 'PageDown', 'Enter'],
        { zh: '下一步', en: 'Next' },
      ],
      [
        'previous',
        -1,
        ['ArrowLeft', 'ArrowUp', 'PageUp'],
        { zh: '上一步', en: 'Previous' },
      ],
    ] as const)
      add({
        id: `presentation.${direction}`,
        label,
        category: 'presentation',
        effect: 'view',
        shortcuts: keys.map((key) => ({ key, repeat: true })),
        getState: (context) => ({
          visible: context.steps.length > 0,
          enabled:
            delta > 0
              ? context.index < context.steps.length
              : context.index > 0,
        }),
        execute: () => {
          actionServices.current.step(delta);
          return { status: 'completed' };
        },
      });
    add({
      id: 'presentation.laser',
      label: { zh: '激光笔', en: 'Laser' },
      category: 'presentation',
      effect: 'view',
      shortcuts: [{ key: 'l' }, { key: 'l', shift: true }],
      getState: (context) => ({ checked: context.laser }),
      execute: () => {
        setLaser((current) => !current);
        return { status: 'completed' };
      },
    });
    add({
      id: 'presentation.help',
      label: { zh: '快捷键', en: 'Keyboard shortcuts' },
      category: 'presentation',
      effect: 'dialog',
      execute: () => {
        setShortcutsOpen(true);
        return { status: 'completed' };
      },
    });
    add({
      id: 'presentation.exit',
      label: { zh: '退出演示', en: 'Exit' },
      category: 'presentation',
      effect: 'view',
      shortcuts: [{ key: 'Escape' }],
      execute: () => {
        actionServices.current.exit();
        return { status: 'completed' };
      },
    });
    actions.seal();
    return actions;
  }, []);
  useLayoutEffect(
    () => actions.invalidate(),
    [actions, frameId, index, steps, laser],
  );
  const actionLease = useMemo(() => ({ generation: 0 }), []);
  useEffect(() => {
    const lease = ++actionLease.generation;
    return () => {
      queueMicrotask(() => {
        if (actionLease.generation === lease) actions.dispose();
      });
    };
  }, [actions, actionLease]);

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
    if (props.ownsFullscreen === false) return;
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
  }, [props.fullscreenRoot, props.ownsFullscreen, exit]);

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
    if (event.nativeEvent.isComposing || event.key === 'Process') return;
    if (
      event.key !== 'Escape' &&
      (event.target as Element).closest?.('[data-document-preview-body]')
    )
      return;
    if (event.code === 'Space' || event.key === ' ') return;
    event.stopPropagation();
    showHud();
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
    if (event.key === 'Enter' && hud.current?.contains(event.target as Node))
      return;
    const match = resolveActionShortcut(actions.actions(), event);
    if (match.status === 'matched') {
      event.preventDefault();
      void match.action.execute(undefined, { source: 'shortcut' });
    }
  };

  useEffect(() => {
    const request = requestNavigation;
    if (!request) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (request.target.kind === 'cell') {
        void canvas.current
          ?.revealTarget({
            cellId: request.target.cellId,
            requestId: request.requestId,
            signal: request.signal,
          })
          .then((result) => {
            if (!cancelled) onNavigationResult?.(request.requestId, result);
          });
      } else
        onNavigationResult?.(request.requestId, {
          status: request.target.kind === 'file' ? 'revealed' : 'unavailable',
        });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [requestNavigation, onNavigationResult]);

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
        linkHost={props.linkHost}
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
        {props.onBack && (
          <button
            type="button"
            aria-label={language === 'zh' ? '返回来源' : 'Back to source'}
            onClick={props.onBack}
          >
            <ChevronLeft strokeWidth={1.75} size={18} />
          </button>
        )}
        <button
          type="button"
          title={`${overviewLabel} (0 / Home)`}
          aria-label={overviewLabel}
          aria-pressed={focusedTarget === null}
          onClick={() => void actions.executeAction('presentation.overview')}
        >
          <Expand strokeWidth={1.75} size={18} aria-hidden="true" />
        </button>
        {steps.length > 0 && (
          <>
            <button
              type="button"
              title={`${previousLabel} (←)`}
              aria-label={previousLabel}
              disabled={index === 0}
              onClick={() =>
                void actions.executeAction('presentation.previous')
              }
            >
              <ChevronLeft strokeWidth={1.75} size={18} aria-hidden="true" />
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
              onClick={() => void actions.executeAction('presentation.next')}
            >
              <ChevronRight strokeWidth={1.75} size={18} aria-hidden="true" />
            </button>
          </>
        )}
        <span className="presentation-hud-divider" />
        <button
          type="button"
          title={`${laserLabel} (L)`}
          aria-label={laserLabel}
          aria-pressed={laser}
          onClick={() => void actions.executeAction('presentation.laser')}
        >
          <Pointer strokeWidth={1.75} size={18} aria-hidden="true" />
        </button>
        <button
          ref={shortcutsButton}
          type="button"
          title={shortcutLabels[language].title}
          aria-label={shortcutLabels[language].title}
          onClick={() => void actions.executeAction('presentation.help')}
        >
          <Keyboard strokeWidth={1.75} size={18} aria-hidden />
        </button>
        <button
          type="button"
          title={`${exitLabel} (Esc)`}
          aria-label={exitLabel}
          onClick={() => void actions.executeAction('presentation.exit')}
        >
          <LogOut strokeWidth={1.75} size={18} aria-hidden="true" />
        </button>
      </div>
      {shortcutsOpen && (
        <ActionHelp
          actions={actions.actions()}
          sources={[actions]}
          language={language}
          returnFocus={() => shortcutsButton.current}
          onClose={() => setShortcutsOpen(false)}
        />
      )}
    </div>
  );
}
