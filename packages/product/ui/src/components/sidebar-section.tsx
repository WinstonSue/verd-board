import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
export function SidebarSection({
  title,
  storageKey,
  children,
}: {
  title: string;
  storageKey: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) !== 'closed';
    } catch {
      return true;
    }
  });
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="vm-sidebar-section">
      <button
        type="button"
        className="vm-sidebar-section__toggle vm-section-label"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          try {
            localStorage.setItem(storageKey, open ? 'closed' : 'open');
          } catch {
            /* Storage can be unavailable in embedded hosts. */
          }
        }}
      >
        <span className="vm-sidebar-section__label">{title}</span>
        <Chevron size={14} aria-hidden />
      </button>
      {open && children}
    </div>
  );
}
