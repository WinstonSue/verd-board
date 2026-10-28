/** Occurrence-local presentation only. Never serialize or submit this object. */
export interface FrameViewProjection {
  identity: object;
  expandedCellIds: ReadonlySet<string>;
  purpose: 'interactive' | 'preview' | 'export';
}
export const canonicalFrameProjection: FrameViewProjection = Object.freeze({
  identity: Object.freeze({}),
  expandedCellIds: new Set<string>(),
  purpose: 'export' as const,
});
export interface FrameRevealRequest {
  cellId: string;
  requestId: number;
  signal?: AbortSignal;
}
export type FrameRevealResult =
  | { status: 'revealed'; cellId: string }
  | { status: 'cancelled'; code: string }
  | {
      status: 'unavailable';
      code: 'missing-cell' | 'hidden' | 'unrenderable' | 'unsupported';
    };
export interface FrameLinkHost {
  createLink(target: { frameId: string; cellId: string }): string;
  openLink(href: string): void | Promise<void>;
}
