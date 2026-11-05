import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
} from '@floating-ui/dom';
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileSymlink,
  Globe,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image,
  LayoutDashboard,
  List,
  ListOrdered,
  Minus,
  Paperclip,
  Quote,
  Sigma,
  SquareCode,
  Table,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { BoundAction } from '@sue/board-common';
import type { DocumentReferenceChoice } from '../../types/document';
import { useDocumentBubble } from './document-editor-bubble';
import { documentInsertActions } from './document-insert-actions';

export type DocumentInsertSession = {
  kind: 'slash' | 'reference';
  from: number;
  to: number;
  query: string;
  isCurrent?: () => boolean;
};

type CommandAppearance = readonly [icon: LucideIcon, zh: string, en: string];

const headingActions = [
  [
    'set-heading',
    '一级标题',
    'Heading 1',
    [Heading1, '添加主标题', 'Add a main heading'],
    1,
  ],
  [
    'set-heading',
    '二级标题',
    'Heading 2',
    [Heading2, '添加小节标题', 'Add a section heading'],
    2,
  ],
  [
    'set-heading',
    '三级标题',
    'Heading 3',
    [Heading3, '添加三级标题', 'Add a level 3 heading'],
    3,
  ],
  [
    'set-heading',
    '四级标题',
    'Heading 4',
    [Heading4, '添加四级标题', 'Add a level 4 heading'],
    4,
  ],
  [
    'set-heading',
    '五级标题',
    'Heading 5',
    [Heading5, '添加五级标题', 'Add a level 5 heading'],
    5,
  ],
  [
    'set-heading',
    '六级标题',
    'Heading 6',
    [Heading6, '添加六级标题', 'Add a level 6 heading'],
    6,
  ],
] as const;

const blockActions = [
  ['set-paragraph', '正文', 'Text', [Type, '输入普通文本', 'Write plain text']],
  [
    'toggle-bullet-list',
    '无序列表',
    'Bulleted list',
    [List, '用圆点列出条目', 'List items with bullets'],
  ],
  [
    'toggle-ordered-list',
    '有序列表',
    'Numbered list',
    [ListOrdered, '按编号排列条目', 'List items in order'],
  ],
  [
    'toggle-blockquote',
    '引用',
    'Quote',
    [Quote, '突出引用内容', 'Set text apart as a quote'],
  ],
  [
    'toggle-code-block',
    '代码块',
    'Code block',
    [SquareCode, '插入保留格式的代码', 'Add a formatted code snippet'],
  ],
  [
    'wrap-details',
    '折叠块',
    'Toggle block',
    [
      ChevronsUpDown,
      '将内容放入可折叠区域',
      'Put content in a collapsible block',
    ],
  ],
  [
    'unwrap-details',
    '取消折叠块',
    'Unwrap toggle block',
    [
      ChevronsDownUp,
      '将折叠内容移回正文',
      'Move content out of the toggle block',
    ],
  ],
] as const;

const insertAppearance = {
  'image-dialog': [Image, '添加图片到文档', 'Add an image to the document'],
  'attachment-dialog': [Paperclip, '添加文件附件', 'Attach a file'],
  'web-dialog': [Globe, '在文档中嵌入网页', 'Embed a web page'],
  'frame-dialog': [
    LayoutDashboard,
    '引用工作区中的图表',
    'Reference a workspace canvas',
  ],
  'insert-table': [
    Table,
    '用行和列组织内容',
    'Organize content in rows and columns',
  ],
  'insert-horizontal-rule': [
    Minus,
    '用横线分隔内容',
    'Separate content with a line',
  ],
  'insert-inline-math': [
    Sigma,
    '在文字中插入公式',
    'Insert an equation within a line',
  ],
  'insert-block-math': [
    Sigma,
    '单独显示一条公式',
    'Display an equation on its own line',
  ],
} satisfies Record<
  (typeof documentInsertActions)[number][0],
  CommandAppearance
