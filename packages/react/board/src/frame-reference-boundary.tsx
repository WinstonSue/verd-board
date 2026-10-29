import { Component, type ReactNode } from 'react';

/** A broken embedded renderer replaces only its own reference surface. */
export class FrameReferenceBoundary extends Component<
  {
    children: ReactNode;
    revision: unknown;
    language: string;
    onOpen(): void;
    bounds?: { x: number; y: number; width: number; height: number };
  },
  { error: Error | null; revision: unknown }
> {
  override state = {
    error: null as Error | null,
    revision: this.props.revision,
  };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(
    props: { revision: unknown },
    state: { revision: unknown },
  ) {
    return props.revision !== state.revision
      ? { error: null, revision: props.revision }
      : null;
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const en = this.props.language === 'en';
    const content = (
      <div
        role="alert"
        data-reference-error
        style={{
          padding: 12,
          height: '100%',
          overflow: 'auto',
          boxSizing: 'border-box',
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <p>{en ? 'Unable to display this reference' : '此引用暂时无法显示'}</p>
        <details>
          <summary>{en ? 'Error details' : '错误详情'}</summary>
          {this.state.error.message}
        </details>
        <button type="button" onClick={() => this.setState({ error: null })}>
          {en ? 'Retry' : '重试'}
        </button>
        <button type="button" onClick={this.props.onOpen}>
          {en ? 'Open source' : '打开原图'}
        </button>
      </div>
    );
    return this.props.bounds ? (
      <foreignObject {...this.props.bounds}>{content}</foreignObject>
    ) : (
      content
    );
  }
}
