import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  ActionLanguage,
  ActionResult,
  ActionState,
  BoundAction,
} from '@sue/board-common';
import { ActionHelp, CommandPalette, type ActionPanelFocus } from './panels';
import { matchesActionShortcut, resolveActionShortcut } from './shortcuts';

/** Structural source: consumers do not need to erase a registry's Context type. */
export interface ActionSource {
  actions(): readonly BoundAction[];
  subscribe(listener: () => void): () => void;
  getActionState(id: string, args?: unknown): ActionState;
  readonly revision: number;
}
export interface ActionPanelOptions {
  returnFocus?: ActionPanelFocus;
}
export interface ActionScopeValue {
  source: ActionSource;
  parent: ActionScopeValue | null;
  language: ActionLanguage;
  readonly enabled?: boolean;
  openPalette(options?: ActionPanelOptions): void;
  openHelp(options?: ActionPanelOptions): void;
}
const ScopeContext = createContext<ActionScopeValue | null>(null);
export const useActionScope = () => useContext(ScopeContext);
const noSubscribe = () => () => {};
const zero = () => 0;
const modalSelector =
  'dialog, [role="dialog"], [role="alertdialog"], [role="menu"]';
function ignoreKey(event: globalThis.KeyboardEvent) {
  return (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    ['Process', 'Dead', 'AltGraph'].includes(event.key) ||
    event.getModifierState('AltGraph')
  );
}
function isPaletteKey(event: globalThis.KeyboardEvent) {
  return matchesActionShortcut(event, { key: 'p', mod: true, shift: true });
}
function hasVisibleModal(document: Document) {
  return [...document.querySelectorAll<HTMLElement>(modalSelector)].some(
    (modal) => {
      if (modal.closest('[hidden], [inert], [aria-hidden="true"]'))
        return false;
      for (
        let element: HTMLElement | null = modal;
        element;
        element = element.parentElement
      ) {
        const style = document.defaultView?.getComputedStyle(element);
        if (style?.display === 'none' || style?.visibility === 'hidden')
          return false;
      }
      return true;
    },
  );
}
export function useActionSource(source?: ActionSource | null): number {
  const scoped = useActionScope();
  const actual = source ?? scoped?.source;
  return useSyncExternalStore(
    actual ? (listener) => actual.subscribe(listener) : noSubscribe,
    actual ? () => actual.revision : zero,
    zero,
  );
}
export function useActionState(
  id: string,
  args?: unknown,
  source?: ActionSource | null,
): ActionState {
  const scope = useActionScope();
  const actual = source ?? scope?.source;
  useActionSource(actual);
  return (
    actual?.getActionState(id, args) ?? {
      visible: false,
      enabled: false,
      reason: 'unknown-action',
    }
  );
}
export function captureScopeActions(scope: ActionScopeValue): BoundAction[] {
  const result = new Map<string, BoundAction>();
  let current: ActionScopeValue | null = scope;
  while (current) {
    if (current.enabled === false) break;
    for (const action of current.source.actions())
      if (!result.has(action.id)) result.set(action.id, action.capture());
    current = current.parent;
  }
  return [...result.values()];
}
export interface ActionScopeProps {
  registry: ActionSource;
  children: ReactNode;
  language?: ActionLanguage;
  enabled?: boolean;
  /** Opt in on one root scope to handle palette keys when focus is on body/html. */
  paletteFallback?: boolean;
  className?: string;
  onResult?(result: ActionResult, actionId: string): void;
  onConflict?(actionIds: readonly string[]): void;
  onReady?(scope: ActionScopeValue | null): void;
}
export function ActionScope({
  registry,
  children,
  language: suppliedLanguage,
  enabled = true,
  paletteFallback = false,
  className,
  onResult,
  onConflict,
  onReady,
}: ActionScopeProps) {
  const parent = useActionScope();
  const language = suppliedLanguage ?? parent?.language ?? 'zh';
  const active = enabled && parent?.enabled !== false;
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<{
    kind: 'palette' | 'help';
    actions: readonly BoundAction[];
    sources: readonly ActionSource[];
    returnFocus?: ActionPanelFocus;
  } | null>(null);
  const scope = useMemo<ActionScopeValue>(() => {
    const value: ActionScopeValue = {
      source: registry,
      parent,
      language,
      enabled: active,
      openPalette: (options) => open('palette', options),
      openHelp: (options) => open('help', options),
    };
    const open = (kind: 'palette' | 'help', options?: ActionPanelOptions) => {
      if (!active) return;
      const sources: ActionSource[] = [];
      let current: ActionScopeValue | null = value;
      while (current) {
        if (current.enabled === false) break;
        sources.push(current.source);
        current = current.parent;
      }
      // This happens before setState mounts a dialog and moves focus.
      setPanel({
        kind,
        actions: captureScopeActions(value),
        sources,
        returnFocus: options?.returnFocus,
      });
    };
    return value;
  }, [registry, parent, language, active]);
  useEffect(() => {
    onReady?.(scope);
    return () => onReady?.(null);
  }, [onReady, scope]);
  const close = useCallback(() => setPanel(null), []);
  useEffect(() => {
    const document = containerRef.current?.ownerDocument;
    if (!document || !paletteFallback || parent || !active || panel) return;
    const handle = (event: globalThis.KeyboardEvent) => {
      if (
        (event.target !== document.body &&
          event.target !== document.documentElement) ||
        ignoreKey(event) ||
        !isPaletteKey(event) ||
        hasVisibleModal(document)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      scope.openPalette();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [paletteFallback, parent, active, panel, scope]);
  const handlePaletteKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !active ||
      panel ||
      event.defaultPrevented ||
      ignoreKey(event.nativeEvent)
    )
      return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest('[data-action-scope]') !== event.currentTarget ||
      target.closest(modalSelector) ||
      !isPaletteKey(event.nativeEvent)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    scope.openPalette();
  };
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !active ||
      panel ||
      event.defaultPrevented ||
      ignoreKey(event.nativeEvent)
    )
      return;
    const target = event.target instanceof Element ? event.target : null;
    // A nearest scope routes its own parents; ancestors must never dispatch
    // the same bubbling key against a different editor's selection.
    if (target?.closest('[data-action-scope]') !== event.currentTarget) return;
    if (target?.closest(modalSelector)) return;
    if (
      target?.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
      )
    )
      return;
    let current: ActionScopeValue | null = scope;
    while (current) {
      if (current.enabled === false) return;
      const resolution = resolveActionShortcut(current.source.actions(), event);
      if (resolution.status === 'conflict') {
        event.preventDefault();
        event.stopPropagation();
        onConflict?.(resolution.actions.map((action) => action.id));
        return;
      }
      if (resolution.status === 'matched') {
        event.preventDefault();
        event.stopPropagation();
        const action = resolution.action.capture();
        // Do not insert an async barrier here: clipboard/window user activation
        // belongs to the original event, even when a definition returns a Promise.
        void action
          .execute(undefined, { source: 'shortcut' })
          .then((result) => onResult?.(result, action.id));
        return;
      }
      // A disabled local binding still owns its key. It must not fall through
      // to a parent canvas and mutate another selection. Conditional bindings
      // which do not apply are free to delegate to a parent scope.
      if (
        current.source
          .actions()
          .some((action) =>
            action.shortcuts?.some(
              (shortcut) =>
                matchesActionShortcut(event, shortcut) &&
                action.shortcutEnabled(shortcut),
            ),
          )
      )
        return;
      current = current.parent;
    }
  };
  return (
    <ScopeContext.Provider value={scope}>
      <div
        ref={containerRef}
        className={className}
        style={{ display: 'contents' }}
        data-action-scope={id}
        onKeyDownCapture={handlePaletteKey}
        onKeyDown={handleKey}
      >
        {children}
        {panel?.kind === 'palette' && (
          <CommandPalette
            actions={panel.actions}
            sources={panel.sources}
            language={language}
            onClose={close}
            returnFocus={panel.returnFocus}
            onResult={onResult}
          />
        )}
        {panel?.kind === 'help' && (
          <ActionHelp
            actions={panel.actions}
            sources={panel.sources}
            language={language}
            onClose={close}
            returnFocus={panel.returnFocus}
          />
        )}
      </div>
    </ScopeContext.Provider>
  );
}
