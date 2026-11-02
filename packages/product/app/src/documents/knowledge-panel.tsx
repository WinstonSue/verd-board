import { useEffect, useRef, useState } from 'react';
import {
  createWorkspaceLink,
  parseWorkspaceLink,
  type WorkspaceTarget,
} from '@sue/board-common';
import { DocumentPreview, VmDialog } from '@sue/verd-board-ui';
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
        : titleFor(target.fileId));
  const selected =
    requestedTarget?.kind === 'cell'
      ? (targets.find(
          (item) =>
            item.target.kind === 'cell' &&
            item.target.cellId === requestedTarget.cellId,
        )?.target ?? requestedTarget)
      : requestedTarget;
  const previewDoc =
    selected && preview.snapshot.documents.get(selected.fileId)?.file;
  const exists =
    selected && targets.some((t) => t.href === createWorkspaceLink(selected));
  return (
    <>
      <button
        className="vm-btn vm-btn--ghost vm-btn--sm"
        ref={trigger}
        type="button"
        onClick={() => {
          setSelected(null);
          setShown(true);
        }}
      >
        {zh ? '关联内容' : 'Related content'}
      </button>
      {shown && (
        <VmDialog
          className="workspace-knowledge-dialog"
          title={`${zh ? '关联内容' : 'Related content'} · ${titleFor(fileId)}`}
          closeLabel={zh ? '关闭' : 'Close'}
          onClose={() => setShown(false)}
        >
          <div className="workspace-knowledge-columns">
            <section>
              <input
                aria-label={zh ? '搜索链接目标' : 'Search link targets'}
                placeholder={
                  zh
                    ? '搜索文档、章节或图元'
                    : 'Find a document, heading or cell'
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query &&
                queryKnowledgeTargets(targets, query).map((item) => (
                  <button
                    className="workspace-knowledge-result"
                    type="button"
                    key={item.href}
                    onClick={() => {
                      setCopied('');
                      setSelected(item.target);
                    }}
                  >
                    {item.title}
                    <small>{item.detail}</small>
                  </button>
                ))}
              {(['text', 'cell', 'embed'] as const).map((kind) => {
                const items = relations.filter(
                  (r) =>
                    r.kind === kind &&
                    (r.target.fileId === fileId || r.sourceFileId === fileId),
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
                        <button
                          className="vm-btn vm-btn--secondary"
                          type="button"
                          onClick={() =>
                            setSelected(
                              relation.sourceFileId === fileId
                                ? relation.target
                                : relation.source,
                            )
                          }
                        >
                          {relation.sourceFileId === fileId
                            ? '→ ' + targetLabel(relation.target)
                            : '← ' + titleFor(relation.sourceFileId)}
                          <small>{relation.context}</small>
                        </button>
                        <button
                          className="vm-btn vm-btn--secondary"
                          type="button"
                          onClick={() => {
                            locate(relation);
                            setShown(false);
                          }}
                        >
                          {zh ? '定位来源' : 'Locate source'}
                        </button>
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
                  selected?.fileId,
                );
                if (target) setSelected(target);
              }}
            >
              {selected ? (
                <>
                  <h3>{targetLabel(selected)}</h3>
                  <button
                    className="vm-btn vm-btn--secondary"
                    type="button"
                    disabled={!exists}
                    onClick={() => {
                      open(selected);
                      setShown(false);
                    }}
                  >
                    {zh ? '打开原内容' : 'Open source'}
                  </button>
                  <button
                    className="vm-btn vm-btn--secondary"
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
                            setCopied(zh ? '复制失败，请重试' : 'Copy failed'),
                        );
                    }}
                  >
                    {zh ? '复制链接' : 'Copy link'}
                  </button>
                  <span role="status">{copied}</span>
                  {!exists ? (
                    <p>{zh ? '目标已删除或不可用' : 'Target is unavailable'}</p>
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
                            const block = [
                              ...(document
                                .querySelector<HTMLDialogElement>(
                                  'dialog.workspace-knowledge-dialog',
                                )
                                ?.querySelectorAll<HTMLElement>(
                                  '[data-block-id]',
                                ) ?? []),
                            ].find(
                              (node) =>
                                node.dataset['blockId'] ===
                                selected.slug.slice(6),
                            );
                            block?.scrollIntoView({ block: 'nearest' });
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
                <p>
                  {zh
                    ? '选择关联内容预览，或搜索并复制内部链接。也可 Alt + 单击正文中的内部链接进行预览。'
                    : 'Select related content to preview, or find and copy a link.'}
                </p>
              )}
            </section>
          </div>
        </VmDialog>
      )}
    </>
  );
}
