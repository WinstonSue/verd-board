import './style.scss';
export * from './rich-text-links';

export { Text } from './text';
export { TextPreview } from './text-preview';
export type {
  TextComponentProps,
  ParagraphTextProps,
  LineTextProps,
  LineTextRef,
  EditorSize,
  TextChangeData,
} from './types';
export { ParagraphText } from './components/paragraph/paragraph-text';
export { LineText } from './components/line/line-text';
export { documentInsertActions } from './components/document/document-insert-actions';
export { DocumentEditor } from './components/document/document-editor';
export { DocumentPreview } from './components/document/document-preview';
export type {
  DocumentPreviewController,
  DocumentPreviewProps,
} from './components/document/document-preview';
export type {
  DocumentFrameReferenceProps,
  DocumentFrameReferenceRenderer,
} from './components/document/document-frame-reference';
export type {
  DocumentEditorProps,
  DocumentReferenceChoice,
  DocumentEditorChange,
  DocumentChangeReceipt,
  DocumentEditorController,
  DocumentHistoryAdapter,
  DocumentSelection,
  DocumentChangeSource,
  DocumentToolbarState,
  DocumentHeading,
  DocumentSearchMatch,
  DocumentSearchOptions,
  DocumentBlockKind,
} from './types/document';
export { findInDocument } from './components/document/document-search';
export { createDocumentHeadingSlugger } from './utils/heading-slug';
export { safeFocus, measureContainerSize } from './utils/measure';
export {
  createBoardTextController,
  documentFromEditor,
} from './utils/controller';
export {
  paragraphExtensions,
  lineExtensions,
  createDocumentExtensions,
  DEFAULT_PLACEHOLDERS,
} from './constants/editor-config';

export { measureBoardText, type TextMeasurement } from './measure-text';
export {
  LinkEditorHost,
  requestDocumentLink,
  type LinkEditRequest,
} from './link-editor-host';

export {
  DocumentAssetContext,
  type DocumentAssetResolver,
} from './components/document/asset-resolver';

export {
  DocumentResourcesContext,
  ResourceContent,
  type DocumentAttachment,
  type DocumentResourceHost,
  type DocumentResourceHandle,
} from './components/document/document-resources';

export {
  createDocumentFoldingStore,
  createDocumentFoldingRegistry,
  type DocumentFoldingAdapter,
} from './components/document/folding-store';
