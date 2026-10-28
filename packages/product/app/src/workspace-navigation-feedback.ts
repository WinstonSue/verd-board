import type {
  ActionInvocation,
  ActionRegistry,
  ActionResult,
  BoundAction,
} from '@sue/board-common';

export const NAVIGATION_LOADING_DELAY = 300;
export const REPLACEABLE_NAVIGATION_ACTIONS = new Set([
  'workspace.tab.activate',
  'workspace.file.open',
  'workspace.group.switch',
  'workspace.file.return',
  'workspace.reference.locate',
  'workspace.return',
]);

export interface NavigationIntent {
  session: object;
  sourceFileId: string | null;
  targetFileId?: string | null;
  cold?: boolean;
}
export interface NavigationTicket extends NavigationIntent {
  id: number;
  startedAt: number;
  controller: AbortController;
  actionDone: boolean;
  navigationId?: number;
}
export interface NavigationFeedbackState {
  ticket: NavigationTicket;
  loading: boolean;
  revision: number;
}

/** UI-only state. Content commits, navigation persistence and history stay in the session. */
export function createNavigationFeedback() {
  let sequence = 0;
  let revision = 0;
  let state: NavigationFeedbackState | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let view: { session: object | null; fileId: string | null } | null = null;
  const listeners = new Set<() => void>();
  const publish = () => {
    if (state) state = { ...state, revision: ++revision };
    listeners.forEach((listener) => listener());
  };
  const current = (ticket: NavigationTicket) => state?.ticket === ticket;
  const cancel = (ticket = state?.ticket) => {
    if (!ticket || !current(ticket)) return;
    clearTimeout(timer);
    state = null;
    ticket.controller.abort();
    publish();
  };
  const refresh = () => {
    publish();
  };
  const api = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    current: () => state?.ticket,
    isCurrent: current,
    begin(intent: NavigationIntent) {
      cancel();
      const ticket: NavigationTicket = {
        ...intent,
        id: ++sequence,
        startedAt: performance.now(),
        controller: new AbortController(),
        actionDone: false,
      };
      state = { ticket, loading: false, revision: ++revision };
      timer = setTimeout(() => {
        if (!current(ticket)) return;
        state = { ...state!, loading: true };
        publish();
      }, NAVIGATION_LOADING_DELAY);
      publish();
      return ticket;
    },
    target(ticket: NavigationTicket, fileId: string | null) {
      if (!current(ticket)) return;
      ticket.targetFileId = fileId;
      refresh();
    },
    settle(ticket: NavigationTicket, result: ActionResult) {
      if (!current(ticket)) return;
      if (result.status !== 'completed' && result.status !== 'noop') {
        cancel(ticket);
        return;
      }
      ticket.actionDone = true;
      if (ticket.targetFileId === undefined) {
        cancel(ticket);
        return;
      }
      refresh();
    },
    commit(session: object | null, fileId: string | null) {
      view = { session, fileId };
      if (state && state.ticket.session !== session) cancel();
      else refresh();
    },
    waitForNavigation(ticket: NavigationTicket, navigationId: number) {
      if (!current(ticket)) return;
      ticket.navigationId = navigationId;
      refresh();
    },
    navigationResult(navigationId: number, status: string) {
      const ticket = state?.ticket;
      if (!ticket || ticket.navigationId !== navigationId) return;
      if (status !== 'revealed') {
        cancel(ticket);
        return;
      }
      ticket.navigationId = undefined;
      refresh();
    },
    canPaint(ticket: NavigationTicket) {
      return (
        current(ticket) &&
        ticket.actionDone &&
        ticket.navigationId === undefined &&
        ticket.targetFileId !== undefined &&
        view?.session === ticket.session &&
        view.fileId === ticket.targetFileId
      );
    },
    painted(ticket: NavigationTicket) {
      if (!api.canPaint(ticket)) return;
      clearTimeout(timer);
      state = null;
      publish();
    },
    cancel,
    refresh,
  };
  return api;
}
export type NavigationFeedback = ReturnType<typeof createNavigationFeedback>;

/** A frame followed by a task gives the browser a paint opportunity, unlike a microtask. */
export function navigationPaintOpportunity(
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    let task: ReturnType<typeof setTimeout> | undefined;
    const finish = (painted: boolean) => {
      cancelAnimationFrame(frame);
      clearTimeout(task);
      signal.removeEventListener('abort', aborted);
      resolve(painted);
    };
    const aborted = () => finish(false);
    const frame = requestAnimationFrame(() => {
      task = setTimeout(() => finish(true), 0);
    });
    signal.addEventListener('abort', aborted, { once: true });
  });
}

/** Wrap both live and captured actions so feedback starts before the editor flush barrier. */
export function withNavigationFeedback<C>(
  registry: ActionRegistry<C>,
  feedback: NavigationFeedback,
  intentFor: (id: string, args: unknown) => NavigationIntent | null,
  activeFileId: () => string | null,
  replaceable = REPLACEABLE_NAVIGATION_ACTIONS,
): ActionRegistry<C> {
  const wrapped = new WeakMap<BoundAction, BoundAction>();
  const wrap = (action: BoundAction): BoundAction => {
    const previous = wrapped.get(action);
    if (previous) return previous;
    const result: BoundAction = {
      ...action,
      getState(args) {
        const state = action.getState(args);
        // View navigation is replaceable while its old captured flush drains.
        // The registry still validates current permissions at execution checkpoints.
        return replaceable.has(action.id) && state.reason === 'pending'
          ? { ...state, enabled: true, reason: undefined }
          : state;
      },
      capture: () => wrap(action.capture()),
      async execute(args, invocation: ActionInvocation = {}) {
        if (invocation.signal?.aborted || !result.getState(args).enabled)
          return action.execute(args, invocation);
        const intent = intentFor(action.id, args);
        if (!intent) return action.execute(args, invocation);
        // Capture the editing context synchronously, before yielding or moving focus.
        const captured = action.capture();
        const ticket = feedback.begin(intent);
        const aborted = () => feedback.cancel(ticket);
        invocation.signal?.addEventListener('abort', aborted, { once: true });
        if (invocation.signal?.aborted) aborted();
        try {
          if (
            intent.cold &&
            !(await navigationPaintOpportunity(ticket.controller.signal))
          )
            return { status: 'cancelled', code: 'superseded-navigation' };
          if (!feedback.isCurrent(ticket))
            return { status: 'cancelled', code: 'superseded-navigation' };
          const outcome = await captured.execute(args, {
            ...invocation,
            signal: ticket.controller.signal,
          });
          if (ticket.targetFileId === undefined)
            feedback.target(ticket, activeFileId());
          feedback.settle(ticket, outcome);
          return outcome;
        } catch (error) {
          feedback.cancel(ticket);
          throw error;
        } finally {
          invocation.signal?.removeEventListener('abort', aborted);
        }
      },
    };
    wrapped.set(action, result);
    return result;
  };
  return {
    ...registry,
    get pending() {
      return registry.pending;
    },
    get revision() {
      return registry.revision;
    },
    actions: () => registry.actions().map(wrap),
    getActionState(id, args) {
      const action = registry.actions().find((item) => item.id === id);
      return action
        ? wrap(action).getState(args)
        : registry.getActionState(id, args);
    },
    executeAction(id, args, invocation) {
      const action = registry.actions().find((item) => item.id === id);
      return action
        ? wrap(action).execute(args, invocation)
        : registry.executeAction(id, args, invocation);
    },
    dispose() {
      feedback.cancel();
      registry.dispose();
    },
  };
}
