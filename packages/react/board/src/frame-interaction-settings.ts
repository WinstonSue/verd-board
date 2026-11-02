import type { RichTextLinkActivation } from '@sue/board-react-text';

/** Multipliers relative to the default canvas interaction speed. */
export interface FrameCanvasInteractionSettings {
  smartGuides?: boolean;
  linkActivation?: RichTextLinkActivation;
  zoomSensitivity?: number;
  dragPanSpeed?: number;
}

export const normalizeInteractionMultiplier = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(3, Math.max(0.25, value))
    : 1;
