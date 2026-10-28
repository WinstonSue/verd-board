import type { ActionSource } from '@sue/board-react-actions';

/** A chrome surface resolves the active instance before its owner actions. */
export function combineFrameActionSources(
  sources: readonly ActionSource[],
): ActionSource {
  const actions = () =>
    [
      ...new Map(
        sources
          .flatMap((source) => source.actions())
          .map((action) => [action.id, action] as const)
          .reverse(),
      ).values(),
    ].reverse();
  return {
    actions,
    get revision() {
      return sources.reduce(
        (revision, source) => revision + source.revision,
        0,
      );
    },
    subscribe(listener) {
      const off = sources.map((source) => source.subscribe(listener));
      return () => off.forEach((dispose) => dispose());
    },
    getActionState(id, args) {
      return (
        actions()
          .find((action) => action.id === id)
          ?.getState(args) ?? {
          visible: false,
          enabled: false,
          reason: 'unknown-action',
        }
      );
    },
  };
}
