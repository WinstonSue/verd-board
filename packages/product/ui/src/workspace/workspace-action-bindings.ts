import {
  actionLabel,
  type ActionLanguage,
  type ActionResult,
  type ActionState,
  type BoundAction,
} from '@sue/board-common';
import type { ActionSource } from '@sue/board-react-actions';

/** Captures the workspace identity and the explicit menu target before focus moves. */
export interface WorkspaceActionBinding {
  readonly id: string;
  label(language: ActionLanguage): string;
  getState(): ActionState;
  /** Draft fields may be supplied later; captured identity arguments take precedence. */
  execute(draft?: unknown): Promise<ActionResult>;
  capture(): WorkspaceActionBinding;
}
export function bindWorkspaceAction(
  source: ActionSource | undefined,
  id: string,
  args?: unknown,
): WorkspaceActionBinding | undefined {
  const action: BoundAction | undefined = source
    ?.actions()
    .find((action) => action.id === id)
    ?.capture();
  if (!action) return undefined;
  const binding: WorkspaceActionBinding = {
    id,
    label: (language) => actionLabel(action.label, language),
    getState: () => action.getState(args),
    execute: (draft) =>
      action.execute(
        draft === undefined
          ? args
          : args &&
              typeof args === 'object' &&
              draft &&
              typeof draft === 'object'
            ? { ...draft, ...args }
            : draft,
        { source: 'menu' },
      ),
    capture: () => binding,
  };
  return binding;
}
