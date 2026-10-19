import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Boxes,
  LayoutTemplate,
  Network,
  Search,
  TriangleAlert,
  Workflow,
} from 'lucide-react';
const diagramIcons = {
  canvas: LayoutTemplate,
  mind: Network,
  workflow: Workflow,
  architecture: Boxes,
  'uml-class': Boxes,
  'uml-sequence': Workflow,
};

export interface ChartLibraryRow {
  frameId: string;
  name: string;
  path: string;
  diagram:
    | 'canvas'
    | 'mind'
    | 'workflow'
    | 'architecture'
    | 'uml-class'
    | 'uml-sequence';
  placement: 'owned' | 'unorganized' | 'standalone' | 'legacy';
  ownerName?: string;
  ownerFrameId?: string;
  referenceLabel: string;
  dirty?: boolean;
  conflicted?: boolean;
}

export type ChartOrganization =
  { kind: 'standalone' } | { kind: 'subgraph'; ownerFrameId?: string };

export interface ChartLibraryProps {
  rows: ChartLibraryRow[];
  owners: { frameId: string; name: string }[];
  readonly?: boolean;
  locale?: 'zh' | 'en';
  onOpen(frameId: string): void;
  onOrganize?(): void;
  onChangeOrganization?(
    fileId: string,
    organization: ChartOrganization,
  ): void | Promise<void>;
  onBack(): void;
  query?: string;
  diagram?: 'all' | ChartLibraryRow['diagram'];
  owner?: string;
  scrollTop?: number;
  onQueryChange?(value: string): void;
  onDiagramChange?(value: 'all' | ChartLibraryRow['diagram']): void;
  onOwnerChange?(value: string): void;
  onScroll?(scrollTop: number): void;
  /** Picker mode reuses the list and writes nothing by itself. */
  picker?: 'chart' | 'preview' | null;
  onPickerMode?(mode: 'chart' | 'preview'): void;
  onPick?(frameId: string): void;
}

const diagramLabel = (
  diagram: ChartLibraryRow['diagram'],
  locale: 'zh' | 'en',
) => {
  const zh = {
    canvas: '画布',
    mind: '思维导图',
    workflow: '流程图',
    architecture: '架构图',
    'uml-class': 'UML 类图',
    'uml-sequence': 'UML 时序图',
  } as const;
  const en = {
    canvas: 'Canvas',
    mind: 'Mind',
    workflow: 'Flowchart',
    architecture: 'Architecture',
    'uml-class': 'UML Class Diagram',
    'uml-sequence': 'UML Sequence Diagram',
  } as const;
  return (locale === 'zh' ? zh : en)[diagram];
};

const placementLabel = (row: ChartLibraryRow, locale: 'zh' | 'en') => {
  if (row.placement === 'owned')
    return row.ownerName || (locale === 'zh' ? '所属画布' : 'Owner');
  if (row.placement === 'standalone')
    return locale === 'zh' ? '独立' : 'Standalone';
  if (row.placement === 'unorganized')
    return locale === 'zh' ? '待整理' : 'Unorganized';
  return locale === 'zh' ? '未标记' : 'Unmarked';
};

