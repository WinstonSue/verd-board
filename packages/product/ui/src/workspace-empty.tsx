import { FilePlus2, FileText, FolderOpen } from 'lucide-react';

export interface WorkspaceEmptyProps {
  locale?: 'zh' | 'en';
  onCreate(): void;
  /** Creates an independent document when provided. */
  onCreateDocument?(): void;
  onBrowse?(): void;
}

/** Shown when the last tab is closed — never creates a file implicitly. */
export function WorkspaceEmpty({
  locale = 'zh',
  onCreate,
  onCreateDocument,
  onBrowse,
}: WorkspaceEmptyProps) {
  const t =
    locale === 'zh'
      ? {
          title: '没有打开的文件',
          body: '从左侧文件树打开画布或文档，或新建一个。',
          create: '新建画布',
          createDocument: '新建文档',
          browse: '浏览文件',
        }
      : {
          title: 'No file open',
          body: 'Open a canvas or document from the file tree, or create one.',
          create: 'New canvas',
          createDocument: 'New document',
          browse: 'Browse files',
        };
  return (
    <div className="workspace-empty">
      <div className="workspace-empty-card">
        <div className="workspace-empty-icon">
          <FolderOpen size={24} aria-hidden />
        </div>
        <div className="workspace-empty-title">{t.title}</div>
        <div className="workspace-empty-body">{t.body}</div>
        <div className="workspace-empty-actions">
          <button
            className="workspace-button-primary"
            type="button"
            onClick={onCreate}
          >
            <FilePlus2 size={15} />
            {t.create}
          </button>
          {onCreateDocument ? (
            <button
              className="workspace-button-secondary"
              type="button"
              onClick={onCreateDocument}
            >
              <FileText size={15} />
              {t.createDocument}
            </button>
          ) : null}
          {onBrowse ? (
            <button
              className="workspace-button-ghost"
              type="button"
              onClick={onBrowse}
            >
              <FolderOpen size={15} />
              {t.browse}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
