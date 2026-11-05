import { useId, useState, type ReactNode, type ComponentProps } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { WorkspaceButton } from '../workspace-design';
export function SettingsPage({
  title,
  description,
  status,
}: {
  title: string;
  description?: string;
  status?: ReactNode;
}) {
  return (
    <header className="vm-settings-page__header">
      <div>
        <h1 className="vm-settings-page__title">{title}</h1>
        {description && (
          <p className="vm-settings-page__description">{description}</p>
        )}
      </div>
      {status}
    </header>
  );
}
export function SettingsSection({
  title,
  children,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & { title: ReactNode }) {
  const id = useId();
  return (
    <section
      {...props}
      className={`vm-settings-section ${props.className ?? ''}`}
      aria-labelledby={id}
    >
      <h2 id={id} className="vm-settings-section__title">
        {title}
      </h2>
      {children}
    </section>
  );
}
export function SettingsRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="vm-settings-row">
      <span>{label}</span>
      {children}
    </div>
  );
}
export function SettingsKeyValue({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="vm-kv">
      {items.map(({ label, value }) => (
        <div key={label} className="settings-kv-group">
          <dt className="vm-kv__key">{label}</dt>
          <dd className="vm-kv__value">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function SettingsActions({ children }: { children: ReactNode }) {
  return <div className="vm-settings-actions">{children}</div>;
}
export function Disclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div className="vm-disclosure">
      <WorkspaceButton
        intent="ghost"
        size="small"
        icon={<Icon size={14} aria-hidden />}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {label}
      </WorkspaceButton>
      {open && (
        <div className="vm-disclosure__body" id={id}>
          {children}
        </div>
      )}
    </div>
  );
}
