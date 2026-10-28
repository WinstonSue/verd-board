import type { ActionShortcut, BoundAction } from '@sue/board-common';

export interface ActionKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
}
export function matchesActionShortcut(
  event: ActionKeyEvent,
  shortcut: ActionShortcut,
): boolean {
  const key = event.key.toLowerCase();
  if (
    shortcut.transport === 'clipboard' ||
    ((event.ctrlKey || event.metaKey) && ['c', 'x', 'v'].includes(key))
  )
    return false;
  return (
    key === shortcut.key.toLowerCase() &&
    !!shortcut.mod === (event.ctrlKey || event.metaKey) &&
    !!shortcut.shift === event.shiftKey &&
    !!shortcut.alt === event.altKey &&
    (!event.repeat || !!shortcut.repeat)
  );
}
export function resolveActionShortcut(
  actions: readonly BoundAction[],
  event: ActionKeyEvent,
):
  | { status: 'matched'; action: BoundAction }
  | { status: 'conflict'; actions: readonly BoundAction[] }
  | { status: 'none' } {
  const matches = actions.filter((action) => {
    if (
      !action.shortcuts?.some(
        (shortcut) =>
          matchesActionShortcut(event, shortcut) &&
          action.shortcutEnabled(shortcut),
      )
    )
      return false;
    const state = action.getState();
    return state.visible && state.enabled;
  });
  return matches.length > 1
    ? { status: 'conflict', actions: matches }
    : matches.length === 1
      ? { status: 'matched', action: matches[0] }
      : { status: 'none' };
}
export function formatActionShortcut(
  shortcut: ActionShortcut,
  platform: 'mac' | 'other' = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform)
    ? 'mac'
    : 'other',
): string {
  const key =
    shortcut.key === ' '
      ? 'Space'
      : shortcut.key.length === 1
        ? shortcut.key.toUpperCase()
        : shortcut.key;
  return [
    shortcut.mod && (platform === 'mac' ? '⌘' : 'Ctrl'),
    shortcut.alt && (platform === 'mac' ? '⌥' : 'Alt'),
    shortcut.shift && (platform === 'mac' ? '⇧' : 'Shift'),
    key,
  ]
    .filter(Boolean)
    .join(platform === 'mac' ? '' : '+');
}
