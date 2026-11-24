import { createContext, memo, useContext, useMemo, useRef } from 'react';
import { DocumentPage, type DocumentPageProps } from '@sue/verd-board-ui';
import {
  WorkspaceCanvasReference,
  type PreviewOptions,
} from './documents/workspace-previews';

interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

interface WorkspaceDocumentPageProps extends HistoryState {
  page: DocumentPageProps;
  preview: PreviewOptions;
}

// History capabilities belong to the workspace, so they can change while this
// document's own value is unchanged. Include them in this memo boundary too.
const MemoDocumentPage = memo(function MemoDocumentPage(
  props: DocumentPageProps & HistoryState,
) {
  return <DocumentPage {...props} />;
});

const PreviewContext = createContext<PreviewOptions | null>(null);
type FrameReferenceProps = Parameters<
  NonNullable<DocumentPageProps['renderFrameReference']>
>[0];
const DocumentFrameReference = memo(function DocumentFrameReference({
  targetFrameId,
  instanceId,
}: FrameReferenceProps) {
  const options = useContext(PreviewContext)!;
  return (
    <WorkspaceCanvasReference
      targetFrameId={targetFrameId}
      options={{
        ...options,
        instance: JSON.stringify([options.instance, 'block', instanceId]),
      }}
    />
  );
});
const renderFrameReference = (props: FrameReferenceProps) => (
  <DocumentFrameReference {...props} />
);

/** Keep mounted document editors independent of unrelated tab navigation. */
export function WorkspaceDocumentPage({
  page,
  preview,
  canUndo,
  canRedo,
}: WorkspaceDocumentPageProps) {
  const latest = useRef({ page, preview });
  const activation = useRef(0);
  if (latest.current.preview.active !== preview.active) activation.current++;
  latest.current = { page, preview };
  const hasExport = !!page.onExport;
  const hasPresent = !!page.onPresent;
  const hasStartAgent = !!page.onStartAgent;
  const hasInsertImage = !!page.onInsertImage;
  const hasReady = !!page.onReady;
  const hasOpenLink = !!page.onOpenLink;
  const hasNavigationResult = !!page.onNavigationResult;
  const callbacks = useMemo(
    () => ({
      onChange: ((...args) =>
        latest.current.page.onChange(...args)) as DocumentPageProps['onChange'],
      captureInsertionScope: () => {
        const atOpen = activation.current;
        return () =>
          activation.current === atOpen && latest.current.preview.active;
      },
      onPresent: hasPresent
        ? () => latest.current.page.onPresent?.()
        : undefined,
      onStartAgent: hasStartAgent
        ? () => latest.current.page.onStartAgent?.()
        : undefined,
      onExport: hasExport
        ? (format: 'json' | 'markdown') =>
            latest.current.page.onExport?.(format)
        : undefined,
      onInsertImage: hasInsertImage
        ? (file: File) =>
            latest.current.page.onInsertImage?.(file) ?? Promise.resolve(null)
        : undefined,
      onReady: hasReady
        ? (((...args) =>
            latest.current.page.onReady?.(
              ...args,
            )) as DocumentPageProps['onReady'])
        : undefined,
      onOpenLink: hasOpenLink
        ? (href: string) => latest.current.page.onOpenLink?.(href)
        : undefined,
      onNavigationResult: hasNavigationResult
        ? (((...args) =>
            latest.current.page.onNavigationResult?.(
              ...args,
            )) as DocumentPageProps['onNavigationResult'])
        : undefined,
    }),
    [
      hasExport,
      hasPresent,
      hasStartAgent,
      hasInsertImage,
      hasReady,
      hasOpenLink,
      hasNavigationResult,
    ],
  );
  const hasRetry = !!preview.retry;
  const hasEdit = !!preview.edit;
  const hasRename = !!preview.rename;
  const hasEditorReady = !!preview.onEditorReady;
  const hasEditorViewReady = !!preview.onEditorViewReady;
  const previewCallbacks = useMemo<
    Pick<
      PreviewOptions,
      | 'open'
      | 'openLink'
      | 'retry'
      | 'edit'
      | 'rename'
      | 'onEditorReady'
      | 'onEditorViewReady'
    >
  >(
    () => ({
      open: (...args) => latest.current.preview.open(...args),
      openLink: (...args) => latest.current.preview.openLink(...args),
      retry: hasRetry
        ? () => latest.current.preview.retry?.() ?? Promise.resolve()
        : undefined,
      edit: hasEdit
        ? (...args) => latest.current.preview.edit?.(...args)
        : undefined,
      rename: hasRename
        ? (...args) => latest.current.preview.rename?.(...args)
        : undefined,
      onEditorReady: hasEditorReady
        ? (...args) => latest.current.preview.onEditorReady?.(...args)
        : undefined,
      onEditorViewReady: hasEditorViewReady
        ? (...args) => latest.current.preview.onEditorViewReady?.(...args)
        : undefined,
    }),
    [hasRetry, hasEdit, hasRename, hasEditorReady, hasEditorViewReady],
  );
  // Restore maps are intentionally updated in place by WorkspaceApp. Failed
  // file maps can acquire a fresh identity on a save notification. Compare the
  // small runtime metadata rather than invalidating on either map's identity.
  const restoreRevision = JSON.stringify([...(preview.restore ?? [])]);
  const failuresRevision = JSON.stringify([...preview.snapshot.failedFiles]);
  const pathRevision = JSON.stringify(preview.path);
  // Context updates reach the reference leaves through the memoized editor,
  // without rebuilding document toolbars when a preview becomes active.
  const previewValue = useMemo(
    () => ({ ...latest.current.preview, ...previewCallbacks }),
    // Navigation snapshots and callback identities do not change preview output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      preview.snapshot.store,
      preview.snapshot.files,
      preview.snapshot.documents,
      failuresRevision,
      preview.active,
      preview.locale,
      preview.linkActivation,
      preview.exporting,
      preview.history,
      preview.scroll,
      preview.editRequest,
      preview.instance,
      pathRevision,
      restoreRevision,
      previewCallbacks,
    ],
  );
  const restoreVersion = page.restore?.revision;
  const restoreSelection = page.restore?.selection;
  const restore = useMemo(
    () =>
      restoreVersion === undefined
        ? undefined
        : { revision: restoreVersion, selection: restoreSelection },
    [restoreVersion, restoreSelection],
  );

  return (
    <PreviewContext.Provider value={previewValue}>
      <MemoDocumentPage
        {...page}
        {...callbacks}
        restore={restore}
        renderFrameReference={renderFrameReference}
        canUndo={canUndo}
        canRedo={canRedo}
      />
    </PreviewContext.Provider>
  );
}
