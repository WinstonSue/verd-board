import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, FileText, Info, MapPin, PanelsTopLeft } from 'lucide-react';
import { FileTreeMenu, type FileTreeMenuItem } from './file-tree-menu';
import type { WorkspaceActionBinding } from './workspace-action-bindings';

export interface WorkspaceReferenceLocationGroup {
  fileId: string;
  title: string;
  kind: 'canvas' | 'document';
  items: { id: string; label: string; action: WorkspaceActionBinding }[];
}

export interface WorkspaceFileNavigationProps {
  actions?: ReactNode;
  title: string;
  path: string;
  active: boolean;
  locale: 'zh' | 'en';
  source?: { title: string; action: WorkspaceActionBinding };
  owner?: { title: string; action: WorkspaceActionBinding };
  revealAction: WorkspaceActionBinding;
  references: readonly WorkspaceReferenceLocationGroup[];
  onError?(message: string): void;
}

/** File identity, latest entry and inbound embeds are intentionally separate. */
export function WorkspaceFileNavigation({
  title,
  actions,
  path,
  active,
  locale,
  source,
  owner,
  revealAction,
  references,
  onError,
}: WorkspaceFileNavigationProps) {
  const [menu, setMenu] = useState<'info' | 'references' | null>(null);
  const infoRef = useRef<HTMLButtonElement>(null);
  const referencesRef = useRef<HTMLButtonElement>(null);
  const zh = locale === 'zh';
  const count = references.reduce(
    (total, group) => total + group.items.length,
    0,
  );
  useEffect(() => {
    if (!active) setMenu(null);
  }, [active]);
  useEffect(() => {
    if (!count && menu === 'references') setMenu(null);
  }, [count, menu]);
  const referenceItems: FileTreeMenuItem[] = references.flatMap((group) =>
    group.items.map((item, index) => ({
      id: item.id,
      label: item.label,
      icon: group.kind === 'document' ? FileText : PanelsTopLeft,
      groupLabel:
        index === 0
          ? `${group.title} · ${zh ? (group.kind === 'document' ? '文档' : '画布') : group.kind} · ${group.items.length}${zh ? ' 处' : ' embeds'}`
          : undefined,
      action: item.action,
      onSelect() {},
    })),
  );
  const infoItems: FileTreeMenuItem[] = [
    ...(owner
      ? [
          {
            id: 'owner',
            label: `${zh ? '所属画布' : 'Owner canvas'}：${owner.title}`,
            icon: PanelsTopLeft,
            action: owner.action,
            onSelect() {},
          },
        ]
      : []),
    {
      id: 'reveal',
      label: zh ? '在文件夹中显示' : 'Show in folder',
      icon: MapPin,
      groupLabel: path,
      action: revealAction,
      onSelect() {},
    },
  ];
  return (
    <div
      className="workspace-file-navigation"
      aria-label={zh ? '文件导航' : 'File navigation'}
    >
      <span className="workspace-file-navigation-title" title={title}>
        {title}
      </span>
      <button
        ref={infoRef}
        type="button"
        aria-label={zh ? '文件信息' : 'File information'}
        aria-haspopup="menu"
        aria-expanded={menu === 'info'}
        onClick={() => setMenu(menu === 'info' ? null : 'info')}
      >
        <Info strokeWidth={1.75} size={15} aria-hidden />
      </button>
      <div className="workspace-file-navigation-actions">
        {actions}
        {source && source.action.getState().visible ? (
          <button
            type="button"
            data-testid="navigation-return"
            data-action-id={source.action.id}
            className="workspace-file-navigation-return"
            title={`${zh ? '返回' : 'Back to'} ${source.title}`}
            disabled={!source.action.getState().enabled}
            onClick={() =>
              void source.action.execute().then((result) => {
                if (result.status === 'rejected')
                  onError?.(result.message ?? result.code);
              })
            }
          >
            <ArrowLeft strokeWidth={1.75} size={14} aria-hidden />
            <span>
              {zh ? '返回' : 'Back to'} {source.title}
            </span>
          </button>
        ) : null}
        {count > 0 ? (
          <button
            ref={referencesRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={menu === 'references'}
            data-testid="reference-locations-trigger"
            onClick={() => setMenu(menu === 'references' ? null : 'references')}
          >
            {zh ? `被引用 ${count} 处` : `${count} references`}
          </button>
        ) : null}
      </div>
      {menu && (menu === 'info' ? infoRef.current : referencesRef.current) ? (
        <FileTreeMenu
          label={
            menu === 'info'
              ? zh
                ? '文件信息'
                : 'File information'
              : zh
                ? '引用位置'
                : 'Reference locations'
          }
          anchor={(menu === 'info' ? infoRef.current : referencesRef.current)!}
          items={menu === 'info' ? infoItems : referenceItems}
          preserveItemLabels
          locale={locale}
          onClose={() => setMenu(null)}
          onError={onError}
        />
      ) : null}
    </div>
  );
}
