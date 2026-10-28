import { isNodeCell } from '@sue/board-core';
import {
  ConfigPanel,
  defineSettings,
  settingsCommitResult,
  type FramePluginContext,
} from '@sue/board-react';
import type { WorkflowStartData } from '@sue/board-workflow';

/** Shared by the minimal editor and product inspector; the transaction belongs to the host. */
export function WorkflowModeSettings(
  context: FramePluginContext & { testId?: string; showLabel?: boolean },
) {
  const { cell, language, disabled } = context;
  const product = context.surface === 'product';
  if (!isNodeCell(cell) || cell.kind !== 'workflow-start') return null;
  const definition = defineSettings<{
    graphMode: WorkflowStartData['graphMode'];
  }>({
    fields: [
      {
        key: 'graphMode',
        editor: 'select',
        label: language === 'zh' ? '图模式' : 'Graph mode',
        props: {
          attributes: {
            'data-testid':
              context.testId ?? (product ? 'workflow-graph-mode' : undefined),
          },
        },
        options: [
          { value: 'dag', label: 'DAG' },
          { value: 'process', label: 'Process' },
        ],
      },
    ],
  });
  return (
    <ConfigPanel
      definition={definition}
      values={{ graphMode: (cell.data as WorkflowStartData).graphMode }}
      identity={cell.id}
      disabled={disabled}
      renderField={({ label, editor }) =>
        context.showLabel === false || product ? (
          editor
        ) : (
          <label>
            {label}
            {editor}
          </label>
        )
      }
      onCommit={({ changes }) => {
        const change = changes.find((change) => change.kind === 'set');
        return change?.kind === 'set'
          ? settingsCommitResult(
              context.executeAction('workflow.set-mode', {
                startId: cell.id,
                mode: change.value,
              }),
            )
          : undefined;
      }}
    />
  );
}
