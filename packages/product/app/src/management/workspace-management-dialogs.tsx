import { WorkspaceButton, WorkspaceInput, VmDialog } from '@sue/verd-board-ui';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import type { SearchHit, WorkspaceSearchScope } from './search';

interface PathResult {
  path: string;
  kind: 'resource' | 'failed';
}

const maxResults = 60;

function searchExcerpt(hit: SearchHit) {
  const text = hit.fragment.text;
  const index = text.toLowerCase().indexOf(hit.term);
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + hit.term.length)}</mark>
      {text.slice(index + hit.term.length)}
    </>
  );
}

export function WorkspaceSearchDialog({
  zh,
  scope,
  query,
  hits,
  paths,
  loading,
  onQuery,
  onScope,
  onClose,
  onOpenHit,
  onOpenPath,
}: {
  zh: boolean;
  scope: WorkspaceSearchScope;
  query: string;
  hits: SearchHit[];
  paths: PathResult[];
  loading: boolean;
  onQuery(query: string): void;
  onScope(scope: WorkspaceSearchScope): void;
  onClose(): void;
  onOpenHit(hit: SearchHit): Promise<boolean>;
  onOpenPath(result: PathResult): void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(maxResults);
  const [opening, setOpening] = useState(false);
  const selecting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const listId = useId();
  const rows = [
    ...hits.map((hit) => ({
      title: hit.title || hit.path.split('/').pop()!,
      path: hit.path,
      hit,
      open: () => onOpenHit(hit),
    })),
    ...paths.map((item) => ({
      title: item.path.split('/').pop()!,
      path: item.path,
      hit: undefined,
      open: async () => {
        onOpenPath(item);
        return true;
      },
    })),
  ];
  const visibleRows = rows.slice(0, limit);
  const index = Math.min(active, visibleRows.length - 1);
  useLayoutEffect(() => {
    results.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);
  useLayoutEffect(() => {
    setActive(0);
    setLimit(maxResults);
    input.current?.focus();
  }, [scope]);
  const select = async (position: number) => {
    const row = visibleRows[position];
    if (!row || selecting.current) return;
    selecting.current = true;
    setOpening(true);
    try {
      if (await row.open()) onClose();
    } finally {
      selecting.current = false;
      setOpening(false);
    }
  };

  return (
    <VmDialog
      title={t('搜索当前工作区', 'Search current workspace')}
      className="workspace-search-dialog"
      data-testid="workspace-search-dialog"
      closeLabel={t('关闭', 'Close')}
      busy={opening}
      onClose={onClose}
    >
      <div className="vm-search">
        <Search className="vm-search__icon" size={16} aria-hidden />
        <WorkspaceInput
          ref={input}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={visibleRows.length > 0}
          aria-activedescendant={index >= 0 ? `${listId}-${index}` : undefined}
          aria-label={t('搜索当前工作区', 'Search current workspace')}
          className="vm-input--search"
          value={query}
          placeholder={t(
            '输入标题、路径或正文关键词…',
            'Enter a title, path or text…',
          )}
          onChange={(event) => {
            onQuery(event.target.value);
            setActive(0);
            setLimit(maxResults);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Escape' && !selecting.current) {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(
                Math.max(
                  0,
                  Math.min(
                    visibleRows.length - 1,
                    index + (event.key === 'ArrowDown' ? 1 : -1),
                  ),
                ),
              );
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              void select(index);
            }
          }}
        />
      </div>
      <div
        className="workspace-search-scopes"
        role="group"
        aria-label={t('搜索范围', 'Search scope')}
      >
        {(
          [
            ['all', t('全部', 'All')],
            ['names', t('标题与路径', 'Title and path')],
            ['body', t('正文', 'Content')],
          ] as const
        ).map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={scope === key}
            onClick={() => onScope(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        ref={results}
        id={listId}
        role="listbox"
        aria-label={t('搜索结果', 'Search results')}
        aria-busy={loading}
      >
        {visibleRows.map((row, position) => (
          <button
            type="button"
            role="option"
            tabIndex={-1}
            id={`${listId}-${position}`}
            key={`${row.path}-${position}`}
            aria-selected={position === index}
            aria-disabled={opening || undefined}
            onClick={() => void select(position)}
          >
            <FileText strokeWidth={1.75} size={16} aria-hidden />
            <span className="workspace-search-result">
              <span>{row.title}</span>
              <small>{row.path}</small>
              {row.hit?.source === 'content' && (
                <span className="workspace-search-excerpt">
                  {searchExcerpt(row.hit)}
                </span>
              )}
            </span>
            <span className="vm-badge">
              {row.hit?.source === 'content'
                ? t('正文', 'Content')
                : t('标题与路径', 'Title and path')}
            </span>
          </button>
        ))}
      </div>
      {!visibleRows.length && (
        <p className="vm-empty" role="status">
          {loading
            ? t('正在搜索…', 'Searching…')
            : query.trim()
              ? t('没有匹配的内容', 'No matching content')
              : t(
                  '输入关键词搜索当前工作区',
                  'Enter a query to search this workspace',
                )}
        </p>
      )}
      {rows.length > limit && (
        <WorkspaceButton
          type="button"
          onClick={() => setLimit(limit + maxResults)}
        >
          {t('显示更多', 'Show more')}
        </WorkspaceButton>
      )}
    </VmDialog>
  );
}

export const ManagementDialog = VmDialog;
