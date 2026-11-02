import { VmDialog } from '@sue/verd-board-ui';
import { useState, useRef, useEffect } from 'react';
import { FileText } from 'lucide-react';
export function QuickOpen({
  files,
  recent,
  onOpen,
  onClose,
  zh,
}: {
  files: { id: string; title: string; path: string }[];
  recent: string[];
  onOpen(id: string): void;
  onClose(): void;
  zh: boolean;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDialogElement>(null);
  const rows = (
    query
      ? files.filter((f) =>
          `${f.title} ${f.path}`.toLowerCase().includes(query.toLowerCase()),
        )
      : recent
          .map((id) => files.find((f) => f.id === id))
          .filter((f): f is (typeof files)[number] => !!f)
  ).slice(0, 30);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    const element = ref.current;
    element?.showModal();
    return () => {
      element?.close();
      opener?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="workspace-quick-open"
      aria-label={zh ? '快速打开' : 'Quick open'}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          setActive((i) =>
            Math.max(
              0,
              Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)),
            ),
          );
        }
        if (e.key === 'Enter' && rows[active]) {
          e.preventDefault();
          onOpen(rows[active]!.id);
        }
      }}
    >
      <input
        ref={(el) => el?.focus()}
        type="search"
        placeholder={zh ? '搜索文件名或路径…' : 'Search files…'}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        aria-label={zh ? '快速打开' : 'Quick open'}
      />
      <div role="listbox">
        {rows.map((f, i) => (
          <button
            type="button"
            role="option"
            aria-selected={i === active}
            key={f.id}
            onClick={() => onOpen(f.id)}
          >
            <FileText size={16} />
            <span>
              {f.title}
              <small>{f.path}</small>
            </span>
          </button>
        ))}
        {!rows.length && (
          <p>{zh ? '没有可打开的匹配文件' : 'No matching files'}</p>
        )}
      </div>
      <footer>
        <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd> <kbd>Esc</kbd>
      </footer>
    </dialog>
  );
}

export const ManagementDialog = VmDialog;
