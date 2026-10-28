export const MindKind = {
  mindRoot: 'mind-root',
  mindChild: 'mind-child',
  mindSummary: 'mind-summary',
  mindBranch: 'mind-branch',
  mindSummaryEdge: 'mind-summary-edge',
} as const;
export const MIND_NODE_KINDS = [
  MindKind.mindRoot,
  MindKind.mindChild,
  MindKind.mindSummary,
] as const;
export const isMindNodeKind = (kind: string) =>
  (MIND_NODE_KINDS as readonly string[]).includes(kind);
