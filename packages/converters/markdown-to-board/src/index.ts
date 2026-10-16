import type { FrameSnapshot } from '@sue/board-core';
import {
  parseMarkdownToFrameSnapshot as parseDefinition,
  type MarkdownParseOptions,
} from './parse';
import { serializeFrameToMarkdown as serializeStore } from './serialize';

export type { MarkdownParseOptions };

/** Fields Markdown intentionally does not round-trip. */
export const MARKDOWN_LOSSY_FIELDS = [
  'id',
  'layout',
  'style',
  'viewport',
  'theme',
  'collapsed',
  'richText',
  'summary',
] as const;

export const parseMarkdownToFrameSnapshot = (
  definition: string,
  mainTopic?: string,
  options?: MarkdownParseOptions,
): FrameSnapshot => parseDefinition(definition, mainTopic, options);

/** Export one mounted mind Frame; branch order is read from the CellStore. */
export const serializeFrameToMarkdown = (
  snapshot: FrameSnapshot,
  frameId = snapshot.store.rootId,
): string => serializeStore(snapshot.store, frameId);
