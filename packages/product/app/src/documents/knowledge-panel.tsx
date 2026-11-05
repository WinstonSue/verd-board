import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  createWorkspaceLink,
  parseWorkspaceLink,
  type WorkspaceTarget,
} from '@sue/board-common';
import {
  DocumentPreview,
  VmDialog,
  WorkspaceAlert,
  WorkspaceButton,
  WorkspaceEmptyState,
  WorkspaceInput,
} from '@sue/verd-board-ui';
import {
  queryKnowledgeTargets,
  type KnowledgeRelation,
  type KnowledgeTarget,
} from './knowledge-index';
import {
  WorkspaceCanvasReference,
  type PreviewOptions,
} from './workspace-previews';

/** Modal previews mount only static renderers; the source editor stays mounted. */
export function KnowledgePanel({
  fileId,
  targets,
  relations,
  preview,
  open,
  locate,
  request,
  active,
}: {
  fileId: string;
  targets: readonly KnowledgeTarget[];
  relations: readonly KnowledgeRelation[];
  preview: PreviewOptions;
  open(target: WorkspaceTarget): void;
  locate(relation: KnowledgeRelation): void;
  request?: { href: string; nonce: number };
  active: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState('');
  const [requestedTarget, setSelected] = useState<WorkspaceTarget | null>(null);
  const [copied, setCopied] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const zh = preview.locale !== 'en';
  useEffect(() => {
    if (request) {
      setSelected(parseWorkspaceLink(request.href, fileId));
      setShown(true);
    }
  }, [request, fileId]);
  useEffect(() => {
    if (!active) setShown(false);
  }, [active]);
  const titleFor = (id: string) =>
    targets.find((t) => t.target.kind === 'file' && t.target.fileId === id)
      ?.title ?? id;
  const targetLabel = (target: WorkspaceTarget) =>
    targets.find((t) => t.href === createWorkspaceLink(target))?.title ??
    (target.kind === 'cell'
      ? target.cellId
      : target.kind === 'heading'
        ? target.slug
        : target.kind === 'folder'
          ? target.folderId
          : titleFor(target.fileId));
  const selected =
    requestedTarget?.kind === 'heading'
      ? (targets.find(
          (item) => item.legacyHref === createWorkspaceLink(requestedTarget),
        )?.target ?? requestedTarget)
      : requestedTarget?.kind === 'cell'
        ? (targets.find(
            (item) =>
              item.target.kind === 'cell' &&
              item.target.cellId === requestedTarget.cellId,
          )?.target ?? requestedTarget)
        : requestedTarget;
  const previewDoc =
    selected &&
    selected.kind !== 'folder' &&
    preview.snapshot.documents.get(selected.fileId)?.file;
  const exists =
    selected && targets.some((t) => t.href === createWorkspaceLink(selected));
  const results = query.trim()
    ? queryKnowledgeTargets(targets, query.trim())
    : [];
  const sourceExists =
    !!previewDoc ||
    !!(
      selected &&
      (selected.kind === 'folder'
        ? exists
        : preview.snapshot.files.has(selected.fileId))
    );
  return (
    <>
      <WorkspaceButton
        intent="ghost"
        ref={trigger}
        type="button"
        onClick={() => {
          setSelected(null);
          setShown(true);
        }}
      >
        {zh ? '关联内容' : 'Related content'}
      </WorkspaceButton>
      {shown && (
        <VmDialog
          className="workspace-knowledge-dialog"
          title={`${zh ? '关联内容' : 'Related content'} · ${titleFor(fileId)}`}
          closeLabel={zh ? '关闭' : 'Close'}
          onClose={() => setShown(false)}
        >
          <div className="workspace-knowledge-columns">
            <section className="workspace-knowledge-list">
              <WorkspaceInput
                aria-label={zh ? '搜索链接目标' : 'Search link targets'}
                placeholder={
                  zh
                    ? '搜索文件夹、文档、章节、段落或图元'
                    : 'Find a folder, document, heading, block or cell'
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query.trim() && !results.length && (
                <WorkspaceEmptyState
                  description={
                    zh ? '没有匹配的链接目标' : 'No matching link targets'
                  }
                />
              )}
              {results.map((item) => (
                <WorkspaceButton
                  className="workspace-knowledge-result"
                  type="button"
                  key={item.href}
                  onClick={() => {
                    setCopied('');
                    setSelected(item.target);
                  }}
                >
                  <strong>{item.title}</strong>
                  <small>
                    {item.target.kind === 'heading' &&
                    item.target.slug.startsWith('block:')
                      ? zh
                        ? '段落 · '
                        : 'Block · '
                      : ''}
                    {item.detail}
                  </small>
                </WorkspaceButton>
              ))}
              {(['text', 'cell', 'embed'] as const).map((kind) => {
                const items = relations.filter(
                  (r) =>
                    r.kind === kind &&
                    ((r.target.kind !== 'folder' &&
                      r.target.fileId === fileId) ||
                      r.sourceFileId === fileId),
                );
                return (
                  <section key={kind}>
                    <h3>
                      {zh
                        ? {
                            text: '文字链接',
                            cell: '图元链接',
                            embed: '嵌入来源',
                          }[kind]
                        : kind}{' '}
                      · {items.length}
                    </h3>
                    {items.map((relation, i) => (
                      <div key={i} className="workspace-knowledge-relation">
                        <WorkspaceButton
                          type="button"
                          onClick={() =>
                            setSelected(
                              relation.sourceFileId === fileId
                                ? relation.target
                                : relation.source,
                            )
                          }
                        >
                          <strong>
                            {relation.sourceFileId === fileId ? (
                              <>
                                <ArrowRight
                                  strokeWidth={1.75}
                                  size={14}
                                  aria-hidden="true"
                                />{' '}
                                {targetLabel(relation.target)}
                              </>
                            ) : (
                              <>
                                <ArrowLeft
                                  strokeWidth={1.75}
                                  size={14}
                                  aria-hidden="true"
                                />{' '}
                                {titleFor(relation.sourceFileId)}
                              </>
                            )}
                          </strong>
                          <small>{relation.context}</small>
                        </WorkspaceButton>
                        <WorkspaceButton
                          type="button"
                          onClick={() => {
                            locate(relation);
                            setShown(false);
                          }}
                        >
                          {zh ? '定位来源' : 'Locate source'}
                        </WorkspaceButton>
                      </div>
                    ))}
                  </section>
                );
              })}
            </section>
            <section
              className="workspace-knowledge-preview"
              onClickCapture={(event) => {
                const anchor =
                  event.target instanceof Element
                    ? event.target.closest('a[href]')
                    : null;
                if (!anchor) return;
                event.preventDefault();
                event.stopPropagation();
                const target = parseWorkspaceLink(
                  anchor.getAttribute('href') ?? '',
                  selected && selected.kind !== 'folder'
                    ? selected.fileId
                    : undefined,
                );
                if (target) setSelected(target);
              }}
            >
              {selected ? (
                <>
                  <h3>{targetLabel(selected)}</h3>
                  <div className="workspace-knowledge-actions">
                    <WorkspaceButton
                      type="button"
                      disabled={!sourceExists}
                      onClick={() => {
                        open(selected);
                        setShown(false);
                      }}
                    >
                      {zh ? '打开原内容' : 'Open source'}
                    </WorkspaceButton>
                    <WorkspaceButton
                      type="button"
                      disabled={!exists}
                      onClick={() => {
                        if (!navigator.clipboard) {
                          setCopied(
                            zh
                              ? '复制不可用，请使用安全连接'
                              : 'Clipboard unavailable',
                          );
                          return;
                        }
                        void navigator.clipboard
                          .writeText(createWorkspaceLink(selected))
                          .then(
                            () => setCopied(zh ? '链接已复制' : 'Link copied'),
                            () =>
                              setCopied(
                                zh ? '复制失败，请重试' : 'Copy failed',
                              ),
                          );
                      }}
                    >
                      {zh ? '复制链接' : 'Copy link'}
                    </WorkspaceButton>
                    <span role="status">{copied}</span>
                  </div>
                  {!exists ? (
                    <WorkspaceAlert
                      type="warning"
                      title={
                        zh ? '目标已删除或不可用' : 'Target is unavailable'
                      }
                      showIcon
                    />
                  ) : selected.kind === 'folder' ? (
                    <p>
                      {
                        targets.find(
                          (item) => item.href === createWorkspaceLink(selected),
                        )?.detail
                      }
                    </p>
                  ) : previewDoc ? (
                    <DocumentPreview
                      key={createWorkspaceLink(selected)}
                      value={previewDoc.text}
                      renderFrameReference={(props) => (
                        <WorkspaceCanvasReference
                          targetFrameId={props.targetFrameId}
                          options={{
                            ...preview,
                            path: [selected.fileId],
                            active: true,
                            edit: undefined,
                            rename: undefined,
                          }}
                        />
                      )}
                      onReady={(controller) => {
                        if (controller && selected.kind === 'heading') {
                          if (selected.slug.startsWith('block:')) {
                            controller.locateBlock(selected.slug.slice(6));
                            return;
                          }
                          const heading = controller
                            .getHeadings()
                            .find((h) => h.anchor === selected.slug);
                          if (heading) controller.locateHeading(heading.pos);
                        }
                      }}
                    />
                  ) : (
                    <WorkspaceCanvasReference
                      targetFrameId={selected.fileId}
                      options={{
                        ...preview,
                        path: [],
                        active: true,
                        referenceCards: false,
                        open: (id, anchor) => {
                          open(
                            anchor
                              ? { kind: 'heading', fileId: id, slug: anchor }
                              : { kind: 'file', fileId: id },
                          );
                          setShown(false);
                        },
                        openLink: (href, id) => {
                          const target = parseWorkspaceLink(href, id);
                          if (target) setSelected(target);
                        },
                        edit: undefined,
                        rename: undefined,
                      }}
                    />
                  )}
                </>
              ) : (
                <WorkspaceEmptyState
                  description={
                    zh
                      ? '选择关联内容预览，或搜索并复制内部链接。'
                      : 'Select related content to preview, or find and copy a link.'
                  }
                />
              )}
            </section>
          </div>
        </VmDialog>
      )}
    </>
  );
}