>;

type Row = {
  id: string;
  title: string;
  detail?: string;
  path?: string;
  icon: LucideIcon;
  disabled?: boolean;
  submenu?: boolean;
  select(): void;
};

export function DocumentInsertPopover({
  editor,
  session,
  locale,
  choices,
  actions,
  dismiss,
  executeSlash,
  insertReference,
  insertKeys,
}: {
  editor: Editor;
  session: DocumentInsertSession;
  locale: 'zh' | 'en';
  choices?: readonly DocumentReferenceChoice[];
  actions?: readonly BoundAction[];
  dismiss(): void;
  executeSlash(id: string, args?: unknown): void;
  insertReference(choice: DocumentReferenceChoice): void;
  insertKeys: React.MutableRefObject<
    ((event: KeyboardEvent) => boolean) | null
  >;
}) {
  const zh = locale === 'zh';
  const slash = session.kind === 'slash';
  const detailId = useId();
  const [activeId, setActiveId] = useState<string>();
  const [headingOpen, setHeadingOpen] = useState(false);
  const [headingActiveId, setHeadingActiveId] = useState<string>();
  const headingTrigger = useRef<HTMLButtonElement>(null);
  const headingPanel = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLButtonElement>(null);
  const activeHeadingRow = useRef<HTMLButtonElement>(null);
  const headingPanelId = useId();
  const latestSession = useRef(session);
  latestSession.current = session;
  const anchor = useCallback(
    () => ({
      contextElement: editor.view.dom,
      getBoundingClientRect() {
        const { left, top, bottom } = editor.view.coordsAtPos(
          latestSession.current.from,
        );
        return new DOMRect(left, top, 0, bottom - top);
      },
    }),
    [editor],
  );
  const onPositioned = useCallback((host: HTMLElement) => {
    host.tabIndex = -1;
  }, []);
  const host = useDocumentBubble(
    editor,
    'documentInsertPopover',
    true,
    anchor,
    onPositioned,
  );

  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      if (!host.contains(event.target as Node)) dismiss();
    };
    const focus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!editor.view.dom.contains(target)) dismiss();
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('focusin', focus, true);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('focusin', focus, true);
    };
  }, [dismiss, editor, host]);

  const query = session.query.trim().toLocaleLowerCase();
  const matches = (title: string, detail = '') =>
    query
      .split(/\s+/)
      .every((word) => `${title} ${detail}`.toLocaleLowerCase().includes(word));
  const command = (
    id: string,
    titleZh: string,
    titleEn: string,
    [icon, detailZh, detailEn]: CommandAppearance,
    args?: unknown,
  ): Row[] => {
    const title = zh ? titleZh : titleEn;
    const keywords =
      id === 'set-heading' && typeof args === 'number'
        ? `${titleEn} h${args}`
        : titleEn;
    if (!matches(title, keywords)) return [];
    const action = actions?.find(
      (candidate) => candidate.id === 'document.' + id,
    );
    const state = action?.getState(args);
    if (!action || !state?.visible) return [];
    return [
      {
        id: title,
        title,
        detail: zh ? detailZh : detailEn,
        icon,
        disabled: !state.enabled,
        select: () => executeSlash(action.id, args),
      },
    ];
  };
  const headings = slash
    ? headingActions.flatMap(([id, cn, en, appearance, args]) =>
        command(id, cn, en, appearance, args),
      )
    : [];
  const openHeadings = () => {
    setActiveId('heading-menu');
    setHeadingActiveId(undefined);
    setHeadingOpen(true);
  };
  const closeHeadings = () => {
    setHeadingOpen(false);
    setActiveId('heading-menu');
  };
  const showHeadings = slash && !query && headingOpen;
  useLayoutEffect(() => {
    setHeadingOpen(false);
  }, [session.query]);
  useEffect(() => {
    if (!showHeadings) return;
    const trigger = headingTrigger.current;
    const panel = headingPanel.current;
    if (!trigger || !panel) return;
    let disposed = false;
    const stop = autoUpdate(trigger, panel, () => {
      void computePosition(trigger, panel, {
        placement: 'right-start',
        middleware: [
          offset(6),
          flip({ padding: 8, fallbackAxisSideDirection: 'end' }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ availableWidth, availableHeight }) {
              if (disposed) return;
              panel.style.maxWidth = `${Math.max(0, availableWidth)}px`;
              panel.style.maxHeight = `${Math.max(0, availableHeight)}px`;
            },
          }),
        ],
      }).then(({ x, y }) => {
        if (disposed) return;
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        panel.dataset['positioned'] = '';
      });
    });
    return () => {
      disposed = true;
      stop();
    };
  }, [showHeadings]);
  const headingEntry: Row = {
    id: 'heading-menu',
    title: zh ? '标题' : 'Headings',
    detail: zh ? '选择一级到六级标题' : 'Choose a heading level',
    icon: Heading,
    disabled: !headings.some((row) => !row.disabled),
    submenu: true,
    select: openHeadings,
  };
  const referenceResults = slash
    ? []
    : (choices ?? []).filter((choice) => matches(choice.title, choice.path));
  const titleCounts = new Map<string, number>();
  for (const { title } of referenceResults)
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  const rank = (choice: DocumentReferenceChoice) => {
    const title = choice.title.toLocaleLowerCase();
    return title === query ? 0 : title.startsWith(query) ? 1 : 2;
  };
  const sections: { label: string; rows: Row[] }[] = slash
    ? [
        {
          label: zh ? '基础' : 'Basic',
          rows: [
            ...blockActions
              .slice(0, 1)
              .flatMap(([id, cn, en, appearance]) =>
                command(id, cn, en, appearance),
              ),
            ...(query ? headings : headings.length ? [headingEntry] : []),
            ...blockActions
              .slice(1)
              .flatMap(([id, cn, en, appearance]) =>
                command(id, cn, en, appearance),
              ),
          ],
        },
        {
          label: zh ? '插入内容' : 'Insert content',
          rows: documentInsertActions.flatMap(([id, cn, en]) =>
            command(id, cn, en, insertAppearance[id]),
          ),
        },
      ]
    : [
        {
          label: zh ? '文档与图表' : 'Documents and canvases',
          rows: referenceResults
            .sort(
              (a, b) =>
                rank(a) - rank(b) || a.title.localeCompare(b.title, locale),
            )
            .map((choice) => ({
              id: choice.href,
              title: choice.title,
              detail:
                titleCounts.get(choice.title) === 1 ? undefined : choice.path,
              path: choice.path,
              icon: choice.kind === 'document' ? FileSymlink : LayoutDashboard,
              select: () => insertReference(choice),
            })),
        },
      ];
  const rows = sections.flatMap((section) => section.rows);
  const enabled = rows.filter((row) => !row.disabled);
  const active = enabled.find((row) => row.id === activeId) ?? enabled[0];
  const enabledHeadings = headings.filter((row) => !row.disabled);
  const activeHeading =
    enabledHeadings.find((row) => row.id === headingActiveId) ??
    enabledHeadings[0];
  const handleKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || editor.view.composing)
      return false;
    switch (event.key) {
      case 'Escape':
        if (showHeadings) closeHeadings();
        else dismiss();
        return true;
      case 'ArrowRight':
        if (active?.submenu) {
          openHeadings();
          return true;
        }
        return false;
      case 'ArrowLeft':
        if (!showHeadings) return false;
        closeHeadings();
        return true;
      case 'ArrowDown':
      case 'ArrowUp': {
        const current = showHeadings ? activeHeading : active;
        const items = showHeadings ? enabledHeadings : enabled;
        if (!current) return false;
        const index = items.indexOf(current);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = items[(index + step + items.length) % items.length];
        if (next) {
          if (showHeadings) setHeadingActiveId(next.id);
          else setActiveId(next.id);
        }
        return true;
      }
      case 'Enter': {
        const selected = showHeadings ? activeHeading : active;
        if (selected) {
          selected.select();
          return true;
        }
        return false;
      }
      case 'Tab':
        dismiss();
        return false;
      default:
        return false;
    }
  };
  useLayoutEffect(() => {
    insertKeys.current = handleKey;
    return () => {
      insertKeys.current = null;
    };
  });
  useLayoutEffect(() => {
    if (activeId) {
      const row = active?.submenu ? headingTrigger.current : activeRow.current;
      row?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [activeId, active?.id]);

  useLayoutEffect(() => {
    if (showHeadings)
      activeHeadingRow.current?.scrollIntoView?.({ block: 'nearest' });
  }, [showHeadings, activeHeading?.id]);

  const renderRow = (row: Row, key: string, inSubmenu = false) => {
    const descriptionId = `${detailId}-${key}`;
    const selected = row === (inSubmenu ? activeHeading : active);
    const rowRef = inSubmenu ? activeHeadingRow : activeRow;
    return (
      <button
        key={row.id}
        ref={row.submenu ? headingTrigger : selected ? rowRef : undefined}
        type="button"
        role={slash ? undefined : 'option'}
        aria-label={row.title}
        aria-describedby={row.detail ? descriptionId : undefined}
        aria-selected={slash ? undefined : selected}
        aria-haspopup={row.submenu ? 'menu' : undefined}
        aria-expanded={row.submenu ? showHeadings : undefined}
        aria-controls={row.submenu && showHeadings ? headingPanelId : undefined}
        title={row.path}
        tabIndex={-1}
        disabled={row.disabled}
        data-active={selected}
        onPointerMove={() => {
          if (row.disabled) return;
          if (inSubmenu) setHeadingActiveId(row.id);
          else {
            setActiveId(row.id);
            if (!row.submenu) setHeadingOpen(false);
          }
        }}
        onClick={row.select}
      >
        <span className="document-insert-popover__icon" aria-hidden>
          <row.icon size={16} strokeWidth={1.75} />
        </span>
        <span className="document-insert-popover__text">
          <span>{row.title}</span>
          {row.detail && (
            <small id={descriptionId} title={row.detail}>
              {row.detail}
            </small>
          )}
        </span>
        {row.submenu && (
          <ChevronRight strokeWidth={1.75} size={16} aria-hidden />
        )}
      </button>
    );
  };

  return createPortal(
    <div
      className={`document-insert-popover document-insert-popover--${session.kind}`}
      role={slash ? 'menu' : 'listbox'}
      aria-label={
        slash
          ? zh
            ? '插入内容'
            : 'Insert content'
          : zh
            ? '引用文档与图表'
            : 'Reference documents and canvases'
      }
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="document-insert-popover__list">
        {sections.map(
          ({ label, rows: sectionRows }, sectionIndex) =>
            sectionRows.length > 0 && (
              <div
                key={label}
                className="document-insert-popover__group"
                role="group"
                aria-label={label}
              >
                <div className="document-insert-popover__label">{label}</div>
                {sectionRows.map((row, index) =>
                  renderRow(row, `main-${sectionIndex}-${index}`),
                )}
              </div>
            ),
        )}
        {rows.length === 0 && (
          <div className="document-insert-popover__label" role="status">
            {zh ? '没有匹配的结果' : 'No matching results'}
          </div>
        )}
      </div>
      {showHeadings && (
        <div
          ref={headingPanel}
          id={headingPanelId}
          role="menu"
          aria-label={headingEntry.title}
          className="document-insert-popover document-insert-popover--slash document-insert-popover--headings"
        >
          <div className="document-insert-popover__list">
            {headings.map((row, index) =>
              renderRow(row, `heading-${index}`, true),
            )}
          </div>
        </div>
      )}
    </div>,
    host,
  );
}