export function ChartLibrary({
  rows,
  owners,
  readonly = false,
  locale = 'zh',
  onOpen,
  onOrganize,
  onChangeOrganization,
  onBack,
  query: queryProp,
  diagram: diagramProp,
  owner: ownerProp,
  scrollTop = 0,
  onQueryChange,
  onDiagramChange,
  onOwnerChange,
  onScroll,
  picker = null,
  onPickerMode,
  onPick,
}: ChartLibraryProps) {
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const editingRow = rows.find((row) => row.frameId === editingFile);
  const canEdit = !readonly && !picker && !!onChangeOrganization;
  const [localQuery, setLocalQuery] = useState('');
  const [localDiagram, setLocalDiagram] = useState<
    'all' | ChartLibraryRow['diagram']
  >('all');
  const [localOwner, setLocalOwner] = useState('all');
  const query = queryProp ?? localQuery;
  const diagram = diagramProp ?? localDiagram;
  const owner = ownerProp ?? localOwner;
  const setQuery = onQueryChange ?? setLocalQuery;
  const setDiagram = onDiagramChange ?? setLocalDiagram;
  const setOwner = onOwnerChange ?? setLocalOwner;
  const scroller = useMemo(
    () => ({ current: null as HTMLDivElement | null }),
    [],
  );
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return rows
      .filter((row) =>
        picker === 'chart'
          ? row.diagram !== 'canvas'
          : picker === 'preview'
            ? row.diagram === 'canvas'
            : true,
      )
      .filter((row) => (diagram === 'all' ? true : row.diagram === diagram))
      .filter((row) => {
        if (owner === 'all') return true;
        if (owner === 'standalone') return row.placement === 'standalone';
        if (owner === 'unorganized') return row.placement === 'unorganized';
        return row.placement === 'owned' && row.ownerName === owner;
      })
      .filter((row) =>
        text
          ? `${row.name} ${row.path} ${row.ownerName ?? ''}`
              .toLowerCase()
              .includes(text)
          : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, query, diagram, owner, picker]);
  const empty = rows.length === 0;
  return (
    <section
      className="chart-library"
      aria-label={locale === 'zh' ? '图表库' : 'Chart library'}
    >
      <header className="chart-library-header">
        <button
          type="button"
          className="workspace-button-ghost"
          onClick={onBack}
        >
          <ArrowLeft size={16} aria-hidden />
          {locale === 'zh' ? '返回编辑' : 'Back to editor'}
        </button>
        <h2>
          {picker
            ? locale === 'zh'
              ? '引用已有'
              : 'Reference existing'
            : locale === 'zh'
              ? '图表库'
              : 'Chart library'}
        </h2>
        <span className="chart-library-count">
          {locale === 'zh'
            ? `共 ${filtered.length} 个`
            : `${filtered.length} charts`}
        </span>
        {picker && onPickerMode ? (
          <div
            className="chart-library-modes"
            role="group"
            aria-label={locale === 'zh' ? '选用模式' : 'Picker mode'}
          >
            <button
              type="button"
              aria-pressed={picker === 'chart'}
              onClick={() => onPickerMode('chart')}
            >
              {locale === 'zh' ? '图表' : 'Charts'}
            </button>
            <button
              type="button"
              aria-pressed={picker === 'preview'}
              onClick={() => onPickerMode('preview')}
            >
              {locale === 'zh' ? '画布预览' : 'Canvas preview'}
            </button>
          </div>
        ) : null}
        {!readonly && onOrganize ? (
          <button
            type="button"
            className="workspace-button-secondary chart-library-organize"
            onClick={onOrganize}
          >
            {locale === 'zh' ? '整理已有图表' : 'Organize existing charts'}
          </button>
        ) : null}
      </header>
      <div className="chart-library-filters">
        <label className="chart-library-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            aria-label={locale === 'zh' ? '搜索名称' : 'Search name'}
            value={query}
            placeholder={locale === 'zh' ? '搜索名称' : 'Search name'}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label={locale === 'zh' ? '类型' : 'Type'}
          value={diagram}
          onChange={(event) =>
            setDiagram(event.target.value as 'all' | ChartLibraryRow['diagram'])
          }
        >
          <option value="all">
            {locale === 'zh' ? '全部类型' : 'All types'}
          </option>
          <option value="mind">{diagramLabel('mind', locale)}</option>
          <option value="workflow">{diagramLabel('workflow', locale)}</option>
          <option value="architecture">
            {diagramLabel('architecture', locale)}
          </option>
          <option value="uml-class">{diagramLabel('uml-class', locale)}</option>
          <option value="uml-sequence">
            {diagramLabel('uml-sequence', locale)}
          </option>
        </select>
        <select
          aria-label={locale === 'zh' ? '归属' : 'Ownership'}
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        >
          <option value="all">
            {locale === 'zh' ? '全部归属' : 'All owners'}
          </option>
          <option value="standalone">
            {locale === 'zh' ? '独立' : 'Standalone'}
          </option>
          <option value="unorganized">
            {locale === 'zh' ? '待整理' : 'Unorganized'}
          </option>
          {owners.map((item) => (
            <option key={item.frameId} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      {empty ? (
        <p>{locale === 'zh' ? '还没有图表' : 'No charts yet'}</p>
      ) : filtered.length === 0 ? (
        <p>
          {locale === 'zh'
            ? '没有符合筛选的图表'
            : 'No charts match the filter'}
        </p>
      ) : (
        <div
          ref={(node) => {
            scroller.current = node;
            if (node && node.scrollTop !== scrollTop)
              node.scrollTop = scrollTop;
          }}
          onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
          className="chart-library-scroll"
        >
          <table className="chart-library-table">
            <thead>
              <tr>
                <th>{locale === 'zh' ? '类型' : 'Type'}</th>
                <th>{locale === 'zh' ? '名称' : 'Name'}</th>
                <th>{locale === 'zh' ? '归属' : 'Owner'}</th>
                <th>{locale === 'zh' ? '引用' : 'References'}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const Icon = diagramIcons[row.diagram];
                return (
                  <tr
                    key={row.frameId}
                    data-conflict={row.conflicted ? 'true' : undefined}
                  >
                    <td>
                      <span className="chart-library-type">
                        <Icon size={15} aria-hidden />
                        {diagramLabel(row.diagram, locale)}
                      </span>
                    </td>
                    <td>
                      <div className="chart-library-name">
                        <span>{row.name}</span>
                        {row.conflicted ? (
                          <TriangleAlert
                            size={13}
                            className="file-tree-conflict"
                            aria-label={
                              locale === 'zh' ? '存在冲突' : 'Conflicted'
                            }
                          />
                        ) : row.dirty ? (
                          <span
                            className="file-tree-dirty"
                            aria-label={locale === 'zh' ? '未保存' : 'Unsaved'}
                          />
                        ) : null}
                      </div>
                      <div className="chart-library-path" title={row.path}>
                        {row.path}
                      </div>
                    </td>
                    <td>
                      <span
                        className={
                          row.placement === 'unorganized'
                            ? 'chart-library-unorganized'
                            : undefined
                        }
                      >
                        {placementLabel(row, locale)}
                      </span>
                    </td>
                    <td>{row.referenceLabel}</td>
                    <td>
                      <button
                        type="button"
                        className={
                          picker
                            ? 'workspace-button-primary'
                            : 'workspace-button-ghost'
                        }
                        onClick={() =>
                          picker && onPick
                            ? onPick(row.frameId)
                            : onOpen(row.frameId)
                        }
                      >
                        {picker
                          ? locale === 'zh'
                            ? '选用'
                            : 'Use'
                          : locale === 'zh'
                            ? '打开'
                            : 'Open'}
                      </button>
                      {canEdit && row.diagram !== 'canvas' && (
                        <button
                          type="button"
                          className="workspace-button-ghost"
                          aria-label={`${locale === 'zh' ? '调整归属' : 'Change ownership'} ${row.name}`}
                          onClick={(event) => {
                            editTrigger.current = event.currentTarget;
                            setEditingFile(row.frameId);
                          }}
                        >
                          {locale === 'zh' ? '调整归属…' : 'Change ownership…'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && editingRow && onChangeOrganization && (
        <ChartOrganizationDialog
          key={editingRow.frameId}
          row={editingRow}
          owners={owners}
          locale={locale}
          onConfirm={(organization) =>
            onChangeOrganization(editingRow.frameId, organization)
          }
          onClose={() => {
            setEditingFile(null);
            requestAnimationFrame(() => editTrigger.current?.focus());
          }}
        />
      )}
    </section>
  );
}

function ChartOrganizationDialog({
  row,
  owners,
  locale,
  onConfirm,
  onClose,
}: {
  row: ChartLibraryRow;
  owners: ChartLibraryProps['owners'];
  locale: 'zh' | 'en';
  onConfirm(organization: ChartOrganization): void | Promise<void>;
  onClose(): void;
}) {
  const zh = locale === 'zh';
  const title = zh ? '调整归属' : 'Change ownership';
  const initial =
    row.placement === 'owned' && row.ownerFrameId
      ? `owner:${row.ownerFrameId}`
      : row.placement === 'legacy'
        ? ''
        : row.placement;
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    select.current?.focus();
    return () => element.close();
  }, []);
  const valid =
    value === 'standalone' ||
    value === 'unorganized' ||
    (value.startsWith('owner:') &&
      owners.some((owner) => `owner:${owner.frameId}` === value));
  const save = async () => {
    if (pending.current || !valid || value === initial) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await onConfirm(
        value === 'standalone'
          ? { kind: 'standalone' }
          : value === 'unorganized'
            ? { kind: 'subgraph' }
            : { kind: 'subgraph', ownerFrameId: value.slice('owner:'.length) },
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="file-tree-prompt"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending.current) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 className="file-tree-prompt__title">{title}</h2>
        <p>{row.name}</p>
        <select
          ref={select}
          aria-label={zh ? '归属' : 'Ownership'}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="" disabled>
            {zh ? '未标记' : 'Unmarked'}
          </option>
          <option value="standalone">{zh ? '独立' : 'Standalone'}</option>
          <option value="unorganized">{zh ? '待整理' : 'Unorganized'}</option>
          {owners.map((owner) => (
            <option key={owner.frameId} value={`owner:${owner.frameId}`}>
              {owner.name}
            </option>
          ))}
        </select>
        {error && <p role="alert">{error}</p>}
        <div className="file-tree-prompt__actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {zh ? '取消' : 'Cancel'}
          </button>
          <button type="submit" disabled={busy || !valid || value === initial}>
            {busy ? (zh ? '处理中…' : 'Processing…') : zh ? '确定' : 'OK'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export interface OrganizePreviewRow {
  fileId: string;
  name: string;
  path: string;
  diagram: ChartLibraryRow['diagram'];
  sources: string;
  recommendedOwnerName: string;
  reason: string;
  choice: 'owner' | 'standalone' | 'unorganized';
  ownerFrameId?: string;
  /** Reference-source file ids captured when the preview opened. */
  basisSources?: string[];
}

export function OrganizePreview({
  rows,
  owners,
  locale = 'zh',
  onChange,
  onCancel,
  onConfirm,
}: {
  rows: OrganizePreviewRow[];
  owners: { frameId: string; name: string }[];
  locale?: 'zh' | 'en';
  onChange(
    fileId: string,
    choice: OrganizePreviewRow['choice'],
    ownerFrameId?: string,
  ): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="organize-preview"
      aria-label={locale === 'zh' ? '整理已有图表' : 'Organize charts'}
    >
      <header>
        <h2>{locale === 'zh' ? '整理已有图表' : 'Organize existing charts'}</h2>
        <p>
          {locale === 'zh'
            ? '只处理还没有归属的专业图，确认后整批写入，可一次撤销'
            : 'Only unassigned specialized charts are included. Confirm to save the batch, which can be undone in one step.'}
        </p>
      </header>
      <div className="organize-preview-scroll">
        {rows.length === 0 ? (
          <p>{locale === 'zh' ? '没有待整理的图表' : 'Nothing to organize'}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{locale === 'zh' ? '名称' : 'Name'}</th>
                <th>{locale === 'zh' ? '类型' : 'Type'}</th>
                <th>{locale === 'zh' ? '引用来源' : 'Sources'}</th>
                <th>{locale === 'zh' ? '建议' : 'Suggestion'}</th>
                <th>{locale === 'zh' ? '选择' : 'Choice'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.fileId}>
                  <td>
                    <div>{row.name}</div>
                    <div className="chart-library-path" title={row.path}>
                      {row.path}
                    </div>
                  </td>
                  <td>{diagramLabel(row.diagram, locale)}</td>
                  <td>{row.sources}</td>
                  <td>
                    {row.recommendedOwnerName} ·{' '}
                    {reasonLabel(row.reason, locale)}
                  </td>
                  <td>
                    <select
                      aria-label={row.name}
                      value={
                        row.choice === 'owner'
                          ? (row.ownerFrameId ?? '')
                          : row.choice
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === 'standalone' || value === 'unorganized')
                          onChange(row.fileId, value);
                        else onChange(row.fileId, 'owner', value);
                      }}
                    >
                      <option value="standalone">
                        {locale === 'zh' ? '保持独立' : 'Standalone'}
                      </option>
                      <option value="unorganized">
                        {locale === 'zh' ? '待整理' : 'Unorganized'}
                      </option>
                      {owners.map((owner) => (
                        <option key={owner.frameId} value={owner.frameId}>
                          {owner.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <footer>
        <button
          className="workspace-button-ghost"
          type="button"
          onClick={onCancel}
        >
          {locale === 'zh' ? '取消' : 'Cancel'}
        </button>
        <button
          className="workspace-button-primary"
          type="button"
          disabled={!rows.length}
          onClick={onConfirm}
        >
          {locale === 'zh' ? '确认整理' : 'Confirm'}
        </button>
      </footer>
    </dialog>
  );
}

function reasonLabel(reason: string, locale: 'zh' | 'en') {
  const labels: Record<string, [string, string]> = {
    'sole-source': ['只被这张画布引用', 'Referenced by one canvas'],
    'multiple-sources': ['被多张画布引用', 'Referenced by several canvases'],
    'no-references': ['没有被引用', 'Not referenced'],
  };
  return labels[reason]?.[locale === 'zh' ? 0 : 1] ?? reason;
}
