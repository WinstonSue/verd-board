import { useEffect, useRef, useState } from 'react';
import type { BoardTextNode } from '@sue/board-common';
import {
  agentLaunchLabel,
  agentNames,
  type AgentId,
  VmDialog,
  WorkspaceButton,
} from '@sue/verd-board-ui';
import {
  formatLocalAgentPrompt,
  type LocalAgentTarget,
  type LocalAgentClient,
  type LocalAgentHandoff,
  type LocalAgentPreviewFile,
  type LocalAgentReview,
  type LocalAgentState,
  type LocalAgentTask,
  type WorkspaceHandle,
  type WorkspaceSession,
} from '@sue/verd-board-workspace';
import { ContentVersionPreview } from './version-preview';
import './workspace-agent-dialog.scss';

export type AgentTarget = { label: string } & (
  | {
      kind: 'file';
      fileId: string;
      text?: string;
      cellIds?: string[];
      documentContent?: BoardTextNode;
    }
  | Exclude<LocalAgentTarget, { fileId: string }>
);

export interface PreparedAgentTask {
  request: LocalAgentTask;
  focusPath?: string;
}

type Locale = 'zh' | 'en';
const text = (locale: Locale, zh: string, en: string) =>
  locale === 'zh' ? zh : en;

function knownError(locale: Locale, message: string) {
  const messages: Record<string, [string, string]> = {
    AGENT_TOOLS_REQUIRED: [
      '请先在设置中启用或修复 Agent 编写工具。',
      'Enable or repair Agent authoring tools in settings.',
    ],
    CODEX_NOT_FOUND: [
      '找不到 Codex CLI。请确认本机安装或选择可执行文件。',
      'Codex CLI was not found. Install it locally or select its executable.',
    ],
    CODEX_AUTH_REQUIRED: [
      '请先在本机终端登录 Codex。',
      'Sign in to Codex in your local terminal.',
    ],
    CODEX_UNSUPPORTED: [
      '当前 CLI 版本不支持快速执行。',
      'This CLI version does not support quick runs.',
    ],
    CODEX_TIMEOUT: [
      '任务超过运行时间限制。',
      'The task reached its time limit.',
    ],
    CODEX_FAILED: [
      'Codex 运行失败。检查本机 CLI，或在 Codex 中继续。',
      'Codex failed. Check the local CLI or continue in Codex.',
    ],
    CODEX_INVALID_EVENTS: [
      '无法读取 Codex 的任务状态。可在 Codex 中继续。',
      'VerdBoard could not read the task status. You can continue in Codex.',
    ],
    CODEX_INVALID_RESULT: [
      'Codex 返回的答复格式有误。可重新执行。',
      'Codex returned an invalid response. You can run the task again.',
    ],
    CODEX_INVALID_OPERATIONS: [
      'Codex 返回的修改建议格式有误。可重新生成。',
      'Codex returned an invalid proposal. You can generate it again.',
    ],
    CODEX_OUTPUT_LIMIT: [
      'Codex 输出过长。可缩小任务范围后重试。',
      'The Codex output was too large. Try a smaller task.',
    ],
    TARGET_CHANGED: [
      '原选区已变化。请重新选择，或移除选区。',
      'The original selection changed. Select it again or remove it.',
    ],
    TARGET_UNAVAILABLE: [
      '聚焦的文件或文件夹已不可用。请重新选择或清除聚焦范围。',
      'The focused file or folder is unavailable. Select it again or clear focus.',
    ],
    WORKSPACE_CHANGED: ['当前工作区已切换。', 'The active workspace changed.'],
    SAVE_FAILED: [
      '工作区还有未保存的修改。',
      'The workspace has unsaved changes.',
    ],
    WORKSPACE_AGENT_BUSY: [
      '此工作区还有任务在运行。',
      'A task is still running in this workspace.',
    ],
    INVALID_TASK: [
      '请输入任务，或缩短任务内容。',
      'Enter a task or shorten the prompt.',
    ],
    INVALID_TARGET: [
      '选区过大。请缩小或移除选区。',
      'The selection is too large. Reduce or remove it.',
    ],
  };
  for (const [code, [zh, en]] of Object.entries(messages))
    if (message.includes(code)) return text(locale, zh, en);
  return message;
}

