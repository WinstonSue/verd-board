import {
  createActionRegistry,
  type ActionDefinition,
  type ActionLabel,
  type ActionResult,
  type ActionShortcut,
  type ActionEffect,
  type ActionState,
} from '@sue/board-common';
import {
  normalizeWorkspaceSessionState,
  type WorkspaceSessionState,
} from '../host/workspace-host';
import type {
  CommandResult,
  WorkspaceCommand,
  WorkspaceSession,
} from './workspace-session';

export interface WorkspaceActionContext {
  session: WorkspaceSession | null;
  readonly?: boolean;
  /** Workspace switching/closing can pause before the session snapshot changes. */
  paused?: boolean;
  /** Captured editing surface barrier; refresh must never retarget it. */
  flushEditing?(): Promise<ActionResult | void>;
}
export interface WorkspaceDialogAction {
  id: `workspace.${string}`;
  label: ActionLabel;
  category?: string;
  shortcuts?: readonly ActionShortcut[];
  /** Navigation/open/export may remain available in a read-only workspace. */
  requiresWrite?: boolean;
  effect?: ActionEffect;
  /** Recovery operations may run while mutations are paused. */
  allowPaused?: boolean;
  /** Workspace-opening recovery controls exist before a session is available. */
  allowNoSession?: boolean;
  /** Late native tab/tree events may still persist metadata to their captured old session. */
  sessionMetadata?: boolean;
  concurrency?: 'queue' | 'reject';
  flushEditing?: boolean;
  getState?(
    context: WorkspaceActionContext,
    args: unknown,
  ): Partial<ActionState>;
  palette?: boolean;
  validateArgs?(args: unknown): boolean;
  execute(
    context: WorkspaceActionContext,
    args?: unknown,
  ): void | ActionResult | Promise<void | ActionResult>;
}
const commandTypes = [
  'batch',
  'create-document-frame',
  'store',
  'file',
  'create-file',
  'move-file',
  'organize-entries',
  'move-directory',
  'rename-canvas',
  'rename-document',
  'trash-file',
  'restore-file',
  'trash-directory',
  'purge-trash',
  'duplicate-file',
  'duplicate-reference',
  'import-files',
  'edit-file',
  'edit-files',
] as const satisfies readonly WorkspaceCommand['type'][];
type AssertNever<T extends never> = T;
/** Adding a WorkspaceCommand variant must add its action above. */
export type UnregisteredWorkspaceCommand = AssertNever<
  Exclude<WorkspaceCommand['type'], (typeof commandTypes)[number]>
