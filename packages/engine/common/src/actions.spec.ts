import { describe, expect, it, vi } from 'vitest';
import {
  createActionRegistry,
  type ActionDefinition,
  type ActionResult,
} from './actions';
const done: ActionResult = { status: 'completed' };
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const base = <C>(
  id: string,
  execute: ActionDefinition<C>['execute'],
): ActionDefinition<C> => ({
  id,
  label: id,
  category: 'test',
  effect: 'content',
  execute,
});

describe('scope action registry', () => {
  it('keeps one invocation identity through preflight and execution without allocating for state reads', async () => {
    const registry = createActionRegistry({ getContext: () => ({}) });
    const preflight: number[] = [];
    const executions: number[] = [];
    registry.register({
      ...base('run', (_context, _args, execution) => {
        executions.push(execution.invocationId);
        return done;
      }),
      beforeFlush: (_context, _args, execution) => {
        preflight.push(execution.invocationId);
      },
    });
    registry.getActionState('run');
    registry.actions()[0].capture().getState();
    await registry.executeAction('run');
    registry.getActionState('run');
    await registry.executeAction('run');
    expect(preflight).toEqual([1, 2]);
    expect(executions).toEqual(preflight);
  });

  it('keeps history pending behind content and flushes it only after the preceding write finishes', async () => {
    const gate = deferred();
    const events: string[] = [];
    const registry = createActionRegistry({
      getContext: () => ({}),
      beforeExecute: (_c, effect) => {
        events.push(`flush:${effect}`);
      },
    });
    registry.register(
      base('content', async () => {
        events.push('content:start');
        await gate.promise;
        events.push('content:end');
        return done;
      }),
    );
    registry.register({
      ...base('undo', () => {
        events.push('undo');
        return done;
      }),
      effect: 'history',
    });
    const first = registry.executeAction('content');
    await Promise.resolve();
    expect(registry.getActionState('undo')).toMatchObject({
      enabled: false,
      reason: 'pending',
    });
    const undo = registry.executeAction('undo');
    expect(events).toEqual(['flush:content', 'content:start']);
    gate.resolve();
    expect(await first).toEqual(done);
    expect(await undo).toEqual(done);
    expect(events).toEqual([
      'flush:content',
      'content:start',
      'content:end',
      'flush:history',
      'undo',
    ]);
    registry.dispose();
  });

  it('prepares before taking the content lane so editor submissions can finish without deadlock', async () => {
    const gate = deferred();
    const events: string[] = [];
    const registry = createActionRegistry({ getContext: () => ({}) });
    registry.register({
      ...base('editor.commit', () => {
        events.push('editor');
        return done;
      }),
      concurrency: 'queue',
    });
    registry.register({
      ...base('user.command', () => {
        events.push('command');
        return done;
      }),
      beforeQueue: async () => {
        events.push('prepare');
        await registry.executeAction('editor.commit');
        await gate.promise;
      },
    });
    const work = registry.executeAction('user.command');
    expect(registry.pending).toBe(true);
    expect(await registry.executeAction('user.command')).toEqual({
      status: 'rejected',
      code: 'pending',
    });
    await Promise.resolve();
    expect(events).toEqual(['prepare', 'editor']);
    gate.resolve();
    expect(await work).toEqual(done);
    expect(events).toEqual(['prepare', 'editor', 'command']);
    expect(registry.getActionState('user.command').enabled).toBe(true);
  });
  it.each(['abort', 'dispose'] as const)(
    'cancels %s during preparation without enqueuing the command or repeating a write',
    async (mode) => {
      const gate = deferred();
      const write = vi.fn(() => done);
      const registry = createActionRegistry({ getContext: () => ({}) });
      registry.register({
        ...base('user.command', write),
        beforeQueue: () => gate.promise,
      });
      const controller = new AbortController();
      const work = registry.executeAction('user.command', undefined, {
        signal: controller.signal,
      });
      if (mode === 'dispose') registry.dispose();
      else controller.abort();
      expect(await work).toEqual({
        status: 'cancelled',
        code: mode === 'dispose' ? 'scope-disposed' : 'aborted',
      });
      gate.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(write).not.toHaveBeenCalled();
      if (mode === 'abort') {
        expect(await registry.executeAction('user.command')).toEqual(done);
        expect(write).toHaveBeenCalledTimes(1);
      }
    },
  );
  it('releases a rejected preparation and allocates its invocation identity only once', async () => {
    let blocked = true;
    const write = vi.fn(() => done);
    const ids: number[] = [];
    const registry = createActionRegistry({ getContext: () => ({}) });
    registry.register({
      ...base('user.command', write),
      beforeQueue: (_c, _a, execution) => {
        ids.push(execution.invocationId);
        return blocked
          ? { status: 'rejected', code: 'editing-invalid' }
          : undefined;
      },
    });
    expect(await registry.executeAction('user.command')).toEqual({
      status: 'rejected',
      code: 'editing-invalid',
    });
    blocked = false;
    expect(await registry.executeAction('user.command')).toEqual(done);
    expect(ids).toEqual([1, 2]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('captures a target before focus changes, but refreshes its current content', async () => {
    let focused = 'a';
    const contents = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    const seen: number[] = [];
    const registry = createActionRegistry({
      getContext: () => ({ id: focused, value: contents.get(focused)! }),
      refresh: (captured) =>
        contents.has(captured.id)
          ? { id: captured.id, value: contents.get(captured.id)! }
          : null,
    });
    registry.register(
      base('write', (context) => {
        seen.push(context.value);
        return done;
      }),
    );
    const captured = registry.actions()[0].capture();
    focused = 'b';
    contents.set('a', 3);
    expect(await captured.execute()).toEqual(done);
    expect(seen).toEqual([3]);
    contents.delete('a');
    expect(await captured.execute()).toEqual({
      status: 'cancelled',
      code: 'stale-context',
    });
    expect(seen).toEqual([3]);
  });

  it('serializes content execution including flush and captures queued calls immediately', async () => {
    let id = 'a';
    const flush = deferred();
    const events: string[] = [];
    const registry = createActionRegistry({
      getContext: () => ({ id }),
      beforeExecute: async (context) => {
        events.push(`flush:${context.id}`);
        if (context.id === 'a') await flush.promise;
      },
    });
    registry.register(
      base('write', (context) => {
        events.push(`write:${context.id}`);
        return done;
      }),
    );
    registry.register(
      base('write-next', (context) => {
        events.push(`write:${context.id}`);
        return done;
      }),
    );
    const first = registry.executeAction('write');
    id = 'b';
    const second = registry.executeAction('write-next');
    id = 'c';
    expect(registry.pending).toBe(true);
    expect(registry.getActionState('write')).toMatchObject({
      enabled: false,
      reason: 'pending',
    });
    expect(events).toEqual(['flush:a']);
    flush.resolve();
    await Promise.all([first, second]);
    await Promise.resolve();
    expect(events).toEqual(['flush:a', 'write:a', 'flush:b', 'write:b']);
    expect(registry.pending).toBe(false);
  });

  it('rechecks availability after the flush barrier', async () => {
    let writable = true;
    const flush = deferred();
    const execute = vi.fn(() => done);
    const registry = createActionRegistry({
      getContext: () => ({}),
      beforeExecute: () => flush.promise,
    });
    registry.register({
      ...base('write', execute),
      getState: () => ({ enabled: writable, reason: 'readonly' }),
    });
    const result = registry.executeAction('write');
    writable = false;
    flush.resolve();
    expect(await result).toEqual({ status: 'rejected', code: 'readonly' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('allows a definition to reject stale async work before committing', async () => {
    let alive = true;
    const ready = deferred();
    const commit = vi.fn();
    const registry = createActionRegistry({
      getContext: () => ({ id: 'a' }),
      refresh: (captured) => (alive ? captured : null),
    });
    registry.register(
      base('write', async (_context, _args, execution) => {
        await ready.promise;
        const rejected = execution.checkpoint();
        if (rejected) return rejected;
        commit();
        return done;
      }),
    );
    const result = registry.executeAction('write');
    alive = false;
    ready.resolve();
    expect(await result).toEqual({
      status: 'cancelled',
      code: 'stale-context',
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('cancels active and queued public results on dispose and signals in-flight work', async () => {
    const wait = deferred();
    const calls: AbortSignal[] = [];
    const registry = createActionRegistry({ getContext: () => ({}) });
    registry.register(
      base('write', async (_context, _args, execution) => {
        calls.push(execution.signal);
        await wait.promise;
        return done;
      }),
    );
    registry.register(
      base('queued', () => {
        throw new Error('Disposed queued action ran');
      }),
    );
    const first = registry.executeAction('write');
    expect(await registry.executeAction('write')).toEqual({
      status: 'rejected',
      code: 'pending',
    });
    const second = registry.executeAction('queued');
    registry.dispose();
    expect(await first).toEqual({
      status: 'cancelled',
      code: 'scope-disposed',
    });
    expect(await second).toEqual({
      status: 'cancelled',
      code: 'scope-disposed',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].aborted).toBe(true);
    wait.resolve();
    await Promise.resolve();
  });

  it('preserves synchronous user activation for external actions and rejects bad arguments', async () => {
    const prologue = vi.fn();
    const flush = vi.fn();
    const registry = createActionRegistry({
      getContext: () => ({}),
      beforeExecute: flush,
    });
    registry.register({
      id: 'open',
      label: 'open',
      category: 'test',
      effect: 'external',
      validateArgs: (args): args is string => typeof args === 'string',
      execute: (_context, args) => {
        prologue(args);
        return done;
      },
    });
    const result = registry.executeAction('open', 'url');
    expect(prologue).toHaveBeenCalledWith('url');
    expect(flush).not.toHaveBeenCalled();
    expect(await result).toEqual(done);
    expect(await registry.executeAction('open', 3)).toEqual({
      status: 'rejected',
      code: 'invalid-arguments',
    });
    expect(prologue).toHaveBeenCalledTimes(1);
  });

  it('does not disable toolbar state when a shortcut has a stricter selection rule', () => {
    let selected = false;
    const registry = createActionRegistry({ getContext: () => ({ selected }) });
    registry.register({
      ...base('arrow', () => done),
      shortcutWhen: (context) => !context.selected,
    });
    const shortcut = { key: 'a' };
    const bound = registry.actions()[0].capture();
    selected = true;
    expect(registry.actions()[0].shortcutEnabled(shortcut)).toBe(false);
    expect(bound.shortcutEnabled(shortcut)).toBe(true);
    expect(registry.getActionState('arrow').enabled).toBe(true);
  });

  it('rejects unconditional shortcut conflicts across categories and permits guarded bindings', () => {
    const registry = createActionRegistry({ getContext: () => ({}) });
    registry.register({
      ...base('one', () => done),
      shortcuts: [{ key: 'a' }],
    });
    expect(() => registry.register(base('one', () => done))).toThrow(
      'Duplicate action',
    );
    registry.register({
      ...base('two', () => done),
      category: 'other',
      shortcuts: [{ key: 'a' }],
    });
    expect(() => registry.seal()).toThrow('Conflicting action shortcut');
    const guarded = createActionRegistry({ getContext: () => ({}) });
    guarded.register({
      ...base('one', () => done),
      shortcuts: [{ key: 'a' }],
      shortcutWhen: () => false,
    });
    guarded.register({
      ...base('two', () => done),
      shortcuts: [{ key: 'a' }],
      shortcutWhen: () => true,
    });
    expect(() => guarded.seal()).not.toThrow();
  });

  it('isolates execution failures and subscriptions without poisoning the content queue', async () => {
    const registry = createActionRegistry({ getContext: () => ({}) });
    const notify = vi.fn();
    const unsubscribe = registry.subscribe(notify);
    registry.register(
      base('fail', () => {
        throw new Error('broken');
      }),
    );
    registry.register(base('next', () => done));
    const first = registry.executeAction('fail');
    const second = registry.executeAction('next');
    expect(await first).toMatchObject({ status: 'failed', message: 'broken' });
    expect(await second).toEqual(done);
    expect(registry.revision).toBeGreaterThan(0);
    expect(notify).toHaveBeenCalled();
    unsubscribe();
    notify.mockClear();
    registry.invalidate();
    expect(notify).not.toHaveBeenCalled();
    expect(await registry.executeAction('missing')).toEqual({
      status: 'rejected',
      code: 'unknown-action',
    });
  });
  it('starts transport preflight synchronously before a queued flush and ignores a stale receipt', async () => {
    const block = deferred();
    const events: string[] = [];
    let alive = true;
    const registry = createActionRegistry({
      getContext: () => ({ id: 'a' }),
      refresh: (captured) => (alive ? captured : null),
      beforeExecute: () => {
        events.push('flush');
      },
    });
    registry.register(
      base('block', async () => {
        await block.promise;
        return done;
      }),
    );
    registry.register({
      ...base('cut', (_context, _args, invocation) => {
        events.push('commit');
        expect(invocation.preflight).toBe('receipt');
        return done;
      }),
      beforeFlush: () => {
        events.push('transport');
        return 'receipt';
      },
    });
    const first = registry.executeAction('block');
    const cut = registry.executeAction('cut');
    expect(events).toEqual(['flush', 'transport']);
    expect(await registry.executeAction('cut')).toEqual({
      status: 'rejected',
      code: 'pending',
    });
    expect(events.filter((event) => event === 'transport')).toHaveLength(1);
    alive = false;
    block.resolve();
    await first;
    expect(await cut).toEqual({ status: 'cancelled', code: 'stale-context' });
    expect(events).not.toContain('commit');
  });
  it('flushes opted-in read/history actions after their synchronous transport without creating content work', async () => {
    const flushed = deferred();
    const events: string[] = [];
    const registry = createActionRegistry({
      getContext: () => ({}),
      beforeExecute: () => {
        events.push('flush');
        return flushed.promise;
      },
    });
    registry.register({
      ...base('copy', () => {
        events.push('snapshot');
        return done;
      }),
      effect: 'external',
      flushEditing: true,
      beforeFlush: () => {
        events.push('transport');
      },
    });
    const result = registry.executeAction('copy');
    expect(events).toEqual(['transport', 'flush']);
    expect(registry.pending).toBe(false);
    expect(await registry.executeAction('copy')).toEqual({
      status: 'rejected',
      code: 'pending',
    });
    flushed.resolve();
    expect(await result).toEqual(done);
    expect(events).toEqual(['transport', 'flush', 'snapshot']);
  });
});