// Preview snapshots are untrusted model output. Keep workspace links and use
// placeholders for remote media, including references inside canvas documents.
function previewFiles(entries: LocalAgentPreviewFile[]) {
  const encoder = new TextEncoder();
  return entries.map(({ path, file }) => ({
    path,
    content: encoder.encode(
      JSON.stringify(file, (key, value) => {
        if (typeof value === 'string') {
          if (key === 'href' && !value.startsWith('verd://')) return undefined;
          if (
            ['src', 'url', 'poster'].includes(key) &&
            !value.startsWith('verd-asset:')
          )
            return undefined;
        }
        return value;
      }),
    ),
  }));
}

export function WorkspaceAgentDialog({
  open,
  onClose,
  locale,
  workspaceName,
  target,
  agent,
  onClearFocus,
  onRemoveSelection,
  session,
  handle,
  client,
  prepare,
  onSettings,
}: {
  open: boolean;
  onClose(): void;
  locale: Locale;
  workspaceName: string;
  target?: AgentTarget;
  agent: AgentId;
  onClearFocus(): void;
  onRemoveSelection(): void;
  session: WorkspaceSession;
  handle: WorkspaceHandle;
  client?: LocalAgentClient;
  prepare(task: string, target?: AgentTarget): Promise<PreparedAgentTask>;
  onSettings(): void;
}) {
  const t = (zh: string, en: string) => text(locale, zh, en);
  const [draft, setDraft] = useState('');
  const [id, setId] = useState<string>();
  const [state, setState] = useState<LocalAgentState>();
  const [preparedHandoff, setHandoff] = useState<{
    target: AgentTarget | undefined;
    result: LocalAgentHandoff;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [reviewId, setReviewId] = useState('');
  const [loadedReview, setReview] = useState<{
    requestId: string;
    fileId: string;
    result: LocalAgentReview;
  }>();
  const requestPending = useRef(false);
  const runTarget = useRef<AgentTarget | undefined>(undefined);
  const currentTarget =
    id &&
    (state?.state === 'running' ||
      state?.state === 'applying' ||
      state?.state === 'review' ||
      state?.state === 'unconfirmed')
      ? runTarget.current
      : target;
  const running = state?.state === 'running' || state?.state === 'applying';
  const reviewing = state?.state === 'review' || state?.state === 'unconfirmed';
  const handoff =
    preparedHandoff?.target === target ? preparedHandoff?.result : undefined;

  useEffect(() => {
    if (!client || !id || !running) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await client.request(handle, {
          type: 'status',
          requestId: id,
        });
        if (!live || !('state' in result)) return;
        setState(result);
        setError('');
        if (result.state === 'applied') await session.syncFromHost();
        if (result.state === 'running' || result.state === 'applying')
          timer = setTimeout(() => void poll(), 750);
      } catch {
        if (!live) return;
        setError(
          locale === 'zh'
            ? '连接中断，正在查询原任务…'
            : 'Connection interrupted. Checking the original task…',
        );
        timer = setTimeout(() => void poll(), 1500);
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, handle, id, running, locale, session]);

  const changes = state && 'changes' in state ? state.changes : undefined;
  const chosen =
    changes?.find((change) => change.fileId === reviewId) ?? changes?.[0];
  const review =
    loadedReview &&
    loadedReview.requestId === id &&
    loadedReview.fileId === chosen?.fileId
      ? loadedReview.result
      : undefined;
  useEffect(() => {
    if (!client || !id || !chosen || !open) return;
    let live = true;
    void client
      .request(handle, { type: 'review', requestId: id, fileId: chosen.fileId })
      .then(
        (result) => {
          if (live && 'before' in result)
            setReview({ requestId: id, fileId: chosen.fileId, result });
        },
        (cause: unknown) => {
          if (live) setError(knownError(locale, String(cause)));
        },
      );
    return () => {
      live = false;
    };
  }, [client, handle, id, chosen, open, locale]);

  const run = async (action: () => Promise<void>) => {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      await action();
    } catch (cause) {
      setError(
        knownError(
          locale,
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    } finally {
      requestPending.current = false;
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      if (!client) return;
      const { request: task } = await prepare(draft, target);
      const requestId = crypto.randomUUID();
      runTarget.current = target;
      setId(requestId);
      setHandoff(undefined);
      setReviewId('');
      setState(undefined);
      try {
        const result = await client.request(handle, {
          type: 'start',
          requestId,
          task,
        });
        if ('state' in result) setState(result);
      } catch (cause) {
        // If the response was lost, polling the same ID can recover the job.
        setState(
          cause instanceof TypeError
            ? { state: 'running' }
            : { state: 'failed', message: String(cause) },
        );
      }
    });

  const handoffTask = () =>
    run(async () => {
      const { request: task, focusPath } = await prepare(draft, target);
      if (!client) {
        const prompt = [
          formatLocalAgentPrompt(task, focusPath),
          'VerdBoard workspace: ' + workspaceName,
        ].join('\n\n');
        setHandoff({ target, result: { prompt } });
        await navigator.clipboard.writeText(prompt);
        setCopied(true);
        return;
      }
      const result = await client.request(handle, { type: 'handoff', task });
      if (!('prompt' in result)) throw new Error('WORKSPACE_CHANGED');
      setHandoff({ target, result });
      if (result.url && client.openHandoff)
        await client.openHandoff(result.url);
    });

  const apply = () =>
    run(async () => {
      if (!client || !id || !state || !('transactionId' in state)) return;
      await prepare(draft);
      try {
        const result = await client.request(handle, {
          type: 'apply',
          requestId: id,
          transactionId: state.transactionId,
        });
        if ('state' in result) {
          setState(result);
          if (result.state === 'applied') await session.syncFromHost();
        }
      } catch (cause) {
        if (!(cause instanceof TypeError)) throw cause;
        setState({ ...state, state: 'applying' });
      }
    });

  const cancel = () =>
    run(async () => {
      if (!client || !id) return;
      const result = await client.request(handle, {
        type: 'cancel',
        requestId: id,
      });
      if ('state' in result) setState(result);
    });

  if (!open) return null;
  const reviewBlocksApply =
    !review ||
    !changes?.length ||
    (state &&
      'diagnostics' in state &&
      state.diagnostics.some((item) => item.severity === 'error'));
  return (
    <VmDialog
      title={agentLaunchLabel(locale)}
      closeLabel={t('关闭', 'Close')}
      className="workspace-agent-dialog"
      onClose={onClose}
      data-testid="workspace-agent-dialog"
      footer={
        <>
          {running && id && client && state?.state === 'running' && (
            <WorkspaceButton onClick={() => void cancel()} disabled={busy}>
              {t('取消任务', 'Cancel task')}
            </WorkspaceButton>
          )}
          {!running && (
            <>
              <WorkspaceButton
                disabled={!draft.trim() || busy}
                onClick={() => void handoffTask()}
              >
                {client
                  ? t('在 Codex 中继续', 'Continue in Codex')
                  : t('复制任务', 'Copy task')}
              </WorkspaceButton>
              {client && (
                <WorkspaceButton
                  intent="primary"
                  disabled={!draft.trim() || busy}
                  onClick={() => void start()}
                >
                  {t('快速执行', 'Run now')}
                </WorkspaceButton>
              )}
            </>
          )}
        </>
      }
    >
      <p className="workspace-agent-target">
        {workspaceName}
        {' · '}
        {agentNames[agent]}
      </p>
      {currentTarget && (
        <section className="workspace-agent-selection">
          <p>
            {t('聚焦范围', 'Focus')} · {currentTarget.label}
          </p>
          <WorkspaceButton
            onClick={onClearFocus}
            disabled={busy || running || reviewing}
          >
            {t('清除聚焦范围', 'Clear focus')}
          </WorkspaceButton>
        </section>
      )}
      {currentTarget?.kind === 'file' &&
        (currentTarget.text || !!currentTarget.cellIds?.length) && (
          <section className="workspace-agent-selection">
            <p>
              {currentTarget.text ||
                t('已选元素 ', 'Selected elements ') +
                  currentTarget.cellIds?.length}
            </p>
            <WorkspaceButton
              onClick={onRemoveSelection}
              disabled={busy || running || reviewing}
            >
              {t('移除选区', 'Remove selection')}
            </WorkspaceButton>
          </section>
        )}
      <label className="workspace-agent-task">
        {t('任务', 'Task')}
        <textarea
          className="vm-input"
          rows={4}
          maxLength={4000}
          value={draft}
          disabled={running || busy}
          onChange={(event) => {
            setDraft(event.target.value);
            setHandoff(undefined);
          }}
        />
      </label>
      {running && (
        <p role="status">{t('Codex 正在运行…', 'Codex is running…')}</p>
      )}
      {state?.state === 'cancelled' && (
        <p role="status">{t('任务已取消。', 'Task cancelled.')}</p>
      )}
      {state?.state === 'missing' && (
        <p role="status">
          {t(
            '原任务已失效。可重新发起。',
            'The original task expired. You can start again.',
          )}
        </p>
      )}
      {state?.state === 'applied' && (
        <p role="status">{t('改动已应用。', 'Changes applied.')}</p>
      )}
      {(state?.state === 'failed' || state?.state === 'stale') && (
        <p role="alert">
          {state.state === 'stale'
            ? t(
                '工作区已变化。请重新生成修改。',
                'The workspace changed. Generate a new proposal.',
              )
            : knownError(locale, state.message)}
        </p>
      )}
      {state?.state === 'failed' &&
        state.message.includes('AGENT_TOOLS_REQUIRED') && (
          <WorkspaceButton onClick={onSettings}>
            {t('打开 Agent 设置', 'Open Agent settings')}
          </WorkspaceButton>
        )}
      {state?.state === 'failed' &&
        /CODEX_NOT_FOUND|CODEX_UNSUPPORTED/.test(state.message) &&
        client?.chooseExecutable && (
          <WorkspaceButton
            onClick={() =>
              void run(async () => {
                await client.chooseExecutable?.();
              })
            }
          >
            {t('选择 Codex CLI', 'Choose Codex CLI')}
          </WorkspaceButton>
        )}
      {error && <p role="alert">{error}</p>}
      {handoff && (
        <div className="workspace-agent-handoff">
          {handoff.url && !client?.openHandoff && (
            <a href={handoff.url}>{t('打开 Codex', 'Open Codex')}</a>
          )}
          <WorkspaceButton
            onClick={() =>
              void run(async () => {
                await navigator.clipboard.writeText(handoff.prompt);
                setCopied(true);
              })
            }
          >
            {t('复制任务', 'Copy task')}
          </WorkspaceButton>
        </div>
      )}
      {copied && <p role="status">{t('任务已复制。', 'Task copied.')}</p>}
      {state && 'answer' in state && state.answer && (
        <section className="workspace-agent-answer">{state.answer}</section>
      )}
      {state && 'diagnostics' in state && !!state.diagnostics.length && (
        <ul>
          {state.diagnostics.map((item, index) => (
            <li key={index}>
              {item.severity} · {item.path && item.path + ' · '}
              {item.message}
            </li>
          ))}
        </ul>
      )}
      {chosen && state?.state !== 'applied' && (
        <section className="workspace-agent-review">
          <label>
            {t('审阅文件', 'Review file')}
            <select
              className="vm-input"
              value={chosen.fileId}
              onChange={(event) => setReviewId(event.target.value)}
            >
              {changes?.map((change) => (
                <option key={change.fileId} value={change.fileId}>
                  {change.beforePath === change.afterPath
                    ? change.afterPath
                    : [
                        change.beforePath ?? t('新增', 'New'),
                        change.afterPath ?? t('移除', 'Removed'),
                      ].join(' → ')}
                </option>
              ))}
            </select>
          </label>
          {review && (
            <div className="workspace-agent-versions">
              {(['before', 'after'] as const).map((side) => (
                <section key={side}>
                  <h3>
                    {side === 'before'
                      ? t('修改前', 'Before')
                      : t('修改后', 'After')}
                  </h3>
                  {review[side].length ? (
                    <ContentVersionPreview
                      key={chosen.fileId}
                      session={session}
                      files={previewFiles(review[side])}
                      versionId={id + '-' + side}
                      fileId={chosen.fileId}
                      locale={locale}
                    />
                  ) : (
                    <p>
                      {t('此版本没有该文件。', 'This version has no file.')}
                    </p>
                  )}
                </section>
              ))}
            </div>
          )}
          {state?.state === 'unconfirmed' && (
            <p role="alert">
              {t('写入结果待确认。', 'The commit outcome is unconfirmed.')}
            </p>
          )}
          <WorkspaceButton
            intent="primary"
            disabled={busy || running || !!reviewBlocksApply}
            onClick={() => void apply()}
          >
            {state?.state === 'unconfirmed'
              ? t('确认原事务', 'Confirm original transaction')
              : t('应用改动', 'Apply changes')}
          </WorkspaceButton>
          {state?.state === 'review' && (
            <WorkspaceButton disabled={busy} onClick={() => void cancel()}>
              {t('放弃建议', 'Discard proposal')}
            </WorkspaceButton>
          )}
        </section>
      )}
    </VmDialog>
  );
}
