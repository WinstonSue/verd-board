export type ActionLanguage = 'zh' | 'en';
export type ActionLabel = string | Record<ActionLanguage, string>;
export type ActionEffect =
  'content' | 'view' | 'dialog' | 'external' | 'history';
export interface ActionState {
  visible: boolean;
  enabled: boolean;
  reason?: string;
  checked?: boolean;
}
export type ActionResult =
  | { status: 'completed' | 'noop' }
  | {
      status: 'cancelled' | 'rejected' | 'failed';
      code: string;
      message?: string;
    };
export interface ActionShortcut {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  repeat?: boolean;
  /** Clipboard events own copy/cut/paste; a keyboard bridge must skip these. */
  transport?: 'key' | 'clipboard';
}
export interface ActionInvocation {
  source?: 'api' | 'menu' | 'toolbar' | 'shortcut' | 'palette' | 'native';
  signal?: AbortSignal;
}
export interface ActionExecution<C> extends ActionInvocation {
  /** Registry-local identity allocated once for an execution, never a state query. */
  readonly invocationId: number;
  signal: AbortSignal;
  /** Synchronous transport preparation returned before any flush/queue barrier. */
  readonly preflight?: unknown;
  /** Re-read the captured target, never the newly focused target. */
  getContext(): C | null;
  /** Call after an await and immediately before committing external work. */
  checkpoint(): ActionResult | undefined;
}
export interface ActionDefinition<C, A = void> {
  id: string;
  label: ActionLabel;
  category: string;
  keywords?: readonly string[];
  order?: number;
  shortcuts?: readonly ActionShortcut[];
  effect: ActionEffect;
  /** Hide argument-taking/internal actions from a no-argument command palette. */
  palette?: boolean;
  /** Repeated internal parameterized writes may queue; user actions reject reentry. */
  concurrency?: 'queue' | 'reject';
  /** Read/history actions may need the editor barrier without becoming content writes. */
  flushEditing?: boolean;
  shortcutWhen?(context: C, shortcut: ActionShortcut): boolean;
  validateArgs?(args: unknown): args is A;
  getState?(context: C, args: A): Partial<ActionState>;
  /** Start user-activation-sensitive transport synchronously; return its deferred work. */
  beforeFlush?(context: C, args: A, invocation: ActionExecution<C>): unknown;
  /** Flush a captured editor before taking the write lane; its internal submissions may finish first. */
  beforeQueue?(
    context: C,
    args: A,
    invocation: ActionExecution<C>,
  ): void | ActionResult | Promise<void | ActionResult>;
  execute(
    context: C,
    args: A,
    invocation: ActionExecution<C>,
  ): ActionResult | Promise<ActionResult>;
}
export type ActionStateArguments<A> = undefined extends A
  ? [args?: A]
  : [args: A];
export type ActionExecuteArguments<A> = undefined extends A
  ? [args?: A, invocation?: ActionInvocation]
  : [args: A, invocation?: ActionInvocation];
export interface BoundAction<A = unknown> {
  readonly id: string;
  readonly label: ActionLabel;
  readonly category: string;
  readonly keywords?: readonly string[];
  readonly order?: number;
  readonly shortcuts?: readonly ActionShortcut[];
  readonly effect: ActionEffect;
  readonly palette?: boolean;
  shortcutEnabled(shortcut: ActionShortcut): boolean;
  getState(...args: ActionStateArguments<A>): ActionState;
  execute(...args: ActionExecuteArguments<A>): Promise<ActionResult>;
  /** Capture before opening a menu/dialog or moving focus into a palette. */
  capture(): BoundAction<A>;
}
export interface ActionRegistry<C> {
  register<A = void>(definition: ActionDefinition<C, A>): BoundAction<A>;
  seal(): void;
  actions(): readonly BoundAction[];
  getActionState(id: string, args?: unknown): ActionState;
  executeAction(
    id: string,
    args?: unknown,
    invocation?: ActionInvocation,
  ): Promise<ActionResult>;
  subscribe(listener: () => void): () => void;
  invalidate(): void;
  dispose(): void;
  readonly pending: boolean;
  readonly revision: number;
}
export const actionLabel = (label: ActionLabel, language: ActionLanguage) =>
  typeof label === 'string' ? label : label[language];

const unavailable = (reason: string): ActionState => ({
  visible: true,
  enabled: false,
  reason,
});
const cancelled = (code: string): ActionResult => ({
  status: 'cancelled',
  code,
});
const unknownAction = (): ActionResult => ({
  status: 'rejected',
  code: 'unknown-action',
});
const writeLane = (effect: ActionEffect) =>
  effect === 'content' || effect === 'history';

/**
 * One registry per editing scope. getContext returns a target snapshot;
 * refresh re-resolves that identity with current content and permissions.
 * Content and history executions (including their flush barrier) are FIFO and never
 * overlap. View/dialog/external executions start synchronously, preserving
 * the browser user-activation prologue of clipboard/window APIs.
 */
