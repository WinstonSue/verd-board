import { getSchema } from '@tiptap/core';
import {
  createDocumentExtensions,
  contentExtensions,
} from './constants/editor-config';
export { createDocumentHeadingSlugger } from './utils/heading-slug';
/** Uses exactly the extensions used by the actual editors; no Editor/DOM needed. */
export const createDocumentSchema = () => getSchema(createDocumentExtensions());
export const createCanvasTextSchema = () => getSchema(contentExtensions);
