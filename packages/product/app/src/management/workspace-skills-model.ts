import {
  patterns,
  loadBuiltinSkill,
  loadPatternGuide,
} from '@sue/verd-board-agent-patterns/agent';
import { parseMarkdownToTextDocument } from '@sue/board-markdown-to-text';
import type { createWorkspaceActionRegistry } from '../session/workspace-actions';
import type { WorkspaceSkillsSettingsProps } from '@sue/verd-board-ui';
import { isDocumentFileV1 } from '../documents/document-files';
import { localizePatterns } from '../documents/pattern-labels';
import type { WorkspaceSession } from '../session/workspace-session';
import {
  workspaceSkillDefinitions,
  workspaceSkillDefinition,
  workspaceSkillPaths,
  customSkillDefinition,
  parseWorkspaceSkill,
  parseSkillDocument,
  serializeWorkspaceSkill,
  type WorkspaceSkillCommit,
} from '../workspace-skills';

export function createWorkspaceSkillsModel(
  session: WorkspaceSession,
  workspaceKey: string,
  actions: Pick<
    ReturnType<typeof createWorkspaceActionRegistry>,
    'executeAction'
  >,
  locale: 'zh' | 'en',
  isCurrent: () => boolean,
): WorkspaceSkillsSettingsProps {
  const zh = locale === 'zh';
  const entries = session.getState().entries;
  const title = (patternId: string) =>
    localizePatterns(patterns, locale).find((item) => item.id === patternId)
      ?.title ?? patternId;
  const version = (path: string) =>
    entries.find((entry) => entry.path === path)?.version;
  const resultFor = (
    result: Awaited<ReturnType<typeof actions.executeAction>>,
  ) =>
    result.status === 'completed'
      ? { status: 'accepted' as const }
      : {
          status: 'rejected' as const,
          message:
            'message' in result
              ? (result.message ?? result.code)
              : 'Skill operation failed',
          unconfirmed:
            'code' in result && result.code === 'workspace-skill-io-error',
        };
  return {
    workspaceKey,
    items: workspaceSkillDefinitions.map((definition) => ({
      ...definition,
      label: definition.patternId
        ? title(definition.patternId)
        : zh
          ? '工作区通用'
          : 'Workspace common',
      version: version(definition.path),
    })),
    customItems: workspaceSkillPaths(entries)
      .filter(
        (path) => !workspaceSkillDefinitions.some((item) => item.path === path),
      )
      .map((path) => ({
        path,
        name: path.split('/')[2],
        label: path.split('/')[2],
        version: version(path),
      })),
    load: async (path) => {
      const entry = session
        .getState()
        .entries.find((item) => item.path === path);
      if (!entry) {
        const definition = workspaceSkillDefinition(path);
        return {
          source: '',
          version: null,
          body: '',
          description:
            definition.scope === 'custom'
              ? ''
              : zh
                ? definition.patternId
                  ? `在当前工作区使用${title(definition.patternId)}范式时，补充项目要求。`
                  : '在当前工作区编写内容时，补充术语、语言、结构和风格要求。'
                : definition.patternId
                  ? `Supplement the ${definition.patternId} pattern in this workspace.`
                  : 'Apply workspace terminology, language, structure and style.',
        };
      }
      const raw = await session.readRawFile(path);
      const source = new TextDecoder('utf-8', { fatal: true }).decode(
        raw.content,
      );
      try {
        return parseWorkspaceSkill(path, source, raw.version);
      } catch (cause) {
        return {
          source,
          version: raw.version,
          description: '',
          body: '',
          diagnostic: String(cause),
        };
      }
    },
    save: async (values) => {
      if (!isCurrent())
        return { status: 'rejected', message: 'Workspace changed' };
      let source: string;
      try {
        if (values.create) customSkillDefinition(values.path.split('/')[2]);
        if (
          values.create &&
          session.getState().entries.some((entry) => entry.path === values.path)
        )
          return {
            status: 'rejected',
            message: zh
              ? '同名 Skill 已存在，请使用其他名称。'
              : 'A Skill with this name already exists.',
          };
        source = serializeWorkspaceSkill(values.path, values);
      } catch (cause) {
        return { status: 'rejected', message: String(cause) };
      }
      const request: WorkspaceSkillCommit = {
        transactionId: values.transactionId,
        writes: [
          {
            path: values.path,
            content: source,
            expectedVersion: values.version,
          },
        ],
      };
      return resultFor(
        await actions.executeAction(
          values.create ? 'workspace.skills.create' : 'workspace.skills.save',
          request,
        ),
      );
    },
    remove: async (values) => {
      if (!isCurrent())
        return { status: 'rejected', message: 'Workspace changed' };
      if (!values.version) return { status: 'accepted' };
      return resultFor(
        await actions.executeAction('workspace.skills.remove', {
          transactionId: values.transactionId,
          trash: [{ path: values.path, expectedVersion: values.version }],
        }),
      );
    },
    readDefault: async (path) => {
      const definition = path ? workspaceSkillDefinition(path) : undefined;
      const ids = [
        undefined,
        ...(definition?.patternId ? [definition.patternId] : []),
      ];
      const skills = await Promise.all(
        ids.map(async (id) => {
          const name = id ? `verd-${id}` : 'verd-authoring';
          const parsed = parseSkillDocument(await loadBuiltinSkill(id), name);
          const document = parseMarkdownToTextDocument(parsed.body, {
            id: 'builtin-skill:' + name,
          }).document;
          // Bundled file references are presented in the related-rules view.
          const visit = (node: typeof document.content) => {
            node.marks = node.marks?.filter(
              (mark) =>
                mark.type !== 'link' ||
                /^https?:/.test(String(mark.attrs?.['href'])),
            );
            node.content?.forEach(visit);
          };
          visit(document.content);
          return { ...parsed, document };
        }),
      );
      const guide = await loadPatternGuide(definition?.patternId);
      if (!isDocumentFileV1(guide))
        throw new Error('Invalid default pattern guide');
      return { skills, rules: [{ title: guide.title, document: guide.text }] };
    },
  };
}
