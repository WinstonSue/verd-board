import type {
  WorkspaceSessionState,
  WorkspaceTabGroupState,
  WorkspaceTabRef,
} from '../host/workspace-host';

export type TabCloseScope = 'self' | 'left' | 'right' | 'others';

export const workspaceTabGroups = (
  state: WorkspaceSessionState,
): WorkspaceTabGroupState[] =>
  state.groups?.length
    ? state.groups
    : [
        {
          id: 'default',
          name: '',
          tabs: state.tabs,
          activeTabId: state.activeTabId,
        },
      ];

/** One mounted editor/runtime per file, even when several groups retain it. */
export const retainedWorkspaceTabs = (
  state: WorkspaceSessionState,
): WorkspaceTabRef[] => [
  ...new Map(
    workspaceTabGroups(state)
      .flatMap((group) => group.tabs)
      .map((tab) => [tab.fileId, tab]),
  ).values(),
];

export function updateWorkspaceNavigation(
  state: WorkspaceSessionState,
  patch: Partial<WorkspaceSessionState>,
): WorkspaceSessionState {
  let groups = patch.groups ?? workspaceTabGroups(state);
  if (!groups.length)
    groups = [{ id: 'default', name: '', tabs: [], activeTabId: null }];
  const activeGroupId =
    patch.activeGroupId ?? state.activeGroupId ?? groups[0].id;
  const active =
    groups.find((group) => group.id === activeGroupId) ?? groups[0];
  const tabs = patch.tabs ?? active.tabs;
  const requested =
    patch.activeTabId !== undefined ? patch.activeTabId : active.activeTabId;
  const activeTabId = tabs.some((tab) => tab.fileId === requested)
    ? requested
    : (tabs[0]?.fileId ?? null);
  groups = groups.map((group) =>
    group.id === active.id ? { ...group, tabs, activeTabId } : group,
  );
  return {
    ...state,
    expandedDirs: patch.expandedDirs ?? state.expandedDirs,
    groups,
    activeGroupId: active.id,
    tabs,
    activeTabId,
  };
}

export function closeWorkspaceTabs(
  state: WorkspaceSessionState,
  fileId: string,
  scope: TabCloseScope,
): WorkspaceSessionState {
  const at = state.tabs.findIndex((tab) => tab.fileId === fileId);
  if (at < 0) return state;
  const tabs = state.tabs.filter((_, index) =>
    scope === 'self'
      ? index !== at
      : scope === 'left'
        ? index >= at
        : scope === 'right'
          ? index <= at
          : index === at,
  );
  const activeTabId = tabs.some((tab) => tab.fileId === state.activeTabId)
    ? state.activeTabId
    : scope === 'self'
      ? (tabs[Math.max(0, at - 1)]?.fileId ?? null)
      : fileId;
  return updateWorkspaceNavigation(state, { tabs, activeTabId });
}

export function deleteWorkspaceTabGroup(
  state: WorkspaceSessionState,
  groupId: string,
): WorkspaceSessionState {
  const groups = workspaceTabGroups(state);
  const at = groups.findIndex((group) => group.id === groupId);
  if (at < 0) return state;
  const remaining = groups.filter((group) => group.id !== groupId);
  const activeGroupId =
    (state.activeGroupId ?? groups[0].id) === groupId
      ? remaining[Math.max(0, at - 1)]?.id
      : state.activeGroupId;
  return updateWorkspaceNavigation(state, { groups: remaining, activeGroupId });
}

export function pruneWorkspaceTabs(
  state: WorkspaceSessionState,
  exists: (id: string) => boolean,
): WorkspaceSessionState {
  const groups = workspaceTabGroups(state).map((group) => {
    const tabs = group.tabs.filter((tab) => exists(tab.fileId));
    return {
      ...group,
      tabs,
      activeTabId: tabs.some((tab) => tab.fileId === group.activeTabId)
        ? group.activeTabId
        : (tabs[tabs.length - 1]?.fileId ?? null),
    };
  });
  return updateWorkspaceNavigation(state, { groups });
}

/** Every directory needed to reveal a workspace-relative file path. */
export const workspaceFileDirectories = (filePath: string): string[] => {
  const parts = filePath.split('/');
  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join('/'));
};
