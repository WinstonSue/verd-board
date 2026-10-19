/** 行为不同才单独占一个 kind。只差形状的图形用 geometry + outline。 */
export const CellKind = {
  frame: 'frame',
  frameReference: 'frame-reference',
  documentReference: 'document-reference',
  documentFrame: 'document-frame',
  group: 'group',
  arrow: 'arrow',
  geometry: 'geometry',
  image: 'image',
  table: 'table',
  swimlane: 'swimlane',
  freehand: 'freehand',
  vectorLine: 'vector-line',
  mindRoot: 'mind-root',
  mindChild: 'mind-child',
  mindSummary: 'mind-summary',
  mindBranch: 'mind-branch',
  mindSummaryEdge: 'mind-summary-edge',
  workflowStart: 'workflow-start',
  workflowTask: 'workflow-task',
  workflowDecision: 'workflow-decision',
  workflowEdge: 'workflow-edge',
  architectureLayer: 'architecture-layer',
  architectureModule: 'architecture-module',
  architectureEdge: 'architecture-edge',
  umlClassRoot: 'uml-class-root',
  umlSequenceRoot: 'uml-sequence-root',
  umlClass: 'uml-class',
  umlRelation: 'uml-relation',
  umlParticipant: 'uml-participant',
  umlMessage: 'uml-message',
  umlNote: 'uml-note',
  umlFragment: 'uml-fragment',
} as const;

export type CellKindName = (typeof CellKind)[keyof typeof CellKind];

export const MIND_NODE_KINDS = [
  CellKind.mindRoot,
  CellKind.mindChild,
  CellKind.mindSummary,
] as const;

export const WORKFLOW_NODE_KINDS = [
  CellKind.workflowStart,
  CellKind.workflowTask,
  CellKind.workflowDecision,
] as const;

export const ARCHITECTURE_NODE_KINDS = [
  CellKind.architectureLayer,
  CellKind.architectureModule,
] as const;

export const isMindNodeKind = (kind: string) =>
  (MIND_NODE_KINDS as readonly string[]).includes(kind);

export const isWorkflowNodeKind = (kind: string) =>
  (WORKFLOW_NODE_KINDS as readonly string[]).includes(kind);

export const isArchitectureNodeKind = (kind: string) =>
  (ARCHITECTURE_NODE_KINDS as readonly string[]).includes(kind);

/** Frame 里出现哪种锚点，就按哪个场景解释。三种锚点不能同时存在。 */
export const sceneAnchorKind = (kinds: readonly string[]) => {
  const anchors = kinds.filter(
    (kind) =>
      kind === CellKind.mindRoot ||
      kind === CellKind.workflowStart ||
      kind === CellKind.architectureLayer ||
      kind === CellKind.umlClassRoot ||
      kind === CellKind.umlSequenceRoot,
  );
  return anchors[0];
};
