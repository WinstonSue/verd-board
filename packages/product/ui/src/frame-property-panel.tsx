import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useId,
  useState,
  type ReactNode,
} from 'react';
import { ChevronDown } from 'lucide-react';

export const FramePropertyContext = createContext({
  identity: '',
  disabled: false,
});
const GroupContext = createContext<{
  collapsed: Record<string, boolean>;
  toggle(id: string, current: boolean): void;
  expand(id: string): void;
}>({ collapsed: {}, toggle() {}, expand() {} });

/** Lives for one canvas session; group state is never written into the document. */
export function FramePropertyPanel({
  title,
  children,
  open,
  cellId,
  identity,
  disabled,
}: {
  title: ReactNode;
  children: ReactNode;
  open: boolean;
  cellId?: string;
  identity: string;
  disabled: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const expand = useCallback(
    (id: string) =>
      setCollapsed((previous) =>
        previous[id] === false ? previous : { ...previous, [id]: false },
      ),
    [],
  );
  return (
    <aside
      data-selected-cell-id={cellId}
      aria-label="Properties"
      hidden={!open}
      className={`frame-inspector right-panel${open ? ' is-open' : ''}`}
    >
      <div className="frame-inspector__header" role="heading" aria-level={3}>
        {title}
      </div>
      <GroupContext.Provider
        value={{
          collapsed,
          expand,
          toggle: (id, current) =>
            setCollapsed((previous) => ({ ...previous, [id]: !current })),
        }}
      >
        <FramePropertyContext.Provider value={{ identity, disabled }}>
          <div className="frame-inspector__scroll">{children}</div>
        </FramePropertyContext.Provider>
      </GroupContext.Provider>
    </aside>
  );
}

export function FramePropertyGroup({
  id,
  title,
  children,
  defaultCollapsed = false,
  label = title,
  reveal = 0,
}: {
  id: string;
  title: string;
  label?: string;
  children: ReactNode;
  defaultCollapsed?: boolean;
  reveal?: number;
}) {
  const groups = useContext(GroupContext);
  const contentId = useId();
  const expand = groups.expand;
  useEffect(() => {
    if (reveal) expand(id);
  }, [expand, id, reveal]);
  const collapsed = groups.collapsed[id] ?? defaultCollapsed;
  const [hasExpanded, setHasExpanded] = useState(!collapsed);
  useEffect(() => {
    if (!collapsed && !hasExpanded) setHasExpanded(true);
  }, [collapsed, hasExpanded]);
  return (
    <section
      className="frame-property-group"
      aria-label={label}
      data-property-group={id}
    >
      <button
        type="button"
        className="frame-property-group__toggle"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={() => groups.toggle(id, collapsed)}
      >
        {title}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div
        id={contentId}
        className="frame-property-group__content"
        hidden={collapsed}
      >
        {hasExpanded || !collapsed ? children : null}
      </div>
    </section>
  );
}
