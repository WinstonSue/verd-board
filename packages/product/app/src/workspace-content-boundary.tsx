import { Disclosure, SettingsActions } from '@sue/verd-board-ui';
import { Component, useState, type ReactNode } from 'react';

export function WorkspaceFileError({
  path,
  message,
  locale = 'zh',
  onRetry,
  onClose,
}: {
  path?: string;
  message: string;
  locale?: 'zh' | 'en';
  onRetry?(): void | Promise<void>;
  onClose?(): void;
}) {
  const [pending, setPending] = useState(false);
  const [retryError, setRetryError] = useState('');
  const en = locale === 'en';
  return (
    <section
      role="alert"
      data-testid="workspace-file-error"
      className="workspace-error-card"
    >
      <h3>{en ? 'Unable to display this file' : '此文件暂时无法显示'}</h3>
      {path && <p>{path}</p>}
      <p>{message.split(/[\n;]/, 1)[0]}</p>
      <p>
        {en
          ? 'Other workspace files remain available. Retry after fixing the source file.'
          : '其他文件仍可使用。源文件修复后可以重试。'}
      </p>
      <Disclosure label={en ? 'Error details' : '错误详情'}>
        <pre>{message}</pre>
      </Disclosure>
      {retryError && <p>{retryError}</p>}
      <SettingsActions>
        {onRetry && (
          <button
            type="button"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setRetryError('');
              try {
                await onRetry();
              } catch (error) {
                setRetryError(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? (en ? 'Retrying…' : '正在重试…') : en ? 'Retry' : '重试'}
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose}>
            {en ? 'Close' : '关闭'}
          </button>
        )}
      </SettingsActions>
    </section>
  );
}

interface Props {
  children: ReactNode;
  resetKeys: readonly unknown[];
  path?: string;
  locale?: 'zh' | 'en';
  onRetry?(): void | Promise<void>;
  onClose?(): void;
  pane?: boolean;
  active?: boolean;
}

/** A renderer failure must never unmount the workspace chrome or sibling files. */
export class WorkspaceContentBoundary extends Component<
  Props,
  { error: Error | null; keys: readonly unknown[] }
> {
  override state = { error: null as Error | null, keys: this.props.resetKeys };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(
    props: Props,
    state: { keys: readonly unknown[] },
  ) {
    if (
      props.resetKeys.length !== state.keys.length ||
      props.resetKeys.some((key, index) => !Object.is(key, state.keys[index]))
    )
      return { error: null, keys: props.resetKeys };
    return null;
  }

  override render() {
    const fallback = this.state.error ? (
      <WorkspaceFileError
        path={this.props.path}
        message={this.state.error.message}
        locale={this.props.locale}
        onClose={this.props.onClose}
        onRetry={async () => {
          await this.props.onRetry?.();
          this.setState({ error: null });
        }}
      />
    ) : null;
    return this.state.error ? (
      this.props.pane ? (
        <div
          className={`workspace-pane${this.props.active ? ' is-active' : ''}`}
        >
          {fallback}
        </div>
      ) : (
        fallback
      )
    ) : (
      this.props.children
    );
  }
}
