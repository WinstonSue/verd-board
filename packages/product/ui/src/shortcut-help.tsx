import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { X } from 'lucide-react';
import {
  matchesShortcut,
  shortcutCatalog,
  shortcutCategoryLabels,
  shortcutGroups,
  shortcutKeyLabel,
  shortcutLabels,
  type ShortcutLocale,
  type ShortcutScene,
} from './shortcut-catalog';
import './shortcut-help.scss';

export function ShortcutHelp({
  scene,
  locale,
  returnFocusRef,
  onClose,
}: {
  scene: ShortcutScene;
  locale: ShortcutLocale;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [category, setCategory] = useState<ShortcutScene | 'all'>(scene);
  const [query, setQuery] = useState('');
  const platform =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
      ? 'mac'
      : 'other';
  const labels = shortcutLabels[locale];
  const groups = shortcutGroups(category).map((id) => ({
    id,
    items: shortcutCatalog[id].filter((item) =>
      matchesShortcut(item, query, platform, locale),
    ),
  }));
  const hasResults = groups.some((group) => group.items.length > 0);

  useEffect(() => {
    const element = dialog.current!;
    const opener = returnFocusRef.current;
    element.showModal();
    search.current?.focus();
    return () => {
      element.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [returnFocusRef]);

  return (
    <dialog
      ref={dialog}
      className="shortcut-help"
      data-testid="shortcut-help"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled)',
          ),
        ];
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <header className="shortcut-help__header">
        <h2 id={titleId}>{labels.title}</h2>
        <button type="button" aria-label={labels.close} onClick={onClose}>
          <X size={20} aria-hidden />
        </button>
      </header>
      <input
        ref={search}
        type="search"
        className="shortcut-help__search"
        aria-label={labels.search}
        placeholder={labels.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div
        className="shortcut-help__categories"
        role="group"
        aria-label={labels.categories}
      >
        {(
          [
            'whiteboard',
            'mind',
            'workflow',
            'architecture',
            'document',
            'presentation',
            'all',
          ] as const
        ).map((id) => (
          <button
            type="button"
            key={id}
            aria-pressed={category === id}
            onClick={() => setCategory(id)}
          >
            {id === 'all' ? labels.all : shortcutCategoryLabels[id][locale]}
          </button>
        ))}
      </div>
      <div className="shortcut-help__content">
        <p className="shortcut-help__hint">
          {category === 'all'
            ? labels.allHint
            : category === 'document'
              ? labels.documentHint
              : category === 'presentation'
                ? labels.presentationHint
                : labels.canvasHint}
        </p>
        {!query.trim() &&
          (category === 'workflow' || category === 'architecture') && (
            <p className="shortcut-help__hint">{labels.noSpecific}</p>
          )}
        {!hasResults && <p role="status">{labels.empty}</p>}
        {groups
          .filter((group) => group.items.length > 0)
          .map(({ id, items }) => (
            <section key={id} aria-label={shortcutCategoryLabels[id][locale]}>
              <h3>{shortcutCategoryLabels[id][locale]}</h3>
              <dl>
                {items.map((item) => (
                  <div className="shortcut-help__row" key={item.id}>
                    <dt>
                      {item.label[locale]}
                      {item.condition && (
                        <small>{item.condition[locale]}</small>
                      )}
                    </dt>
                    <dd>
                      {item.keys.map((keys, index) => (
                        <span className="shortcut-help__binding" key={index}>
                          {index > 0 && (
                            <span className="shortcut-help__or">
                              {labels.or}
                            </span>
                          )}
                          <span className="shortcut-help__chord">
                            {keys.map((key, keyIndex) => (
                              <span key={keyIndex}>
                                {keyIndex > 0 && <span aria-hidden>+</span>}
                                <kbd>
                                  {shortcutKeyLabel(key, platform, locale)}
                                </kbd>
                              </span>
                            ))}
                          </span>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
      </div>
    </dialog>
  );
}
