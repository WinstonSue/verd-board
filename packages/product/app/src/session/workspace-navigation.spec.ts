import { describe, expect, it } from 'vitest';
import {
  normalizeWorkspaceSessionState,
  type WorkspaceSessionState,
} from '../host/workspace-host';
import {
  closeWorkspaceTabs,
  deleteWorkspaceTabGroup,
  pruneWorkspaceTabs,
  retainedWorkspaceTabs,
  updateWorkspaceNavigation,
  workspaceFileDirectories,
} from './workspace-navigation';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import { openWorkspaceSession } from './workspace-session';

const state = (): WorkspaceSessionState => ({
  tabs: ['a', 'b', 'c', 'd'].map((fileId) => ({ fileId })),
  activeTabId: 'd',
  expandedDirs: ['docs'],
});
const ids = (value: WorkspaceSessionState) =>
  value.tabs.map((tab) => tab.fileId);

describe('workspace tab navigation', () => {
  it('persists all groups through the workspace save queue and a reopened session', async () => {
    const host = createMemoryWorkspaceHost();
    const handle = (await host.openWorkspace({ path: 'group-round-trip' }))!;
    const session = await openWorkspaceSession(host, handle);
    const grouped = updateWorkspaceNavigation(state(), {
      groups: [
        { id: 'one', name: 'One', tabs: [{ fileId: 'a' }], activeTabId: 'a' },
        {
          id: 'two',
          name: 'Two',
          tabs: [{ fileId: 'a' }, { fileId: 'b' }],
          activeTabId: 'b',
        },
      ],
      activeGroupId: 'two',
    });
    session.setSessionState(grouped);
    expect(await session.flush()).toBe(true);
    session.dispose();
    const reopened = await openWorkspaceSession(host, handle);
    expect(reopened.getState().session).toEqual(grouped);
    reopened.dispose();
  });
  it('closes ranges in displayed order and keeps or restores the appropriate active tab', () => {
    expect(ids(closeWorkspaceTabs(state(), 'b', 'right'))).toEqual(['a', 'b']);
    expect(closeWorkspaceTabs(state(), 'b', 'right').activeTabId).toBe('b');
    expect(ids(closeWorkspaceTabs(state(), 'c', 'left'))).toEqual(['c', 'd']);
    expect(closeWorkspaceTabs(state(), 'c', 'left').activeTabId).toBe('d');
    expect(ids(closeWorkspaceTabs(state(), 'b', 'others'))).toEqual(['b']);
    expect(closeWorkspaceTabs(state(), 'b', 'others').activeTabId).toBe('b');
    expect(closeWorkspaceTabs(state(), 'd', 'self').activeTabId).toBe('c');
    expect(
      closeWorkspaceTabs({ ...state(), activeTabId: 'a' }, 'a', 'self')
        .activeTabId,
    ).toBe('b');
    expect(closeWorkspaceTabs(state(), 'missing', 'others')).toEqual(state());
    const only = closeWorkspaceTabs(state(), 'a', 'others');
    expect(closeWorkspaceTabs(only, 'a', 'self').activeTabId).toBeNull();
  });

  it('switches independent sets while retaining shared files once, and closes only the active group', () => {
    let current = updateWorkspaceNavigation(state(), {});
    const first = current.activeGroupId!;
    current = updateWorkspaceNavigation(current, {
      groups: [
        ...current.groups!,
        { id: 'two', name: 'Two', tabs: [], activeTabId: null },
      ],
      activeGroupId: 'two',
    });
    expect(current.tabs).toEqual([]);
    current = updateWorkspaceNavigation(current, {
      tabs: [{ fileId: 'a' }, { fileId: 'e' }],
      activeTabId: 'e',
    });
    expect(retainedWorkspaceTabs(current).map((tab) => tab.fileId)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
    current = updateWorkspaceNavigation(current, { activeGroupId: first });
    expect(current.activeTabId).toBe('d');
    current = closeWorkspaceTabs(current, 'a', 'others');
    expect(current.groups![1].tabs).toEqual([{ fileId: 'a' }, { fileId: 'e' }]);
    current = updateWorkspaceNavigation(current, { activeGroupId: 'two' });
    expect(current.activeTabId).toBe('e');
  });

  it('deletes groups, falls back to the left, and replaces the final group with an empty default', () => {
    let current = updateWorkspaceNavigation(state(), {});
    current = updateWorkspaceNavigation(current, {
      groups: [
        ...current.groups!,
        { id: 'two', name: 'Two', tabs: [{ fileId: 'e' }], activeTabId: 'e' },
        { id: 'three', name: 'Three', tabs: [], activeTabId: null },
      ],
      activeGroupId: 'two',
    });
    current = deleteWorkspaceTabGroup(current, 'two');
    expect(current.activeGroupId).toBe('default');
    expect(
      retainedWorkspaceTabs(current).some((tab) => tab.fileId === 'e'),
    ).toBe(false);
    current = deleteWorkspaceTabGroup(current, 'default');
    expect(current.activeGroupId).toBe('three');
    current = deleteWorkspaceTabGroup(current, 'three');
    expect(current.groups).toEqual([
      { id: 'default', name: '', tabs: [], activeTabId: null },
    ]);
    expect(current.activeTabId).toBeNull();
  });

  it('prunes removed files across inactive groups and preserves expanded folders', () => {
    const current = updateWorkspaceNavigation(state(), {
      groups: [
        {
          id: 'one',
          name: 'One',
          tabs: [{ fileId: 'gone' }, { fileId: 'a' }],
          activeTabId: 'gone',
        },
        {
          id: 'two',
          name: 'Two',
          tabs: [{ fileId: 'gone' }],
          activeTabId: 'gone',
        },
      ],
      activeGroupId: 'one',
    });
    const pruned = pruneWorkspaceTabs(current, (id) => id !== 'gone');
    expect(pruned.tabs).toEqual([{ fileId: 'a' }]);
    expect(pruned.activeTabId).toBe('a');
    expect(pruned.groups![1].tabs).toEqual([]);
    expect(pruned.expandedDirs).toEqual(['docs']);
  });

  it('reads legacy identities and round-trips groups using their active projection', () => {
    const legacy = normalizeWorkspaceSessionState({
      tabs: [{ frameId: 'a' }, { fileId: 'a' }],
      activeTabId: 'a',
    })!;
    expect(legacy.tabs).toEqual([{ fileId: 'a' }]);
    const grouped = updateWorkspaceNavigation(legacy, {
      groups: [
        { id: 'one', name: 'One', tabs: [{ fileId: 'a' }], activeTabId: 'a' },
        { id: 'two', name: 'Two', tabs: [{ fileId: 'b' }], activeTabId: 'b' },
      ],
      activeGroupId: 'two',
    });
    expect(
      normalizeWorkspaceSessionState(JSON.parse(JSON.stringify(grouped))),
    ).toEqual(grouped);
    const invalidActive = normalizeWorkspaceSessionState({
      ...grouped,
      activeGroupId: 'missing',
    })!;
    expect(invalidActive.activeTabId).toBe('a');
    expect(invalidActive.activeGroupId).toBe('one');
  });
});

it('reveals every ancestor of nested file paths and no directory for root files', () => {
  expect(workspaceFileDirectories('架构图/深入/模型.verd.json')).toEqual([
    '架构图',
    '架构图/深入',
  ]);
  expect(workspaceFileDirectories('项目导览.verd.json')).toEqual([]);
});
