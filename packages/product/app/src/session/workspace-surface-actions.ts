import { isWorkspaceContentPath } from '@sue/verd-board-workspace';
import { readOrganization } from '@sue/verd-board-workspace';
import type { WorkspaceHostCapabilities } from '@sue/verd-board-workspace';
import type { ActionResult } from '@sue/board-common';
import { workspaceTabGroups } from '@sue/verd-board-workspace';
import { isReferenceLocation } from '../documents/reference-locations';
import {
  customSkillDefinition,
  workspaceSkillDefinition,
  type WorkspaceSkillCommit,
} from '@sue/verd-board-workspace';
import {
  workspaceCommandActionResult,
  type WorkspaceActionContext,
  type WorkspaceDialogAction,
} from './workspace-actions';

/** Inventory of discrete workspace entries. Native text drafts and drag transport stay in widgets. */
export const WORKSPACE_UI_ACTION_IDS = [
  'create-canvas',
  'create-document',
  'import',
  'library',
  'settings',
  'my',
  'command-palette',
  'quick-open',
  'search',
  'return',
  'open-folder',
  'open-builtin',
  'open-patterns',
  'open-history',
  'file.open',
  'file.versions',
  'resource.versions',
  'directory.versions',
  'resource.open',
  'resource.rename-dialog',
  'resource.move-dialog',
  'resource.trash',
  'file.reveal',
  'file.return',
  'reference.locate',
  'file.rename',
  'file.move-dialog',
  'directory.rename',
  'directory.move',
  'file.move',
  'file.duplicate',
  'file.copy-link',
  'file.favorite',
  'file.unfavorite',
  'file.export',
  'file.trash',
  'directory.create-canvas',
  'directory.create-document',
  'directory.new',
  'directory.new-here',
  'directory.confirm-trash',
  'directory.trash',
  'directory.copy-link',
  'directory.toggle',
  'tab.activate',
  'tab.close',
  'tab.reorder',
  'group.switch',
  'group.create-dialog',
  'group.rename-dialog',
  'group.create',
  'group.rename',
  'group.delete',
  'trash.confirm-purge',
  'trash.confirm-clear',
  'trash.restore',
  'trash.purge',
  'trash.retry',
  'save-retry',
  'reload',
  'settings.patch',
  'skills.save',
  'skills.create',
  'skills.remove',
  'tab.close-left',
  'tab.close-right',
  'tab.close-others',
  'library.back',
  'library.pick',
  'conflict.keep-local',
  'conflict.load-disk',
  'conflict.save-copy',
  'conflict.compare',
] as const;
/** Migration ledger: each surface consumes these semantic IDs for names, state and execution. */
export const WORKSPACE_ACTION_SURFACES = {
  fileNavigation: [
    'file.open',
    'file.versions',
    'resource.versions',
    'directory.versions',
    'file.reveal',
    'file.return',
    'reference.locate',
  ],
  fileTree: [
    'resource.open',
    'resource.rename-dialog',
    'resource.move-dialog',
    'resource.trash',
    'create-canvas',
    'create-document',
    'import',
    'library',
    'file.open',
    'file.versions',
    'resource.versions',
    'directory.versions',
    'file.reveal',
    'file.rename',
    'file.move',
    'file.duplicate',
    'file.copy-link',
    'file.favorite',
    'file.unfavorite',
    'file.export',
    'file.trash',
    'directory.create-canvas',
    'directory.create-document',
    'directory.new',
    'directory.new-here',
    'directory.confirm-trash',
    'directory.trash',
    'directory.copy-link',
    'directory.toggle',
    'mkdir',
  ],
  workspaceMenu: [
    'settings',
    'open-folder',
    'open-builtin',
    'open-patterns',
    'open-history',
    'my',
    'return',
    'command-palette',
    'reload',
  ],
  tabs: [
    'create-canvas',
    'tab.activate',
    'tab.close',
    'tab.close-left',
    'tab.close-right',
    'tab.close-others',
    'tab.reorder',
    'group.switch',
    'group.create-dialog',
    'group.rename-dialog',
    'group.create',
    'group.rename',
    'group.delete',
  ],
  library: ['file.open', 'library.back', 'library.pick'],
  trash: [
    'trash.confirm-purge',
    'trash.confirm-clear',
    'trash.restore',
    'trash.purge',
    'trash.retry',
  ],
  settings: ['settings.patch', 'skills.create', 'skills.save', 'skills.remove'],
  banners: [
    'conflict.keep-local',
    'conflict.load-disk',
    'conflict.save-copy',
    'conflict.compare',
    'trash.retry',
    'save-retry',
  ],
} as const;
/** These are draft/transport/lifecycle capabilities, not independently executable commands. */
export const WORKSPACE_NATIVE_INTERACTIONS = [
  'text/number drafts, picker selection, search/filter/scroll, disclosure and dialog dismissal',
  'pointer/drop transport captures arguments; its final reorder/placement commit uses actions',
  'initial workspace seed/migration and host shutdown/pagehide flush run before/after interactive scopes',
] as const;
export interface WorkspaceSurfaceState {
  allowWorkspaceSwitching: boolean;
  capabilities?: Readonly<WorkspaceHostCapabilities>;
  isDefaultWorkspace: boolean;
  workspaceHistory?: ReadonlySet<string>;
  currentHistoryId?: string;
  hasOrigin: boolean;
  returnSources?: ReadonlyMap<string, string>;
}
export const workspaceActionArgument = (
  args: unknown,
  name: string,
): unknown =>
  args && typeof args === 'object'
    ? (args as Record<string, unknown>)[name]
    : undefined;
