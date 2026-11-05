import { ConfigProvider, Tooltip, theme } from '@sue/design-web-react';
import { CaseSensitive, ChevronDown, ChevronUp, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import {
  WorkspaceAlert,
  WorkspaceButton,
  WorkspaceInput,
} from './workspace-design';
import './find-bar.scss';

export interface FindBarProps {
  locale: 'zh' | 'en';
  label: string;
  className?: string;
  placement: 'floating' | 'inline';
  query: string;
  matchCase: boolean;
  index: number;
  count: number;
  unit: 'cells' | 'text';
  inputRef: RefObject<HTMLInputElement | null>;
  onQuery(query: string): void;
  onMatchCase(value: boolean): void;
  onStep(delta: number): void;
  onClose(): void;
  replace?: {
    open: boolean;
    value: string;
    busy: boolean;
    canReplace: boolean;
    canReplaceAll: boolean;
    error?: string;
    onToggle(): void;
    onChange(value: string): void;
    onReplace(): void;
    onReplaceAll(): void;
  };
}

/** Shared view only; the owning canvas/document supplies the search results. */
export function FindBar({
  locale,
  label,
  className = '',
  placement,
  query,
  matchCase,
  index,
  count,
  unit,
  inputRef,
  onQuery,
  onMatchCase,
  onStep,
  onClose,
  replace,
}: FindBarProps) {
  const zh = locale === 'zh';
  const { token } = theme.useToken();
  const [draft, setDraft] = useState(query);
  const composing = useRef(false);
  useEffect(() => {
    if (!composing.current) setDraft(query);
  }, [query]);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [inputRef]);
  const counter = count ? `${index + 1}/${count}` : '0/0';
  const countLabel = zh
    ? `${count ? index + 1 : 0} / ${count} ${unit === 'cells' ? '个匹配图元' : '处文字匹配'}`
    : `${count ? index + 1 : 0} of ${count} matching ${unit === 'cells' ? 'elements' : 'text occurrences'}`;
  const keyDown = (event: KeyboardEvent) => {
    // Keep editing shortcuts and single-letter canvas tools out of the find UI.
    event.stopPropagation();
    if (
      composing.current ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    )
      return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === 'h' &&
      replace
    ) {
      event.preventDefault();
      if (!replace.open) replace.onToggle();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };
  const iconButton = (
    title: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <Tooltip title={title}>
      <WorkspaceButton
        intent="ghost"
        size="small"
        icon={icon}
        aria-label={title}
        disabled={disabled}
        onClick={onClick}
      />
    </Tooltip>
  );
  return (
    <ConfigProvider
      componentSize="small"
      theme={{ token: { controlHeightSM: 28 } }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Scope shortcuts from the interactive search controls. */}
      <div
        role="search"
        aria-label={label}
        className={`find-bar find-bar--${placement} ${className}${replace?.open ? ' find-bar--replace' : ''}`}
        style={
          {
            '--find-gap': `${token.marginXXS}px`,
            '--find-radius': `${token.borderRadius}px`,
            '--find-background': token.colorBgContainer,
            '--find-border': token.colorBorder,
            '--find-shadow': token.boxShadowSecondary,
            '--find-text-secondary': token.colorTextSecondary,
          } as React.CSSProperties
        }
        onKeyDown={keyDown}
      >
        <div className="find-bar__row">
          <WorkspaceInput
            ref={inputRef}
            className="find-bar__query"
            aria-label={zh ? '查找' : 'Find'}
            placeholder={zh ? '查找…' : 'Find…'}
            value={draft}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              setDraft(event.currentTarget.value);
              onQuery(event.currentTarget.value);
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              if (!composing.current) onQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (
                composing.current ||
                event.nativeEvent.isComposing ||
                event.keyCode === 229
              )
                return;
              if (event.key === 'Enter') {
                event.preventDefault();
                if (count) onStep(event.shiftKey ? -1 : 1);
              }
            }}
          />
          <div className="find-bar__controls">
            <Tooltip title={zh ? '区分大小写' : 'Match case'}>
              <WorkspaceButton
                size="small"
                intent="ghost"
                variant={matchCase ? 'filled' : 'text'}
                icon={
                  <CaseSensitive size={16} strokeWidth={1.75} aria-hidden />
                }
                aria-label={zh ? '区分大小写' : 'Match case'}
                aria-pressed={matchCase}
                onClick={() => onMatchCase(!matchCase)}
              />
            </Tooltip>
            <span
              className="find-bar__count doc-findbar__count"
              role="status"
              aria-live="polite"
              aria-label={countLabel}
              title={countLabel}
            >
              {counter}
            </span>
            {iconButton(
              zh ? '上一个' : 'Previous',
              <ChevronUp size={16} strokeWidth={1.75} aria-hidden />,
              () => onStep(-1),
              !count,
            )}
            {iconButton(
              zh ? '下一个' : 'Next',
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden />,
              () => onStep(1),
              !count,
            )}
            {replace && (
              <WorkspaceButton
                size="small"
                intent="ghost"
                aria-expanded={replace.open}
                disabled={replace.busy}
                onClick={replace.onToggle}
              >
                {zh ? '替换' : 'Replace'}
              </WorkspaceButton>
            )}
            {iconButton(
              zh ? '关闭查找' : 'Close find',
              <X size={16} strokeWidth={1.75} aria-hidden />,
              onClose,
            )}
          </div>
        </div>
        {replace?.open && (
          <div className="find-bar__replacement">
            <div className="find-bar__row find-bar__replace-row">
              <WorkspaceInput
                className="find-bar__query"
                aria-label={zh ? '替换为…' : 'Replace with…'}
                placeholder={zh ? '替换为…' : 'Replace with…'}
                value={replace.value}
                disabled={replace.busy}
                onChange={(event) => replace.onChange(event.target.value)}
              />
              <WorkspaceButton
                size="small"
                intent="ghost"
                disabled={replace.busy || !replace.canReplace}
                onClick={replace.onReplace}
              >
                {zh ? '替换当前' : 'Replace current'}
              </WorkspaceButton>
              <WorkspaceButton
                size="small"
                intent="ghost"
                disabled={replace.busy || !replace.canReplaceAll}
                busy={replace.busy}
                onClick={replace.onReplaceAll}
              >
                {zh ? '全部替换' : 'Replace all'}
              </WorkspaceButton>
            </div>
            {replace.error && (
              <WorkspaceAlert type="error" title={replace.error} role="alert" />
            )}
          </div>
        )}
      </div>
    </ConfigProvider>
  );
}
