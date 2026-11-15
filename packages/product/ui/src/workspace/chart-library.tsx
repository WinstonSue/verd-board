import { useActionSource, type ActionSource } from '@sue/board-react-actions';
import { bindWorkspaceAction } from './workspace-action-bindings';
import { useMemo, useState } from 'react';
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
  diagram: keyof typeof diagramIcons;
  referenceLabel: string;
  dirty?: boolean;
  conflicted?: boolean;
}
export interface ChartLibraryProps {
  actionSource?: ActionSource;
  rows: ChartLibraryRow[];
  readonly?: boolean;
  locale?: 'zh' | 'en';
  onOpen(frameId: string): void;
  onBack?(): void;
  query?: string;
  diagram?: 'all' | ChartLibraryRow['diagram'];
  scrollTop?: number;
  onQueryChange?(value: string): void;
  onDiagramChange?(value: 'all' | ChartLibraryRow['diagram']): void;
  onScroll?(scrollTop: number): void;
  picker?: 'chart' | 'preview' | null;
  onPickerMode?(mode: 'chart' | 'preview'): void;
  onPick?(frameId: string): void;
}
const diagramLabel = (kind: ChartLibraryRow['diagram'], zh: boolean) =>
  (zh
    ? {
        canvas: '画布',
        mind: '思维导图',
        workflow: '流程图',
        architecture: '架构图',
        'uml-class': 'UML 类图',
        'uml-sequence': 'UML 时序图',
      }
    : {
        canvas: 'Canvas',
        mind: 'Mind',
        workflow: 'Flowchart',
        architecture: 'Architecture',
        'uml-class': 'UML Class Diagram',
        'uml-sequence': 'UML Sequence Diagram',
      })[kind];

/** Every row is one independent source file; relationships come from references. */
export function ChartLibrary({
  actionSource,
  rows,
  locale = 'zh',
  onOpen,
  onBack,
  query: queryProp,
  diagram: diagramProp,
  scrollTop = 0,
  onQueryChange,
  onDiagramChange,
  onScroll,
  picker = null,
  onPickerMode,
  onPick,
}: ChartLibraryProps) {
  useActionSource(actionSource);
  const zh = locale === 'zh';
  const [localQuery, setLocalQuery] = useState('');
  const [localDiagram, setLocalDiagram] = useState<
    'all' | ChartLibraryRow['diagram']
  >('all');
  const query = queryProp ?? localQuery;
  const diagram = diagramProp ?? localDiagram;
  const filtered = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            (!picker ||
              (picker === 'chart'
                ? row.diagram !== 'canvas'
                : row.diagram === 'canvas')) &&
            (diagram === 'all' || row.diagram === diagram) &&
            `${row.name} ${row.path}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rows, picker, diagram, query],
  );
  const back = bindWorkspaceAction(actionSource, 'workspace.library.back', {
    present: onBack,
  });
  return (
    <section
      className="chart-library"
      aria-label={zh ? '图表库' : 'Chart library'}
    >
      <header className="chart-library-header">
        {onBack && (
          <button
            type="button"
            className="workspace-button-ghost"
            disabled={back ? !back.getState().enabled : !!actionSource}
            onClick={() => {
              if (back) void back.execute();
              else if (!actionSource) onBack();
            }}
          >
            <ArrowLeft size={16} aria-hidden />
            {back?.label(locale) ?? (zh ? '返回编辑' : 'Back to editor')}
          </button>
        )}
        <h2>
          {picker
            ? zh
              ? '引用已有'
              : 'Reference existing'
            : zh
              ? '图表库'
              : 'Chart library'}
        </h2>
        <span>
          {zh ? `共 ${filtered.length} 个` : `${filtered.length} charts`}
        </span>
        {picker && onPickerMode && (
          <div
            className="chart-library-modes"
            role="group"
            aria-label={zh ? '选用模式' : 'Picker mode'}
          >
            <button
              type="button"
              aria-pressed={picker === 'chart'}
              onClick={() => onPickerMode('chart')}
            >
              {zh ? '图表' : 'Charts'}
            </button>
            <button
              type="button"
              aria-pressed={picker === 'preview'}
              onClick={() => onPickerMode('preview')}
            >
              {zh ? '画布预览' : 'Canvas preview'}
            </button>
          </div>
        )}
      </header>
      <div className="chart-library-filters">
        <label className="chart-library-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            aria-label={zh ? '搜索名称' : 'Search name'}
            placeholder={zh ? '搜索名称' : 'Search name'}
            value={query}
            onChange={(event) =>
              (onQueryChange ?? setLocalQuery)(event.target.value)
            }
          />
        </label>
        <select
          aria-label={zh ? '类型' : 'Type'}
          value={diagram}
          onChange={(event) =>
            (onDiagramChange ?? setLocalDiagram)(
              event.target.value as typeof diagram,
            )
          }
        >
          <option value="all">{zh ? '全部类型' : 'All types'}</option>
          {Object.keys(diagramIcons).map((kind) => (
            <option key={kind} value={kind}>
              {diagramLabel(kind as ChartLibraryRow['diagram'], zh)}
            </option>
          ))}
        </select>
      </div>
      {!filtered.length ? (
        <p>
          {rows.length
            ? zh
              ? '没有符合筛选的图表'
              : 'No charts match the filter'
            : zh
              ? '还没有图表'
              : 'No charts yet'}
        </p>
      ) : (
        <div
          className="chart-library-scroll"
          ref={(node) => {
            if (node && node.scrollTop !== scrollTop)
              node.scrollTop = scrollTop;
          }}
          onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
        >
          <table className="chart-library-table">
            <thead>
              <tr>
                <th>{zh ? '类型' : 'Type'}</th>
                <th>{zh ? '名称' : 'Name'}</th>
                <th>{zh ? '引用' : 'References'}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const Icon = diagramIcons[row.diagram];
                const open = bindWorkspaceAction(
                  actionSource,
                  picker ? 'workspace.library.pick' : 'workspace.file.open',
                  {
                    fileId: row.frameId,
                    origin: picker ? undefined : 'library',
                    ...(picker ? { present: () => onPick?.(row.frameId) } : {}),
                  },
                );
                return (
                  <tr
                    key={row.frameId}
                    data-conflict={row.conflicted ? 'true' : undefined}
                  >
                    <td>
                      <span className="chart-library-type">
                        <Icon size={15} aria-hidden />
                        {diagramLabel(row.diagram, zh)}
                      </span>
                    </td>
                    <td>
                      <div className="chart-library-name">
                        <span>{row.name}</span>
                        {row.conflicted ? (
                          <TriangleAlert
                            size={13}
                            className="file-tree-conflict"
                            aria-label={zh ? '存在冲突' : 'Conflicted'}
                          />
                        ) : row.dirty ? (
                          <span
                            className="file-tree-dirty"
                            aria-label={zh ? '未保存' : 'Unsaved'}
                          />
                        ) : null}
                      </div>
                      <div className="chart-library-path" title={row.path}>
                        {row.path}
                      </div>
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
                        disabled={
                          open ? !open.getState().enabled : !!actionSource
                        }
                        onClick={() => {
                          if (open) void open.execute();
                          else if (!actionSource) {
                            if (picker && onPick) onPick(row.frameId);
                            else onOpen(row.frameId);
                          }
                        }}
                      >
                        {open?.label(locale) ??
                          (picker
                            ? zh
                              ? '选用'
                              : 'Use'
                            : zh
                              ? '打开'
                              : 'Open')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