const stringArg = (args: unknown, name: string) =>
  typeof workspaceActionArgument(args, name) === 'string';
const fileExists = (c: WorkspaceActionContext, args: unknown) => {
  const id = workspaceActionArgument(args, 'fileId');
  const state = c.session?.getState();
  return (
    typeof id === 'string' &&
    !!(state?.files.has(id) || state?.documents.has(id))
  );
};
const directoryExists = (c: WorkspaceActionContext, args: unknown) => {
  const path =
    workspaceActionArgument(args, 'dirPath') ??
    workspaceActionArgument(args, 'path') ??
    '';
  return (
    path === '' ||
    c.session
      ?.getState()
      .entries.some(
        (entry) => entry.kind === 'directory' && entry.path === path,
      )
  );
};
const groupExists = (c: WorkspaceActionContext, args: unknown) =>
  !!c.session &&
  workspaceTabGroups(c.session.getState().session).some(
    (group) => group.id === workspaceActionArgument(args, 'groupId'),
  );
const targetState = (exists: boolean | undefined) => ({
  enabled: !!exists,
  reason: exists ? undefined : 'missing-target',
});

export function createWorkspaceSurfaceActions(options: {
  getState(): WorkspaceSurfaceState;
  invoke(
    id: string,
    args?: unknown,
  ): void | ActionResult | Promise<void | ActionResult>;
}): WorkspaceDialogAction[] {
  const entries: WorkspaceDialogAction[] = [];
  const add = (
    id: string,
    zh: string,
    en: string,
    extra: Partial<WorkspaceDialogAction> = {},
  ) => {
    entries.push({
      id: `workspace.${id}`,
      label: { zh, en },
      allowPaused: true,
      execute: (_c, args) => options.invoke(id, args),
      ...extra,
    });
  };
  const write = (
    extra: Partial<WorkspaceDialogAction> = {},
  ): Partial<WorkspaceDialogAction> => ({
    requiresWrite: true,
    allowPaused: false,
    getState: (c) => ({ visible: !c.readonly }),
    ...extra,
  });
  for (const [id, zh, en] of [
    ['create-canvas', '新建画布', 'New canvas'],
    ['create-document', '新建文档', 'New document'],
    ['directory.create-canvas', '在此新建画布', 'New canvas here'],
    ['directory.create-document', '在此新建文档', 'New document here'],
  ])
    add(
      id,
      zh,
      en,
      write({
        palette: !id.startsWith('directory.'),
        validateArgs: (args) =>
          args === undefined ||
          (args !== null &&
            typeof args === 'object' &&
            (workspaceActionArgument(args, 'dirPath') === undefined ||
              stringArg(args, 'dirPath'))),
        getState: (c, args) => ({
          ...targetState(directoryExists(c, args)),
          visible: !c.readonly,
        }),
      }),
    );
  add('import', '导入画布/包', 'Import canvas/bundle', write());
  add('library', '图表库', 'Chart library');
  add('settings', '工作区设置', 'Workspace settings');
  add('my', '设置', 'Settings');
  add('quick-open', '快速打开', 'Quick open', {
    flushEditing: true,
    shortcuts: [{ key: 'p', mod: true }],
  });
  add('search', '搜索工作区', 'Search workspace', {
    flushEditing: true,
    shortcuts: [{ key: 'f', mod: true, shift: true }],
  });
  add('command-palette', '命令面板', 'Command palette', {
    palette: false,
    shortcuts: [{ key: 'p', mod: true, shift: true }],
  });
  add('return', '返回来源', 'Return to source', {
    effect: 'view',
    flushEditing: true,
    getState: () => ({
      visible: options.getState().hasOrigin,
      enabled: options.getState().hasOrigin,
    }),
  });
  add('file.return', '返回来源', 'Return to source', {
    effect: 'view',
    palette: false,
    flushEditing: true,
    validateArgs: (args) => stringArg(args, 'fileId'),
    getState: (c, args) => {
      const sourceId = options
        .getState()
        .returnSources?.get(String(workspaceActionArgument(args, 'fileId')));
      const sourceExists =
        !!sourceId &&
        !!(
          c.session?.getState().files.has(sourceId) ||
          c.session?.getState().documents.has(sourceId)
        );
      return {
        ...targetState(
          sourceExists &&
            fileExists(c, args) &&
            c.session?.getState().session.activeTabId ===
              workspaceActionArgument(args, 'fileId'),
        ),
        visible: sourceExists,
      };
    },
  });
  add('reference.locate', '定位引用', 'Locate reference', {
    effect: 'view',
    palette: false,
    flushEditing: true,
    validateArgs: (args) => {
      const location = workspaceActionArgument(args, 'location');
      return (
        isReferenceLocation(location) &&
        stringArg(args, 'fromFileId') &&
        location.sourceFileId === workspaceActionArgument(args, 'fileId')
      );
    },
    getState: (c, args) =>
      targetState(
        fileExists(c, args) &&
          c.session?.getState().session.activeTabId ===
            workspaceActionArgument(args, 'fromFileId'),
      ),
  });
  add('open-folder', '打开工作区文件夹', 'Open workspace folder', {
    allowNoSession: true,
    getState: (c) => ({
      visible:
        options.getState().allowWorkspaceSwitching &&
        !c.readonly &&
        options.getState().capabilities?.pickWorkspace !== false,
    }),
  });
  add('open-patterns', '文档编写推荐库', 'Document authoring recommendations', {
    allowNoSession: true,
    getState: (c) => ({
      visible:
        options.getState().allowWorkspaceSwitching &&
        !c.readonly &&
        options.getState().capabilities?.openPatternWorkspace !== false,
    }),
  });
  add('open-builtin', '打开系统介绍', 'Open system introduction', {
    allowNoSession: true,
    getState: (c) => ({
      visible:
        options.getState().allowWorkspaceSwitching &&
        !c.readonly &&
        options.getState().capabilities?.openBuiltinWorkspace !== false,
      enabled: !options.getState().isDefaultWorkspace,
      reason: options.getState().isDefaultWorkspace
        ? 'already-active'
        : undefined,
    }),
  });
  add('open-history', '打开历史工作区', 'Open recorded workspace', {
    allowNoSession: true,
    palette: false,
    validateArgs: (args) => stringArg(args, 'historyId'),
    getState: (c, args) => {
      const state = options.getState();
      const id = workspaceActionArgument(args, 'historyId');
      const exists = typeof id === 'string' && state.workspaceHistory?.has(id);
      const visible =
        state.allowWorkspaceSwitching &&
        !!state.workspaceHistory &&
        !c.readonly;
      return {
        visible,
        enabled: visible && !!exists && id !== state.currentHistoryId,
        reason: !exists
          ? 'missing-target'
          : id === state.currentHistoryId
            ? 'already-active'
            : undefined,
      };
    },
  });
  for (const [id, zh, en, effect] of [
    ['file.open', '打开', 'Open', 'view'],
    ['file.reveal', '在文件夹中显示', 'Show in folder', 'view'],
    ['file.export', '导出(含依赖)', 'Export (with closure)', 'external'],
    ['file.copy-link', '复制链接', 'Copy link', 'external'],
  ] as const)
    add(id, zh, en, {
      effect,
      palette: false,
      validateArgs: (args) => stringArg(args, 'fileId'),
      getState: (c, args) => targetState(fileExists(c, args)),
    });
  for (const [id, favorite, zh, en] of [
    ['file.favorite', true, '收藏', 'Favorite'],
    ['file.unfavorite', false, '取消收藏', 'Unfavorite'],
  ] as const)
    add(
      id,
      zh,
      en,
      write({
        effect: 'content',
        concurrency: 'queue',
        palette: false,
        validateArgs: (args) => stringArg(args, 'fileId'),
        getState: (c, args) => {
          const exists = fileExists(c, args);
          const config = c.session?.getState().config.value;
          const fileId = String(workspaceActionArgument(args, 'fileId'));
          return {
            ...targetState(exists),
            visible:
              !c.readonly &&
              exists &&
              !!config &&
              readOrganization(config).favorites.includes(fileId) !== favorite,
          };
        },
        execute: async (c, args) => {
          const session = c.session!;
          const config = session.getState().config.value;
          const navigation = readOrganization(config);
          const fileId = String(workspaceActionArgument(args, 'fileId'));
          if (navigation.favorites.includes(fileId) === favorite)
            return { status: 'noop' };
          navigation.favorites = favorite
            ? [...navigation.favorites, fileId]
            : navigation.favorites.filter((id) => id !== fileId);
          session.setWorkspaceConfig({ ...config, navigation });
          return (await session.flush())
            ? { status: 'completed' }
            : { status: 'failed', code: 'workspace-config-save-failed' };
        },
      }),
    );
  const present = (_c: WorkspaceActionContext, args: unknown): ActionResult => {
    const callback = workspaceActionArgument(args, 'present');
    if (typeof callback !== 'function')
      return { status: 'rejected', code: 'ui-capability-missing' };
    callback();
    return { status: 'completed' };
  };
  add(
    'file.move-dialog',
    '移动到…',
    'Move to…',
    write({
      palette: false,
      validateArgs: (args) => stringArg(args, 'fileId'),
      getState: (c, args) => ({
        ...targetState(fileExists(c, args)),
        visible: !c.readonly,
      }),
      execute: present,
    }),
  );
  for (const [id, zh, en] of [
    ['directory.rename', '重命名', 'Rename'],
    ['directory.move', '移动到…', 'Move to…'],
  ] as const)
    add(
      id,
      zh,
      en,
      write({
        palette: false,
        validateArgs: (args) => stringArg(args, 'dirPath'),
        getState: (c, args) => ({
          ...targetState(directoryExists(c, args)),
          visible: !c.readonly,
        }),
        execute: present,
      }),
    );
  add(
    'file.rename',
    '重命名/移动',
    'Rename/move',
    write({
      palette: false,
      validateArgs: (args) => stringArg(args, 'fileId'),
      getState: (c, args) => ({
        ...targetState(fileExists(c, args)),
        visible: !c.readonly,
      }),
      execute: present,
    }),
  );
  add(
    'directory.new',
    '新建文件夹',
    'New folder',
    write({
      palette: false,
      validateArgs: (args) => stringArg(args, 'dirPath'),
      getState: (c, args) => ({
        ...targetState(directoryExists(c, args)),
        visible: !c.readonly,
      }),
      execute: present,
    }),
  );
  add(
    'directory.confirm-trash',
    '移入回收站',
    'Move to trash',
    write({
      palette: false,
      validateArgs: (args) => stringArg(args, 'path'),
      getState: (c, args) => ({
        ...targetState(
          directoryExists(c, args) &&
            workspaceActionArgument(args, 'path') !== '',
        ),
        visible: !c.readonly,
      }),
      execute: present,
    }),
  );
  for (const [id, zh, en, command] of [
    [
      'file.duplicate',
      '创建独立副本',
      'Duplicate independently',
      'duplicate-file',
    ],
    ['file.trash', '移入回收站', 'Move to trash', 'trash-file'],
  ] as const)
    add(
      id,
      zh,
      en,
      write({
        effect: 'content',
        palette: false,
        validateArgs: (args) => stringArg(args, 'fileId'),
        getState: (c, args) => ({
          ...targetState(fileExists(c, args)),
          visible: !c.readonly,
        }),
        execute: async (c, args) =>
          workspaceCommandActionResult(
            await c.session!.apply({
              type: command,
              frameId: String(workspaceActionArgument(args, 'fileId')),
            }),
          ),
      }),
    );
  add(
    'file.move',
    '重命名/移动',
    'Rename/move',
    write({
      effect: 'content',
      palette: false,
      validateArgs: (args) =>
        stringArg(args, 'fileId') && stringArg(args, 'toPath'),
      getState: (c, args) => ({
        ...targetState(fileExists(c, args)),
        visible: !c.readonly,
      }),
      execute: async (c, args) =>
        workspaceCommandActionResult(
          await c.session!.apply({
            type: 'move-file',
            frameId: String(workspaceActionArgument(args, 'fileId')),
            toPath: String(workspaceActionArgument(args, 'toPath')),
          }),
        ),
    }),
  );
  add(
    'directory.trash',
    '移入回收站',
    'Move to trash',
    write({
      effect: 'content',
      palette: false,
      validateArgs: (args) => stringArg(args, 'path'),
      getState: (c, args) => ({
        ...targetState(
          directoryExists(c, args) &&
            workspaceActionArgument(args, 'path') !== '',
        ),
        visible: !c.readonly,
      }),
      execute: async (c, args) =>
        workspaceCommandActionResult(
          await c.session!.apply({
            type: 'trash-directory',
            path: String(workspaceActionArgument(args, 'path')),
          }),
        ),
    }),
  );
  add('directory.copy-link', '复制链接', 'Copy link', {
    effect: 'external',
    palette: false,
    validateArgs: (args) => stringArg(args, 'path'),
    getState: (c, args) => {
      const path = workspaceActionArgument(args, 'path');
      const entry = c.session
        ?.getState()
        .entries.find(
          (item) => item.kind === 'directory' && item.path === path,
        );
      return {
        ...targetState(!!entry),
        enabled: !!entry && (!c.readonly || !!entry.folderId),
        reason: c.readonly && !entry?.folderId ? 'readonly' : undefined,
      };
    },
  });
  add('directory.toggle', '展开/收起文件夹', 'Toggle directory', {
    effect: 'view',
    palette: false,
    validateArgs: (args) => stringArg(args, 'path'),
    getState: (c, args) => ({
      ...targetState(directoryExists(c, args)),
      checked: c.session
        ?.getState()
        .session.expandedDirs.includes(
          String(workspaceActionArgument(args, 'path')),
        ),
    }),
  });
  const resourceExists = (c: WorkspaceActionContext, args: unknown) => {
    const path = workspaceActionArgument(args, 'path');
    return (
      typeof path === 'string' &&
      isWorkspaceContentPath(path) &&
      !!c.session
        ?.getState()
        .entries.some(
          (entry) =>
            entry.path === path &&
            entry.kind === 'file' &&
            !entry.canvas &&
            !entry.document &&
            !/\.verd(?:-doc)?\.json$/.test(path),
        )
    );
  };
  for (const kind of ['file', 'resource', 'directory'])
    add(`${kind}.versions`, '版本历史', 'Version history', {
      effect: 'view',
      palette: false,
      flushEditing: true,
      execute: present,
      validateArgs: (args) =>
        stringArg(args, kind === 'file' ? 'fileId' : 'path'),
      getState: (c, args) =>
        targetState(
          kind === 'file'
            ? fileExists(c, args)
            : !!c.session
                ?.getState()
                .entries.some(
                  (e) =>
                    e.path === workspaceActionArgument(args, 'path') &&
                    e.kind === (kind === 'directory' ? 'directory' : 'file'),
                ),
        ),
    });
  add('resource.open', '打开', 'Open', {
    effect: 'view',
    palette: false,
    flushEditing: true,
    validateArgs: (args) => stringArg(args, 'path'),
    getState: (c, args) => targetState(resourceExists(c, args)),
    execute: present,
  });
  for (const [id, zh, en] of [
    ['resource.rename-dialog', '重命名', 'Rename'],
    ['resource.move-dialog', '移动到…', 'Move to…'],
  ])
    add(
      id,
      zh,
      en,
      write({
        palette: false,
        validateArgs: (args) => stringArg(args, 'path'),
        getState: (c, args) => targetState(resourceExists(c, args)),
        execute: present,
      }),
    );
  add(
    'resource.trash',
    '移入回收站',
    'Move to trash',
    write({
      effect: 'content',
      palette: false,
      validateArgs: (args) => stringArg(args, 'path'),
      getState: (c, args) => targetState(resourceExists(c, args)),
      execute: async (c, args) =>
        workspaceCommandActionResult(
          await c.session!.apply({
            type: 'organize-entries',
            trashPaths: [String(workspaceActionArgument(args, 'path'))],
          }),
        ),
    }),
  );
  const tabExists = (c: WorkspaceActionContext, args: unknown) =>
    !!c.session &&
    workspaceTabGroups(c.session.getState().session).some((group) =>
      group.tabs.some(
        (tab) => tab.fileId === workspaceActionArgument(args, 'fileId'),
      ),
    );
  add('tab.activate', '打开标签页', 'Activate tab', {
    effect: 'view',
    palette: false,
    validateArgs: (args) => stringArg(args, 'fileId'),
    getState: (c, args) => targetState(tabExists(c, args)),
  });
  for (const [scope, zh, en] of [
    ['self', '关闭', 'Close'],
    ['left', '关闭左侧所有', 'Close all to the left'],
    ['right', '关闭右侧所有', 'Close all to the right'],
    ['others', '关闭其他所有', 'Close all others'],
  ] as const)
    add(`tab.close${scope === 'self' ? '' : `-${scope}`}`, zh, en, {
      effect: 'view',
      palette: false,
      validateArgs: (args) => stringArg(args, 'fileId'),
      getState: (c, args) => {
        const tabs = c.session?.getState().session.tabs ?? [];
        const at = tabs.findIndex(
          (tab) => tab.fileId === workspaceActionArgument(args, 'fileId'),
        );
        return targetState(
          at >= 0 &&
            (scope === 'self' ||
              (scope === 'left'
                ? at > 0
                : scope === 'right'
                  ? at < tabs.length - 1
                  : tabs.length > 1)),
        );
      },
      execute: (_c, args) =>
        options.invoke('tab.close', { ...(args as object), scope }),
    });
  add('tab.reorder', '移动标签页', 'Move tab', {
    effect: 'view',
    palette: false,
    validateArgs: (args) =>
      stringArg(args, 'fileId') && stringArg(args, 'targetFileId'),
    getState: (c, args) =>
      targetState(
        tabExists(c, args) &&
          tabExists(c, {
            fileId: workspaceActionArgument(args, 'targetFileId'),
          }),
      ),
  });
  add('group.switch', '切换分组', 'Switch group', {
    effect: 'view',
    palette: false,
    validateArgs: (args) => stringArg(args, 'groupId'),
    getState: (c, args) => targetState(groupExists(c, args)),
  });
  add('group.create-dialog', '新建分组', 'New group', {
    palette: false,
    execute: present,
  });
  add('group.rename-dialog', '重命名分组', 'Rename group', {
    palette: false,
    validateArgs: (args) => stringArg(args, 'groupId'),
    getState: (c, args) => targetState(groupExists(c, args)),
    execute: present,
  });
  add('group.create', '新建分组', 'New group', {
    effect: 'view',
    palette: false,
    validateArgs: (args) => stringArg(args, 'name'),
  });
  add('group.rename', '重命名分组', 'Rename group', {
    effect: 'view',
    palette: false,
    validateArgs: (args) =>
      stringArg(args, 'groupId') && stringArg(args, 'name'),
    getState: (c, args) => targetState(groupExists(c, args)),
  });
  add('group.delete', '删除分组', 'Delete group', {
    effect: 'view',
    palette: false,
    validateArgs: (args) => stringArg(args, 'groupId'),
    getState: (c, args) => targetState(groupExists(c, args)),
  });
  add(
    'trash.restore',
    '还原',
    'Restore',
    write({
      effect: 'content',
      palette: false,
      validateArgs: (args) => stringArg(args, 'entryId'),
      getState: (c, args) => ({
        visible: !c.readonly,
        ...targetState(
          c.session
            ?.getState()
            .trash.some(
              (entry) =>
                entry.entryId === workspaceActionArgument(args, 'entryId'),
            ),
        ),
      }),
      execute: async (c, args) =>
        workspaceCommandActionResult(
          await c.session!.apply({
            type: 'restore-file',
            entryId: String(workspaceActionArgument(args, 'entryId')),
          }),
        ),
    }),
  );
  add(
    'trash.purge',
    '永久删除',
    'Delete permanently',
    write({
      effect: 'content',
      palette: false,
      validateArgs: (args) =>
        Array.isArray(workspaceActionArgument(args, 'entryIds')) &&
        (workspaceActionArgument(args, 'entryIds') as unknown[]).every(
          (id) => typeof id === 'string',
        ),
      getState: (c, args) => {
        const ids = workspaceActionArgument(args, 'entryIds') as string[];
        return {
          visible: !c.readonly,
          ...targetState(
            ids.length > 0 &&
              ids.every((id) =>
                c.session
                  ?.getState()
                  .trash.some((entry) => entry.entryId === id),
              ),
          ),
        };
      },
      execute: async (c, args) => {
        const state = await c.session!.versions({ type: 'status' });
        if (state.status.enabled)
          return options.invoke('versions-purge', {
            entryIds: workspaceActionArgument(args, 'entryIds'),
          });
        return workspaceCommandActionResult(
          await c.session!.apply({
            type: 'purge-trash',
            entryIds: workspaceActionArgument(args, 'entryIds') as string[],
          }),
        );
      },
    }),
  );
  add('trash.retry', '重试', 'Retry', {
    effect: 'content',
    requiresWrite: true,
    allowPaused: true,
    palette: false,
    getState: (c) => ({
      visible: !!c.session?.getState().trashUnconfirmed,
      enabled: !!c.session?.getState().trashUnconfirmed,
    }),
    execute: async (c) =>
      workspaceCommandActionResult(await c.session!.retryTrashOperation()),
  });
  add('save-retry', '重试保存', 'Retry save', {
    effect: 'external',
    requiresWrite: true,
    allowPaused: true,
    palette: false,
    getState: (c) => ({
      enabled: c.session?.getState().saveStatus === 'error',
      reason:
        c.session?.getState().saveStatus === 'error'
          ? undefined
          : 'no-save-error',
    }),
    execute: async (c) =>
      (await c.session!.flush())
        ? { status: 'completed' }
        : { status: 'failed', code: 'save-failed' },
  });
  add(
    'settings.patch',
    '更新工作区设置',
    'Update workspace settings',
    write({
      effect: 'content',
      concurrency: 'queue',
      palette: false,
      validateArgs: (args) => !!args && typeof args === 'object',
      execute: async (c, args) => {
        const current = c.session!.getState().config.value;
        const patch = args as Record<string, unknown>;
        c.session!.setWorkspaceConfig({
          ...current,
          ...patch,
          ...(patch['project'] &&
          typeof patch['project'] === 'object' &&
          !Array.isArray(patch['project'])
            ? {
                project: {
                  ...((current['project'] as object) ?? {}),
                  ...patch['project'],
                },
              }
            : {}),
        });
        return (await c.session!.flush())
          ? { status: 'completed' }
          : { status: 'failed', code: 'workspace-config-save-failed' };
      },
    }),
  );
  for (const operation of ['create', 'save', 'remove'] as const) {
    add(
      `skills.${operation}`,
      operation === 'create'
        ? '新建自定义 Skill'
        : operation === 'save'
          ? '保存 Skill'
          : '删除 Skill',
      operation === 'create'
        ? 'Create custom Skill'
        : operation === 'save'
          ? 'Save workspace Skill'
          : 'Remove workspace Skill',
      write({
        effect: 'content',
        concurrency: 'queue',
        palette: false,
        validateArgs: (args) => {
          const value = args as WorkspaceSkillCommit | undefined;
          return (
            !!value &&
            typeof value.transactionId === 'string' &&
            (operation !== 'remove'
              ? Array.isArray(value.writes) &&
                value.writes.length === 1 &&
                (operation !== 'create' ||
                  value.writes[0]?.expectedVersion === null) &&
                !value.trash?.length
              : Array.isArray(value.trash) &&
                value.trash.length === 1 &&
                !value.writes?.length)
          );
        },
        execute: async (c, args) => {
          if (operation === 'create')
            customSkillDefinition(
              workspaceSkillDefinition(
                (args as WorkspaceSkillCommit).writes![0].path,
              ).name,
            );
          const receipt = await c.session!.commitWorkspaceSkills(
            args as WorkspaceSkillCommit,
          );
          return receipt.outcome === 'applied'
            ? { status: 'completed' }
            : {
                status: 'failed',
                code: `workspace-skill-${receipt.reason}`,
                message:
                  receipt.reason === 'version-conflict' ||
                  receipt.reason === 'target-exists'
                    ? '提示词已被外部修改，请重新加载。 / Skill changed externally. Reload before saving.'
                    : receipt.reason === 'io-error'
                      ? '保存结果尚未确认，请重试原操作。 / Save unconfirmed. Retry the same operation.'
                      : '提示词保存失败：' + receipt.reason,
              };
        },
      }),
    );
  }
  add('reload', '重新加载', 'Reload', {
    effect: 'external',
    allowNoSession: true,
    palette: false,
  });
  for (const [id, zh, en] of [
    ['trash.confirm-purge', '永久删除', 'Delete permanently'],
    ['trash.confirm-clear', '清空回收站', 'Empty trash'],
  ])
    add(
      id,
      zh,
      en,
      write({
        palette: false,
        validateArgs: (args) =>
          Array.isArray(workspaceActionArgument(args, 'entryIds')),
        getState: (c, args) => {
          const ids = workspaceActionArgument(args, 'entryIds') as string[];
          return {
            visible: !c.readonly,
            ...targetState(
              ids.length > 0 &&
                ids.every((id) =>
                  c.session
                    ?.getState()
                    .trash.some((entry) => entry.entryId === id),
                ),
            ),
          };
        },
        execute: present,
      }),
    );
  add(
    'directory.new-here',
    '在此新建文件夹…',
    'New folder here…',
    write({
      palette: false,
      validateArgs: (args) => stringArg(args, 'dirPath'),
      getState: (c, args) => ({
        ...targetState(directoryExists(c, args)),
        visible: !c.readonly,
      }),
      execute: present,
    }),
  );
  add('library.back', '返回编辑', 'Back to editor', {
    effect: 'view',
    palette: false,
    execute: present,
  });
  add('library.pick', '引用', 'Reference', {
    effect: 'view',
    palette: false,
    validateArgs: (args) => stringArg(args, 'fileId'),
    getState: (c, args) => targetState(fileExists(c, args)),
    execute: present,
  });
  for (const [action, zh, en] of [
    ['keep-local', '保留本地', 'Keep local'],
    ['load-disk', '采用磁盘', 'Load disk'],
    ['save-copy', '保留两份', 'Keep both'],
  ] as const)
    add(
      `conflict.${action}`,
      zh,
      en,
      write({
        effect: 'content',
        palette: false,
        validateArgs: (args) => stringArg(args, 'fileId'),
        getState: (c, args) => {
          const id = String(workspaceActionArgument(args, 'fileId'));
          const state = c.session?.getState();
          return {
            visible: !c.readonly,
            ...targetState(
              state?.files.get(id)?.conflicted ||
                state?.documents.get(id)?.conflicted,
            ),
          };
        },
        execute: async (c, args) =>
          workspaceCommandActionResult(
            await c.session!.resolveConflict(
              String(workspaceActionArgument(args, 'fileId')),
              action,
            ),
          ),
      }),
    );
  add('conflict.compare', '比较两版', 'Compare versions', {
    validateArgs: (args) => stringArg(args, 'fileId'),
    getState: (context, args) => {
      const id = String(workspaceActionArgument(args, 'fileId'));
      const state = context.session?.getState();
      return targetState(
        state?.files.get(id)?.conflicted ||
          state?.documents.get(id)?.conflicted,
      );
    },
  });
  const barriers = new Set([
    'create-canvas',
    'create-document',
    'directory.create-canvas',
    'directory.create-document',
    'file.open',
    'file.versions',
    'resource.versions',
    'directory.versions',
    'file.export',
    'file.move',
    'file.duplicate',
    'file.trash',
    'directory.trash',
    'tab.activate',
    'tab.close',
    'tab.close-left',
    'tab.close-right',
    'tab.close-others',
    'group.switch',
    'group.delete',
    'library',
    'settings',
    'my',
  ]);
  entries.forEach((entry) => {
    if (barriers.has(entry.id.slice('workspace.'.length)))
      entry.flushEditing = true;
  });
  const metadata = new Set([
    'tab.activate',
    'tab.close',
    'tab.close-left',
    'tab.close-right',
    'tab.close-others',
    'tab.reorder',
    'group.switch',
    'group.create',
    'group.rename',
    'group.delete',
    'directory.toggle',
  ]);
  entries.forEach((entry) => {
    if (metadata.has(entry.id.slice('workspace.'.length)))
      entry.sessionMetadata = true;
  });
  return entries;
}
