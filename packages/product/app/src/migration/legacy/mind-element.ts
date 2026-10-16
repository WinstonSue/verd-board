import type { BoardTheme, Point, Viewport } from '@sue/board-core';
import type { StrokeStyle } from '@sue/board-common';
import type { MindLayoutType } from '@sue/board-layouts';
import type { LegacyBoardElement } from './board-element';

export interface MindElement extends LegacyBoardElement {
  type: 'mind_child' | 'mind';
  children: MindElement[];
  data: {
    topic: unknown;
    note?: unknown;
    noteCollapsed?: boolean;
    image?: unknown;
    emojis?: { name: string }[];
    topicSize?: { width: number; height: number };
    noteSize?: { width: number; height: number };
  };
  rightNodeCount?: number;
  manualWidth?: number;
  fill?: string;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  shape?: 'round-rectangle' | 'underline';
  branchColor?: string;
  branchWidth?: number;
  branchShape?: 'bight' | 'polyline';
  layout?: MindLayoutType;
  isCollapsed?: boolean;
  start?: number;
  end?: number;
}
export interface MindRootElement extends MindElement {
  type: 'mind';
  points: Point[];
  contentAnchor?: Point;
  detailViewport?: Viewport;
  detailTheme?: BoardTheme;
  detailRoots?: MindElement[];
}
