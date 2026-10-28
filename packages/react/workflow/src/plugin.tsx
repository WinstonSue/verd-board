import { WorkflowModeSettings } from './mode-settings';
import { isFrameCell, isNodeCell, type NodeCell } from '@sue/board-core';
import { type FrameUIPlugin } from '@sue/board-react';
import {
  addWorkflowTask,
  autoLayoutWorkflow,
  canAutoLayoutWorkflow,
  createWorkflowPlugin,
  createWorkflowStartCell,
  createWorkflowTaskCell,
  workflowStartOf,
  type WorkflowStartData,
} from '@sue/board-workflow';
import { createWorkflowFrameExtensions } from './frame-extension';
const activeStart = (c: import('@sue/board-react').FramePluginContext) => {
  const selected = c.cell && workflowStartOf(c.store, c.cell.id);
  const frame = c.store.cells[c.frameId];
  const starts =
    frame?.cellType === 'frame' && 'children' in frame
      ? frame.children
          .map((id) => c.store.cells[id])
          .filter((cell) => cell?.kind === 'workflow-start')
      : [];
  return (
    selected ??
    (starts.length === 1
      ? (starts[0] as NodeCell<WorkflowStartData>)
      : undefined)
  );
};
export const createWorkflowUIPlugin = (): FrameUIPlugin => ({
  id: 'workflow',
  engine: createWorkflowPlugin(),
  extensions: createWorkflowFrameExtensions,
  cells: Object.fromEntries(
    ['workflow-start', 'workflow-task', 'workflow-decision'].map((kind) => [
      kind,
      { edgeKind: 'workflow-edge' },
    ]),
  ),
  pasteText(c) {
    const frame = c.store.cells[c.frameId];
    if (!isFrameCell(frame)) return undefined;
    const starts = frame.children
      .map((id) => c.store.cells[id])
      .filter((cell) => cell?.kind === 'workflow-start');
    const start =
      (c.hit && workflowStartOf(c.store, c.hit.id)) ||
      (starts.length === 1 ? starts[0] : undefined);
    if (!start) return undefined;
    const node = {
      ...createWorkflowTaskCell(c.allocateId()),
      content: { label: c.text },
    };
    return addWorkflowTask(c.store, start.id, node);
  },
  actions: [
    {
      id: 'workflow.start',
      label: { zh: '添加流程图', en: 'Workflow' },
      category: 'workflow',
      effect: 'content',
      getState: (c) => ({ enabled: !c.disabled }),
      execute: (c) => {
        const frame = c.store.cells[c.frameId];
        const starts = isFrameCell(frame)
          ? frame.children
              .map((id) => c.store.cells[id])
              .filter(
                (cell): cell is NodeCell =>
                  isNodeCell(cell) && cell.kind === 'workflow-start',
              )
          : [];
        const cell = createWorkflowStartCell(
          c.allocateId(),
          starts.length
            ? [
                Math.max(...starts.map((start) => start.geometry.x)) + 340,
                Math.min(...starts.map((start) => start.geometry.y)),
              ]
            : undefined,
        );
        return c.runOperations(
          [{ type: 'insert_cell', parentId: c.frameId, cell }],
          { selectionIds: [cell.id] },
        );
      },
    },
    ...[false, true].map((decision) => ({
      id: decision ? 'workflow.decision' : 'workflow.task',
      label: decision
        ? { zh: '判断', en: 'Decision' }
        : { zh: '任务', en: 'Task' },
      category: 'workflow',
      effect: 'content' as const,
      getState: (c: import('@sue/board-react').FrameActionContext) => ({
        enabled: !c.disabled && !!activeStart(c),
      }),
      execute: (c: import('@sue/board-react').FrameActionContext) => {
        const start = activeStart(c);
        if (!start)
          return { status: 'rejected' as const, code: 'missing-workflow' };
        const cell = createWorkflowTaskCell(c.allocateId(), decision);
        return c.runOperations(addWorkflowTask(c.store, start.id, cell), {
          selectionIds: [cell.id],
          editId: cell.id,
        });
      },
    })),
    {
      id: 'workflow.layout',
      label: { zh: '自动布局', en: 'Auto layout' },
      category: 'workflow',
      effect: 'content',
      getState: (c) => {
        const start = activeStart(c);
        return {
          enabled:
            !c.disabled && !!start && canAutoLayoutWorkflow(c.store, start.id),
        };
      },
      execute: (c) => {
        const start = activeStart(c);
        return start
          ? c.runOperations(autoLayoutWorkflow(c.store, start.id, c.registry))
          : { status: 'rejected', code: 'missing-workflow' };
      },
    },
    {
      id: 'workflow.set-mode',
      label: { zh: '设置流程图模式', en: 'Set workflow mode' },
      category: 'workflow',
      effect: 'content',
      validateArgs: (
        args: unknown,
      ): args is { startId: string; mode: WorkflowStartData['graphMode'] } =>
        !!args &&
        typeof args === 'object' &&
        typeof (args as { startId?: unknown }).startId === 'string' &&
        ['dag', 'process'].includes((args as { mode: string }).mode),
      getState: (c, args) => ({
        visible: !!args,
        enabled:
          !c.disabled &&
          c.store.cells[args?.startId]?.kind === 'workflow-start',
      }),
      execute: (
        c,
        args: { startId: string; mode: WorkflowStartData['graphMode'] },
      ) => {
        const latest = c.store.cells[args.startId];
        return isNodeCell(latest) && latest.kind === 'workflow-start'
          ? c.runOperations([
              {
                type: 'replace_cell',
                cell: {
                  ...latest,
                  data: {
                    ...(latest.data as WorkflowStartData),
                    graphMode: args.mode,
                  },
                },
              },
            ])
          : { status: 'rejected', code: 'missing-workflow' };
      },
    },
  ],
  tools: ['start', 'task', 'decision', 'layout'].map((id) => ({
    id: `workflow.${id}`,
    actionId: `workflow.${id}`,
  })),
  propertyPanels: [
    {
      id: 'workflow.properties',
      render: (context) =>
        context.cell?.kind === 'workflow-start' ? (
          <WorkflowModeSettings {...context} />
        ) : null,
    },
  ],
});
