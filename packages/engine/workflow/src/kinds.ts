export const WorkflowKind = {
  workflowStart: 'workflow-start',
  workflowTask: 'workflow-task',
  workflowDecision: 'workflow-decision',
  workflowEdge: 'workflow-edge',
} as const;
export const WORKFLOW_NODE_KINDS = [
  WorkflowKind.workflowStart,
  WorkflowKind.workflowTask,
  WorkflowKind.workflowDecision,
] as const;
export const isWorkflowNodeKind = (kind: string) =>
  (WORKFLOW_NODE_KINDS as readonly string[]).includes(kind);
