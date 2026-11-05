import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createWorkspaceLink,
  parseExternalLink,
  parseWorkspaceLink,
  type ActionResult,
} from '@sue/board-common';
import { Copy, Eye } from 'lucide-react';
import { LinkEditorHost, type LinkEditRequest } from '@sue/board-react-text';
import { VmDialog } from './components/vm-dialog';
import { WorkspaceButton, WorkspaceInput } from './workspace-design';
import './workspace-link-editor.scss';

export type WorkspaceLinkChoice = {
  title: string;
  detail: string;
  path?: string;
} & (
  | {
      href: string;
      kind?: 'folder' | 'document' | 'canvas' | 'heading' | 'block' | 'cell';
      legacyHref?: string;
    }
  | { folderPath: string }
);

type WorkspaceDraft = { href: string } | { folderPath: string };

const choiceKey = (choice: WorkspaceLinkChoice) =>
  'href' in choice ? choice.href : `folder:${choice.folderPath}`;

const looksInternal = (href: string) => /^(verd:\/\/|#)/i.test(href);

const targetKinds = {
  folder: ['文件夹', 'Folder'],
  document: ['文档', 'Document'],
  canvas: ['画布', 'Canvas'],
  heading: ['标题', 'Heading'],
  block: ['段落', 'Paragraph'],
  cell: ['图元', 'Canvas object'],
  file: ['文件', 'File'],
} as const;

function choiceKind(choice: WorkspaceLinkChoice) {
  if ('folderPath' in choice) return 'folder';
  if (choice.kind) return choice.kind;
  const target = parseWorkspaceLink(choice.href);
  return target?.kind === 'heading' && target.slug.startsWith('block:')
    ? 'block'
    : (target?.kind ?? 'file');
}

function resolveChoice(
  draft: WorkspaceDraft | null,
  choices: readonly WorkspaceLinkChoice[],
  sourceFileId?: string,
) {
  if (!draft) return;
  if ('folderPath' in draft)
    return choices.find((choice) =>
      'folderPath' in choice
        ? choice.folderPath === draft.folderPath
        : choiceKind(choice) === 'folder' && choice.detail === draft.folderPath,
    );
  const target = parseWorkspaceLink(draft.href, sourceFileId);
  if (!target) return;
  const canonical = createWorkspaceLink(target);
  const direct = choices.find(
    (choice) =>
      'href' in choice &&
      (choice.href === canonical || choice.legacyHref === canonical),
  );
  if (direct || target.kind !== 'cell') return direct;
  if (target.cellId === target.fileId) {
    const fileHref = createWorkspaceLink({
      kind: 'file',
      fileId: target.fileId,
    });
    const root = choices.find(
      (choice) => 'href' in choice && choice.href === fileHref,
    );
    if (root) return root;
  }
  const moved = choices.filter((choice) => {
    const candidate = 'href' in choice ? parseWorkspaceLink(choice.href) : null;
    return candidate?.kind === 'cell' && candidate.cellId === target.cellId;
  });
  return moved.length === 1 ? moved[0] : undefined;
}

interface LinkEditorOptions {
  locale: 'zh' | 'en';
  choices?: readonly WorkspaceLinkChoice[];
  createFolderLink?(path: string): Promise<string>;
  preview?(href: string, sourceFileId?: string): void;
}

export function WorkspaceLinkEditor({
  children,
  scope,
  workspace,
  ...options
}: LinkEditorOptions & {
  children: ReactNode;
  scope: string | null;
  workspace?: object;
}) {
  const [active, setActive] = useState<{
    request: LinkEditRequest;
    scope: string;
    workspace?: object;
    abort: AbortController;
  } | null>(null);
  const current =
    active && active.scope === scope && active.workspace === workspace
      ? active
      : null;
  const live = useRef(current);
  live.current = current;
  const owner = useRef({ scope, workspace });
  owner.current = { scope, workspace };
  useLayoutEffect(() => {
    if (active && !current) {
      active.abort.abort();
      active.request.finish?.('invalidated');
      setActive(null);
    }
  }, [active, current]);
  useLayoutEffect(
    () => () => {
      live.current?.abort.abort();
      live.current?.request.finish?.('invalidated');
      live.current = null;
    },
    [],
  );
  const open = useCallback(
    (request: LinkEditRequest) => {
      if (!scope || live.current) {
        request.finish?.('invalidated');
        return;
      }
      const next = { request, scope, workspace, abort: new AbortController() };
      live.current = next;
      setActive(next);
    },
    [scope, workspace],
  );
  return (
    <LinkEditorHost.Provider value={open}>
      {children}
      {current && (
        <LinkDialog
          {...options}
          request={current.request}
          signal={current.abort.signal}
          isActive={() => live.current === current}
          onClose={(reason) => {
            if (live.current !== current) return;
            live.current = null;
            setActive(null);
            requestAnimationFrame(() =>
              current.request.finish?.(
                owner.current.scope === current.scope &&
                  owner.current.workspace === current.workspace &&
                  !live.current
                  ? reason
                  : 'invalidated',
              ),
            );
          }}
        />
      )}
    </LinkEditorHost.Provider>
  );
}

function LinkDialog({
  request,
  locale,
  choices,
  createFolderLink,
  preview,
  isActive,
  onClose,
  signal,
}: LinkEditorOptions & {
  request: LinkEditRequest;
  isActive(): boolean;
  signal: AbortSignal;
  onClose(reason: 'saved' | 'cancelled'): void;
}) {
  const zh = locale === 'zh';
  const formId = useId();
  const listId = useId();
  const [draft, setDraft] = useState<WorkspaceDraft>({
    href: request.href ?? '',
  });
  const [edited, setEdited] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const saving = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const raw = 'href' in draft ? draft.href : '';
  const address = raw.trim();
  const internal = looksInternal(address);
  const selected = useMemo(
    () =>
      resolveChoice(
        'href' in draft ? (internal ? { href: address } : null) : draft,
        choices ?? [],
        request.sourceFileId,
      ),
    [address, choices, draft, internal, request.sourceFileId],
  );
  const external = !!parseExternalLink(address);
  const internalAddress =
    internal && parseWorkspaceLink(address, request.sourceFileId);
  const selectedHref =
    selected && 'href' in selected ? selected.href : undefined;
  const previewAddress =
    selectedHref ??
    (choices ? undefined : internalAddress ? address : undefined);
  const display =
    selected?.title ?? ('folderPath' in draft ? draft.folderPath : raw);
  const actualHref = address || selectedHref;
  const copyHref =
    internal && raw === request.href
      ? raw
      : external || internalAddress
        ? address
        : selectedHref;
  const removing = edited && !display.trim() && !!request.canRemove;
  const valid =
    !!selected || external || (!choices && !!internalAddress) || removing;
  const missing = (internal || 'folderPath' in draft) && !selected && !valid;
  const searching =
    !!choices && searchOpen && !!address && !selected && !internal && !external;
  const options = useMemo(
    () =>
      (choices ?? []).map((choice) => ({
        choice,
        kind: targetKinds[choiceKind(choice)][zh ? 0 : 1],
        location: choice.path ?? choice.detail,
      })),
    [choices, zh],
  );
  const terms = address.toLocaleLowerCase().split(/\s+/);
  const results = searching
    ? options
        .filter(({ choice, kind, location }) => {
          const text =
            `${choice.title} ${kind} ${choice.detail} ${location}`.toLocaleLowerCase();
          return terms.every((term) => text.includes(term));
        })
        .slice(0, 40)
    : [];
  const activeIndex = Math.min(highlight, results.length - 1);
  const update = (next: WorkspaceDraft, searching: boolean) => {
    setDraft(next);
    setEdited(true);
    setSearchOpen(searching);
    setHighlight(0);
    setError('');
    setCopied(false);
  };
  const select = (choice: WorkspaceLinkChoice) => {
    update(
      'href' in choice
        ? { href: choice.href }
        : { folderPath: choice.folderPath },
      false,
    );
    inputRef.current?.focus();
    setSearchOpen(false);
  };
  const copyAddress = async (href: string) => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setError('');
    } catch {
      setError(zh ? '无法复制链接地址。' : 'Could not copy the link address.');
    }
  };
  const stale = zh
    ? '编辑位置已变化，请关闭弹窗后重试。'
    : 'The edit target changed. Close this dialog and try again.';
  const run = async (commit: () => Promise<ActionResult>) => {
    if (saving.current || !isActive()) return;
    if (!request.isCurrent()) {
      setError(stale);
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await commit();
      if (!isActive()) return;
      if ('code' in result)
        setError(
          result.code === 'stale-context'
            ? stale
            : (result.message ?? result.code),
        );
      else onClose('saved');
    } catch (cause) {
      if (isActive())
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saving.current = false;
      if (isActive()) setBusy(false);
    }
  };
  const save = () => {
    if (!valid) return;
    void run(async () => {
      const resolved =
        selected && 'folderPath' in selected
          ? await createFolderLink?.(selected.folderPath)
          : actualHref;
      if (!isActive() || !request.isCurrent())
        return { status: 'cancelled', code: 'stale-context' };
      if (removing) return request.commit(null, undefined, signal);
      if (!resolved) return { status: 'rejected', code: 'missing-link' };
      return request.commit(
        resolved,
        request.canInsertText ? selected?.title || resolved : undefined,
        signal,
      );
    });
  };
  return (
    <VmDialog
      title={zh ? '编辑链接' : 'Edit link'}
      className="workspace-link-editor"
      restoreFocus={false}
      data-link-editor=""
      closeLabel={zh ? '关闭' : 'Close'}
      busy={busy}
      onClose={() => onClose('cancelled')}
      onKeyDown={(event) => event.stopPropagation()}
      footer={
        <>
          <WorkspaceButton disabled={busy} onClick={() => onClose('cancelled')}>
            {zh ? '取消' : 'Cancel'}
          </WorkspaceButton>
          <WorkspaceButton
            form={formId}
            type="submit"
            intent="primary"
            busy={busy}
            disabled={busy || !valid}
          >
            {zh ? '保存' : 'Save'}
          </WorkspaceButton>
        </>
      }
    >
      <form
        id={formId}
        className="workspace-link-fields"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <WorkspaceInput
          ref={inputRef}
          role="combobox"
          aria-label={
            zh ? '搜索工作区或输入网址' : 'Search workspace or enter a URL'
          }
          aria-autocomplete="list"
          aria-expanded={searching}
          aria-controls={searching ? listId : undefined}
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
          }
          autoComplete="off"
          value={display}
          placeholder={
            request.mixed
              ? zh
                ? '多个链接'
                : 'Multiple links'
              : zh
                ? '搜索工作区或输入网址'
                : 'Search workspace or enter a URL'
          }
          disabled={busy}
          onChange={(event) => update({ href: event.target.value }, true)}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text/plain').trim();
            if (
              parseExternalLink(text) ||
              parseWorkspaceLink(text, request.sourceFileId)
            ) {
              event.preventDefault();
              update({ href: text }, false);
            }
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setSearchOpen(false)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) {
              if (event.key === 'Enter') event.preventDefault();
              return;
            }
            if (event.key === 'Escape' && searching) {
              event.preventDefault();
              setSearchOpen(false);
            } else if (event.key === 'Enter' && searching) {
              event.preventDefault();
              if (activeIndex >= 0) select(results[activeIndex].choice);
            } else if (
              (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
              !selected &&
              !internal &&
              !external &&
              !!address &&
              choices
            ) {
              event.preventDefault();
              if (!searching) {
                setSearchOpen(true);
                setHighlight(0);
              } else if (results.length) {
                const next =
                  (activeIndex +
                    (event.key === 'ArrowDown' ? 1 : -1) +
                    results.length) %
                  results.length;
                setHighlight(next);
                document
                  .getElementById(`${listId}-${next}`)
                  ?.scrollIntoView?.({ block: 'nearest' });
              }
            }
          }}
        />
        {searching && (
          <div className="workspace-link-results">
            <ul
              role="listbox"
              id={listId}
              aria-label={zh ? '工作区搜索结果' : 'Workspace results'}
            >
              {results.map(({ choice, kind, location }, index) => (
                <li
                  role="option"
                  key={choiceKey(choice)}
                  id={`${listId}-${index}`}
                  aria-selected={index === activeIndex}
                  onPointerMove={() => setHighlight(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(choice)}
                >
                  <strong>{choice.title}</strong>
                  <span>
                    {kind} · {location}
                  </span>
                </li>
              ))}
            </ul>
            {!results.length && (
              <p role="status">
                {zh ? '没有匹配的目标' : 'No matching targets'}
              </p>
            )}
          </div>
        )}
        {selected && (
          <p className="workspace-link-location">
            {targetKinds[choiceKind(selected)][zh ? 0 : 1]} ·{' '}
            {selected.path ?? selected.detail}
          </p>
        )}
        {missing && (
          <p role="status">{zh ? '目标已失效' : 'Target unavailable'}</p>
        )}
        {removing && (
          <p role="status">
            {zh ? '保存后将移除链接' : 'Saving will remove the link'}
          </p>
        )}
        {(copyHref || selected) && (
          <div className="workspace-link-row">
            <WorkspaceButton
              disabled={busy || !copyHref}
              onClick={() => copyHref && void copyAddress(copyHref)}
            >
              <Copy strokeWidth={1.75} size={14} aria-hidden />
              {zh ? '复制' : 'Copy'}
            </WorkspaceButton>
            <WorkspaceButton
              disabled={busy || !previewAddress || !preview}
              onClick={() =>
                previewAddress &&
                preview?.(previewAddress, request.sourceFileId)
              }
            >
              <Eye strokeWidth={1.75} size={14} aria-hidden />
              {zh ? '预览' : 'Preview'}
            </WorkspaceButton>
            {copied && <span role="status">{zh ? '已复制' : 'Copied'}</span>}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </form>
    </VmDialog>
  );
}