>;
const commandResults = new WeakMap<ActionResult, CommandResult>();
export function workspaceCommandActionResult(
  command: CommandResult,
): ActionResult {
  const result: ActionResult = command.ok
    ? { status: 'completed' }
    : {
        status: 'rejected',
        code: 'workspace-command-rejected',
        message: command.diagnostics.map((entry) => entry.message).join('; '),
      };
  commandResults.set(result, command);
  return result;
}
const resultFor = workspaceCommandActionResult;
/** Preserve diagnostics/restored selection for existing workspace service callers. */
export function workspaceActionCommandResult(
  result: ActionResult,
): CommandResult {
  return (
    commandResults.get(result) ?? {
      ok: result.status === 'completed' || result.status === 'noop',
      diagnostics:
        result.status === 'completed' || result.status === 'noop'
          ? []
          : [
              {
                message:
                  'code' in result
                    ? (result.message ?? result.code)
                    : 'Action failed',
              },
            ],
    }
  );
}
const availability = (context: WorkspaceActionContext, write: boolean) => {
  if (!context.session) return { enabled: false, reason: 'no-workspace' };
  if (write && context.readonly) return { enabled: false, reason: 'readonly' };
  if (context.paused || context.session.getState().mutationsPaused)
    return { enabled: false, reason: 'workspace-paused' };
  return { enabled: true };
};
export function createWorkspaceActionRegistry(options: {
  /** Return the latest session/permissions on every call. */
  getContext(): WorkspaceActionContext;
  dialogs?: readonly WorkspaceDialogAction[];
}) {
  const registry = createActionRegistry<WorkspaceActionContext>({
    getContext: options.getContext,
    refresh(captured) {
      const current = options.getContext();
      return current.session === captured.session
        ? { ...current, flushEditing: captured.flushEditing }
        : null;
    },
  });
  for (const type of commandTypes) {
    const definition: ActionDefinition<
      WorkspaceActionContext,
      WorkspaceCommand
    > = {
      id: `workspace.${type}`,
      label: type,
      category: 'workspace',
      effect: 'content',
      palette: false,
      concurrency: 'queue',
      validateArgs: (args): args is WorkspaceCommand =>
        !!args &&
        typeof args === 'object' &&
        'type' in args &&
        args.type === type,
      getState: (context) => availability(context, true),
      async execute(context, command, invocation) {
        const invalid = invocation.checkpoint();
        if (invalid) return invalid;
        return resultFor(await context.session!.apply(command));
      },
    };
    registry.register(definition);
  }
  for (const direction of ['undo', 'redo'] as const) {
    registry.register({
      id: `workspace.history.${direction}`,
      label: {
        zh: direction === 'undo' ? '撤销' : '重做',
        en: direction === 'undo' ? 'Undo' : 'Redo',
      },
      category: 'workspace',
      // Workspace history mutates canonical files and shares their serial lane.
      effect: 'content',
      concurrency: 'queue',
      beforeQueue: (context) => context.flushEditing?.(),
      getState(context) {
        const base = availability(context, true);
        const state = context.session?.getState();
        return {
          ...base,
          enabled:
            base.enabled &&
            !!(direction === 'undo' ? state?.canUndo : state?.canRedo),
        };
      },
      execute: async (context) =>
        resultFor(await context.session![direction]()),
    });
  }
  registry.register<{
    fileId: string;
    action: 'keep-local' | 'load-disk' | 'save-copy';
  }>({
    id: 'workspace.resolve-conflict',
    label: 'Resolve conflict',
    category: 'workspace',
    effect: 'content',
    palette: false,
    validateArgs: (
      args,
    ): args is {
      fileId: string;
      action: 'keep-local' | 'load-disk' | 'save-copy';
    } =>
      !!args &&
      typeof args === 'object' &&
      'fileId' in args &&
      typeof args.fileId === 'string' &&
      'action' in args &&
      (args.action === 'keep-local' ||
        args.action === 'load-disk' ||
        args.action === 'save-copy'),
    getState: (context) => availability(context, true),
    execute: async (context, args) =>
      resultFor(
        await context.session!.resolveConflict(args.fileId, args.action),
      ),
  });
  registry.register<{ path: string }>({
    id: 'workspace.mkdir',
    label: { zh: '新建文件夹', en: 'New folder' },
    category: 'workspace',
    effect: 'content',
    palette: false,
    concurrency: 'queue',
    validateArgs: (args): args is { path: string } =>
      !!args &&
      typeof args === 'object' &&
      'path' in args &&
      typeof args.path === 'string',
    getState: (context) => availability(context, true),
    execute: (context, args) => resultFor(context.session!.mkdir(args.path)),
  });
  registry.register<{ value: Record<string, unknown> }>({
    id: 'workspace.set-config',
    label: { zh: '更新工作区设置', en: 'Update workspace settings' },
    category: 'workspace',
    effect: 'content',
    palette: false,
    concurrency: 'queue',
    validateArgs: (args): args is { value: Record<string, unknown> } =>
      !!args &&
      typeof args === 'object' &&
      'value' in args &&
      !!args.value &&
      typeof args.value === 'object' &&
      !Array.isArray(args.value),
    getState: (context) => availability(context, true),
    async execute(context, args) {
      context.session!.setWorkspaceConfig(args.value);
      return (await context.session!.flush())
        ? { status: 'completed' }
        : { status: 'failed', code: 'workspace-config-save-failed' };
    },
  });
  registry.register<{ state: WorkspaceSessionState }>({
    id: 'workspace.navigation.update',
    label: 'Update workspace navigation',
    category: 'workspace',
    effect: 'view',
    palette: false,
    validateArgs: (args): args is { state: WorkspaceSessionState } =>
      !!args &&
      typeof args === 'object' &&
      'state' in args &&
      !!normalizeWorkspaceSessionState(args.state),
    getState: (context) =>
      context.session
        ? { enabled: true }
        : { enabled: false, reason: 'no-workspace' },
    execute(context, args) {
      context.session!.setSessionState(
        normalizeWorkspaceSessionState(args.state)!,
      );
      return { status: 'completed' };
    },
  });
  for (const dialog of options.dialogs ?? []) {
    registry.register({
      id: dialog.id,
      label: dialog.label,
      category: dialog.category ?? 'workspace',
      shortcuts: dialog.shortcuts,
      effect: dialog.effect ?? 'dialog',
      concurrency: dialog.concurrency,
      palette: dialog.palette,
      validateArgs: (args): args is unknown =>
        dialog.validateArgs?.(args) ?? true,
      getState: (context, args) => {
        const base = dialog.sessionMetadata
          ? context.session
            ? { enabled: true }
            : { enabled: false, reason: 'no-workspace' }
          : dialog.allowPaused
            ? !context.session
              ? dialog.allowNoSession
                ? { enabled: !context.paused }
                : { enabled: false, reason: 'no-workspace' }
              : context.paused
                ? { enabled: false, reason: 'workspace-paused' }
                : dialog.requiresWrite && context.readonly
                  ? { enabled: false, reason: 'readonly' }
                  : { enabled: true }
            : availability(context, !!dialog.requiresWrite);
        const local = dialog.getState?.(context, args) ?? {};
        return {
          ...local,
          enabled: base.enabled && local.enabled !== false,
          reason: base.enabled ? local.reason : base.reason,
        };
      },
      beforeQueue: dialog.flushEditing
        ? (context) => context.flushEditing?.()
        : undefined,
      execute(context, args) {
        // Call before awaiting to retain window/file picker user activation.
        const result = dialog.execute(context, args);
        return result && typeof result === 'object' && 'then' in result
          ? result.then((value) => value ?? { status: 'completed' })
          : (result ?? { status: 'completed' });
      },
    });
  }
  registry.seal();
  return registry;
}
