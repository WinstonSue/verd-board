import type { CellId, NodeAppearance, Point } from '@sue/board-core';
export type MindColorScheme =
  'default' | 'colorful' | 'soft' | 'retro' | 'dark' | 'starry';

/**
 * Mind-specific view settings. Absent fields inherit the owning file's
 * canvas theme; an explicit value overrides it for every tree in the file.
 */
export interface MindViewSettings {
  colorScheme?: MindColorScheme;
}

export interface MindNodeData {
  layout?: string;
  rightNodeCount?: number;
  manualWidth?: number;
  note?: unknown;
  noteCollapsed?: boolean;
  image?: { url: string; width: number; height: number };
  emojis?: { name: string }[];
  branchAppearance?: NodeAppearance;
  branchShape?: 'bight' | 'polyline';
}
export interface MindRootData extends MindNodeData {
  collapsed?: boolean;
  /** Maximum outer topic width; absent inherits the application default. */
  maxNodeWidth?: number;
  /** Presentation offset inside an embedded Frame; detail layout stays canonical. */
  embeddedOffset?: Point;
}
export interface MindChildData extends MindNodeData {
  collapsed?: boolean;
}

export interface MindSummaryData {
  startSiblingId: CellId;
  endSiblingId: CellId;
}

export interface MindBranchData {
  order: string;
}

declare module '@sue/board-core' {
  interface FrameView {
    mind?: MindViewSettings;
  }
  interface FrameReferenceData {
    mindOffsets?: Record<CellId, Point>;
  }
}