export function createActionRegistry<C>(options: {
  getContext(): C;
  refresh?(captured: C): C | null;
  beforeExecute?(
    context: C,
    effect: ActionEffect,
  ): ActionResult | void | Promise<ActionResult | void>;
}): ActionRegistry<C> {
  const entries = new Map<string, BoundAction>();
  const listeners = new Set<() => void>();
  const guardedShortcuts = new Set<string>();
  const controllers = new Set<AbortController>();
  const runningIds = new Map<string, number>();
  const queue: (() => void)[] = [];
  let sealed = false;
  let disposed = false;
  let writing = false;
  let preparing = 0;
  let revision = 0;
  let invocationSequence = 0;
  const notify = () => {
    revision += 1;
    for (const listener of [...listeners]) listener();
  };
  const pending = () => preparing > 0 || writing || queue.length > 0;
  const next = () => {
    writing = false;
    const run = queue.shift();
    if (run) run();
    else if (!disposed) notify();
  };
  const registry: ActionRegistry<C> = {
    get pending() {
      return pending();
    },
    get revision() {
      return revision;
    },
    register<A>(definition: ActionDefinition<C, A>) {
      if (sealed || disposed) throw new Error('Action registry is sealed');
      if (!definition.id || entries.has(definition.id))
        throw new Error(`Duplicate action id: ${definition.id}`);
      const state = (
        context: C,
        args: unknown,
        executing = false,
      ): ActionState => {
        if (disposed) return unavailable('scope-disposed');
        if (definition.validateArgs && !definition.validateArgs(args))
          return unavailable('invalid-arguments');
        const result: ActionState = {
          visible: true,
          enabled: true,
          ...definition.getState?.(context, args as A),
        };
        return !executing &&
          (runningIds.has(definition.id) ||
            (pending() && writeLane(definition.effect)))
          ? { ...result, enabled: false, reason: 'pending' }
          : result;
      };
      const bind = (captured?: { context: C }): BoundAction => {
        const context = () =>
          captured
            ? options.refresh
              ? options.refresh(captured.context)
              : captured.context
            : options.getContext();
        const bound: BoundAction = {
          id: definition.id,
          label: definition.label,
          category: definition.category,
          keywords: definition.keywords,
          order: definition.order,
          shortcuts: definition.shortcuts,
          effect: definition.effect,
          palette: definition.palette,
          shortcutEnabled(shortcut) {
            try {
              const current = context();
              return (
                !disposed &&
                current !== null &&
                (definition.shortcutWhen?.(current, shortcut) ?? true)
              );
            } catch {
              return false;
            }
          },
          getState(args) {
            try {
              const current = context();
              return current === null
                ? unavailable('stale-context')
                : state(current, args);
            } catch {
              return unavailable('state-failed');
            }
          },
          capture() {
            return captured ? bound : bind({ context: options.getContext() });
          },
          execute(args, invocation = {}) {
            if (disposed) return Promise.resolve(cancelled('scope-disposed'));
            if (invocation.signal?.aborted)
              return Promise.resolve(cancelled('aborted'));
            if (
              runningIds.has(definition.id) &&
              definition.concurrency !== 'queue'
            )
              return Promise.resolve({ status: 'rejected', code: 'pending' });
            // Capture at call time, before queuing or any async barrier.
            let target: C;
            try {
              target = captured ? captured.context : options.getContext();
            } catch (error) {
              return Promise.resolve({
                status: 'failed',
                code: 'context-failed',
                message: error instanceof Error ? error.message : String(error),
              });
            }
            runningIds.set(
              definition.id,
              (runningIds.get(definition.id) ?? 0) + 1,
            );
            notify();
            const controller = new AbortController();
            controllers.add(controller);
            const abort = () => controller.abort();
            invocation.signal?.addEventListener('abort', abort, { once: true });
            if (disposed || invocation.signal?.aborted) controller.abort();
            let released = false;
            const release = () => {
              if (released) return;
              released = true;
              controllers.delete(controller);
              const count = runningIds.get(definition.id) ?? 1;
              if (count > 1) runningIds.set(definition.id, count - 1);
              else runningIds.delete(definition.id);
              if (!disposed) notify();
              invocation.signal?.removeEventListener('abort', abort);
            };
            let current = target;
            const read = (): C | null => {
              if (disposed || controller.signal.aborted) return null;
              return options.refresh ? options.refresh(target) : target;
            };
            const checkpoint = (): ActionResult | undefined => {
              if (disposed) return cancelled('scope-disposed');
              if (controller.signal.aborted) return cancelled('aborted');
              const refreshed = read();
              if (refreshed === null) return cancelled('stale-context');
              current = refreshed;
              const availability = state(current, args, true);
              if (!availability.visible || !availability.enabled)
                return {
                  status: 'rejected',
                  code: availability.reason ?? 'unavailable',
                };
              return undefined;
            };
            let preflight: unknown;
            const execution: ActionExecution<C> = {
              ...invocation,
              invocationId: ++invocationSequence,
              signal: controller.signal,
              getContext: read,
              checkpoint,
              get preflight() {
                return preflight;
              },
            };
            // Native clipboard transports must start in the initiating event
            // stack, after validation and reentry checks, even if content work
            // will wait for another action or an editor flush.
            try {
              const initial = checkpoint();
              if (initial) {
                release();
                return Promise.resolve(initial);
              }
              preflight = definition.beforeFlush?.(
                current,
                args as A,
                execution,
              );
            } catch (error) {
              release();
              return Promise.resolve({
                status: 'failed',
                code: 'preflight-failed',
                message: error instanceof Error ? error.message : String(error),
              });
            }
            const execute = async (): Promise<ActionResult> => {
              try {
                const initial = checkpoint();
                if (initial) return initial;
                if (
                  (writeLane(definition.effect) || definition.flushEditing) &&
                  options.beforeExecute
                ) {
                  const flushed = await options.beforeExecute(
                    current,
                    definition.effect,
                  );
                  if (
                    flushed &&
                    flushed.status !== 'completed' &&
                    flushed.status !== 'noop'
                  )
                    return flushed;
                  const invalid = checkpoint();
                  if (invalid) return invalid;
                }
                const result = await definition.execute(
                  current,
                  args as A,
                  execution,
                );
                if (disposed) return cancelled('scope-disposed');
                if (controller.signal.aborted) return cancelled('aborted');
                return result;
              } catch (error) {
                return {
                  status: 'failed',
                  code: 'execution-failed',
                  message:
                    error instanceof Error ? error.message : String(error),
                };
              } finally {
                release();
              }
            };
            const abortable = (work: Promise<ActionResult>) =>
              new Promise<ActionResult>((resolve) => {
                const onAbort = () =>
                  resolve(cancelled(disposed ? 'scope-disposed' : 'aborted'));
                controller.signal.addEventListener('abort', onAbort, {
                  once: true,
                });
                if (controller.signal.aborted) onAbort();
                void work
                  .then(resolve)
                  .finally(() =>
                    controller.signal.removeEventListener('abort', onAbort),
                  );
              });
            const launch = (): Promise<ActionResult> =>
              !writeLane(definition.effect)
                ? execute()
                : new Promise<ActionResult>((resolve) => {
                    const run = () => {
                      writing = true;
                      if (!disposed) notify();
                      void execute().then(resolve).finally(next);
                    };
                    if (writing) {
                      queue.push(run);
                      if (!disposed) notify();
                    } else run();
                  });
            if (!definition.beforeQueue) return abortable(launch());
            return abortable(
              (async () => {
                preparing += 1;
                if (!disposed) notify();
                let prepared: ActionResult | void;
                try {
                  prepared = await definition.beforeQueue!(
                    current,
                    args as A,
                    execution,
                  );
                } catch (error) {
                  prepared = {
                    status: 'failed',
                    code: 'preparation-failed',
                    message:
                      error instanceof Error ? error.message : String(error),
                  };
                } finally {
                  preparing -= 1;
                  if (!disposed) notify();
                }
                if (
                  prepared &&
                  prepared.status !== 'completed' &&
                  prepared.status !== 'noop'
                ) {
                  release();
                  return prepared;
                }
                const invalid = checkpoint();
                if (invalid) {
                  release();
                  return invalid;
                }
                return launch();
              })(),
            );
          },
        };
        return bound;
      };
      const action = bind();
      entries.set(definition.id, action);
      if (definition.shortcutWhen) guardedShortcuts.add(definition.id);
      notify();
      return action as BoundAction<A>;
    },
    seal() {
      const bindings = new Map<string, BoundAction>();
      for (const entry of entries.values()) {
        for (const key of entry.shortcuts ?? []) {
          // Category is presentation only; it must not hide keyboard conflicts.
          const signature = JSON.stringify([
            key.key.toLowerCase(),
            !!key.mod,
            !!key.shift,
            !!key.alt,
            key.transport ?? 'key',
          ]);
          const previous = bindings.get(signature);
          if (
            previous &&
            !guardedShortcuts.has(previous.id) &&
            !guardedShortcuts.has(entry.id)
          )
            throw new Error(`Conflicting action shortcut: ${entry.id}`);
          bindings.set(signature, entry);
        }
      }
      sealed = true;
    },
    actions: () => [...entries.values()],
    getActionState: (id, args) =>
      entries.get(id)?.getState(args) ?? {
        visible: false,
        enabled: false,
        reason: 'unknown-action',
      },
    executeAction: (id, args, invocation) =>
      entries.get(id)?.execute(args, invocation) ??
      Promise.resolve(unknownAction()),
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate: () => {
      if (!disposed) notify();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of controllers) controller.abort();
      notify();
      listeners.clear();
      // Active asynchronous work cooperates through signal/checkpoint. Queued
      // executions are still drained, each cancelling before its definition runs.
    },
  };
  return registry;
}
