import { useState } from 'react';
import type { ActionResult, ActionState } from '@sue/board-common';
import { isFrameCell, isNodeCell, type CellStore } from '@sue/board-core';
import { umlRoot, type UmlFragmentData } from '@sue/board-uml';
import {
  ArrowRightLeft,
  Braces,
  CircleDot,
  FileCode2,
  GitBranch,
  ListOrdered,
  MessageSquare,
  Square,
  StickyNote,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { FrameIconButton } from './frame-icon-button';
import { FrameToolPopover } from './frame-tool-popover';

type ParameterAction =
  'relation' | 'message' | 'note' | 'activation' | 'fragment';

/** Product presentation only; UML commands remain owned by the domain plugin. */
export function FrameUmlToolPalette({
  store,
  frameId,
  language,
  labelFor,
  titleFor,
  stateFor,
  executeAction,
}: {
  store: CellStore;
  frameId: string;
  language: 'zh' | 'en';
  labelFor(id: string): string;
  titleFor(id: string): string;
  stateFor(id: string, args?: unknown): ActionState;
  executeAction(id: string, args?: unknown): Promise<ActionResult>;
}) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [branch, setBranch] = useState('');
  const [fragment, setFragment] = useState<'alt' | 'opt' | 'loop'>('alt');
  const [error, setError] = useState<{
    kind: ParameterAction;
    message: string;
  }>();
  const [submitting, setSubmitting] = useState<ParameterAction | null>(null);
  const zh = language === 'zh';
  const sequence = umlRoot(store, frameId)?.kind === 'uml-sequence-root';
  const frame = store.cells[frameId];
  const members = isFrameCell(frame)
    ? frame.children.map((id) => store.cells[id]).filter(isNodeCell)
    : [];
  const endpoints = members.filter(
    (cell) => cell.kind === (sequence ? 'uml-participant' : 'uml-class'),
  );
  const operands = members
    .filter((cell) => cell.kind === 'uml-fragment')
    .flatMap((cell) =>
      (cell.data as UmlFragmentData).operands.map((operand) => ({
        id: operand.id,
        label: `${(cell.data as UmlFragmentData).operator}: ${operand.guard}`,
      })),
    );
  const from = endpoints.some((cell) => cell.id === source)
    ? source
    : (endpoints[0]?.id ?? '');
  const to = endpoints.some((cell) => cell.id === target)
    ? target
    : (endpoints.at(-1)?.id ?? '');
  const operandId = operands.some((operand) => operand.id === branch)
    ? branch
    : undefined;
  const names = endpoints.map((cell) => ({
    id: cell.id,
    label: cell.content?.label ?? cell.id,
  }));
  const direct = (id: string, icon: LucideIcon) => {
    const state = stateFor(id);
    return state.visible ? (
      <FrameIconButton
        key={id}
        label={labelFor(id)}
        title={
          state.reason ? `${titleFor(id)} — ${state.reason}` : titleFor(id)
        }
        icon={icon}
        disabled={!state.enabled}
        tooltipPlacement="right"
        actionId={id}
        onClick={() => void executeAction(id)}
      />
    ) : null;
  };
  const parameter = (kind: ParameterAction, icon: LucideIcon) => {
    const id = `uml.add-${kind === 'fragment' ? fragment : kind}`;
    const args =
      kind === 'fragment'
        ? { operandId }
        : kind === 'activation'
          ? { participantId: from, operandId }
          : kind === 'note'
            ? { participantIds: [...new Set([from, to])], operandId }
            : {
                sourceId: from,
                targetId: to,
                ...(sequence ? { operandId } : {}),
              };
    const state = stateFor(id, args);
    const ownSubmission = submitting === kind;
    const label =
      kind === 'fragment'
        ? zh
          ? '组合片段'
          : 'Combined fragment'
        : labelFor(id);
    return (
      <FrameToolPopover
        key={kind}
        label={label}
        title={
          state.reason
            ? `${label} — ${state.reason}`
            : kind === 'fragment'
              ? label
              : titleFor(id)
        }
        icon={icon}
        actionId={kind === 'fragment' ? 'uml.fragments' : id}
        disabled={
          !state.visible ||
          (!state.enabled && !ownSubmission) ||
          (submitting !== null && !ownSubmission)
        }
      >
        {(close) => (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!stateFor(id, args).enabled || submitting) return;
              setError(undefined);
              setSubmitting(kind);
              try {
                const result = await executeAction(id, args);
                if (result.status === 'completed' || result.status === 'noop')
                  close();
                else if ('code' in result)
                  setError({ kind, message: result.message ?? result.code });
              } catch (reason) {
                setError({
                  kind,
                  message:
                    reason instanceof Error ? reason.message : String(reason),
                });
              } finally {
                setSubmitting(null);
              }
            }}
          >
            {kind === 'fragment' && (
              <Choice
                label={zh ? '片段类型' : 'Fragment type'}
                value={fragment}
                options={['alt', 'opt', 'loop'].map((id) => ({
                  id,
                  label: id,
                }))}
                onChange={(value) => setFragment(value as typeof fragment)}
              />
            )}
            {kind !== 'fragment' && (
              <Choice
                label={zh ? '发送方 / 来源' : 'Source'}
                value={from}
                options={names}
                onChange={setSource}
              />
            )}
            {kind !== 'fragment' && kind !== 'activation' && (
              <Choice
                label={zh ? '接收方 / 目标' : 'Target'}
                value={to}
                options={names}
                onChange={setTarget}
              />
            )}
            {sequence && (
              <Choice
                label={zh ? '插入分支' : 'Insert into branch'}
                value={operandId ?? ''}
                options={[
                  { id: '', label: zh ? '顶层' : 'Top level' },
                  ...operands,
                ]}
                onChange={setBranch}
              />
            )}
            {error?.kind === kind && (
              <div role="alert" className="frame-tool-popover__error">
                {error.message}
              </div>
            )}
            <button
              type="submit"
              disabled={!state.enabled || submitting !== null}
            >
              {labelFor(id)}
            </button>
          </form>
        )}
      </FrameToolPopover>
    );
  };
  return (
    <div
      className="frame-tool-group"
      role="group"
      aria-label={zh ? 'UML 工具' : 'UML tools'}
    >
      {sequence ? (
        <>
          {direct('uml.add-participant', Users)}
          {direct('uml.add-actor', UserRound)}
          {parameter('message', MessageSquare)}
          {parameter('note', StickyNote)}
          {parameter('activation', ListOrdered)}
          {parameter('fragment', GitBranch)}
        </>
      ) : (
        <>
          {direct('uml.add-class', Square)}
          {direct('uml.add-interface', CircleDot)}
          {direct('uml.add-abstract', FileCode2)}
          {direct('uml.add-enum', Braces)}
          {parameter('relation', ArrowRightLeft)}
        </>
      )}
    </div>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange(value: string): void;
}) {
  return (
    <label className="frame-tool-popover__field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
