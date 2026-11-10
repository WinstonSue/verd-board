/* eslint-disable jsx-a11y/media-has-caption -- Preview original local media; transcription and caption authoring are outside this feature. */
import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import type { DocumentAttachment } from '@sue/board-react-text';
const PdfReader = lazy(() => import('./pdf-reader'));
export function WebResource({
  url,
  title,
  preview,
  caption,
  width = 640,
  height = 400,
}: {
  url: string;
  title: string;
  caption?: string;
  width?: number;
  height?: number;
  preview: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!open) return;
    setWaiting(true);
    const id = setTimeout(() => setWaiting(false), 8000);
    return () => clearTimeout(id);
  }, [open, url]);
  let valid = false;
  try {
    const parsed = new URL(url);
    valid =
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      parsed.origin !== location.origin;
  } catch {
    /* Card remains readable for malformed imported data. */
  }
  return (
    <section className="workspace-resource-card">
      <strong>{title || url}</strong>
      <div>{url}</div>
      {caption && <p>{caption}</p>}
      {valid && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            const api = (
              window as unknown as {
                electronAPI?: { openExternal?(url: string): void };
              }
            ).electronAPI;
            if (api?.openExternal) {
              event.preventDefault();
              api.openExternal(url);
            }
          }}
        >
          外部打开
        </a>
      )}
      {!preview && valid && (
        <button type="button" onClick={() => setOpen(!open)}>
          {open ? '收起' : '加载网页'}
        </button>
      )}
      {open && !preview && (
        <>
          {waiting && (
            <p role="status">
              正在加载，页面可能禁止嵌入或需要登录；可随时外部打开。
            </p>
          )}
          <iframe
            title={title || url}
            src={url}
            sandbox="allow-scripts allow-forms allow-same-origin"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; clipboard-read 'none'; clipboard-write 'none'; usb 'none'; serial 'none';"
            style={{ width, maxWidth: '100%', height, border: 0 }}
          />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setTimeout(() => setOpen(true), 0);
            }}
          >
            重试
          </button>
        </>
      )}
    </section>
  );
}
export function AttachmentCard({
  value,
  onOpen,
}: {
  value: DocumentAttachment;
  onOpen(): void;
}) {
  return (
    <section className="workspace-resource-card">
      <strong>{value.name}</strong>
      <div>
        {value.mime} · {(value.size / 1024).toFixed(1)} KiB
      </div>
      {value.caption && <p>{value.caption}</p>}
      <button type="button" onClick={onOpen}>
        打开资料
      </button>
    </section>
  );
}
export function ResourceReader({
  value,
  page,
  resolve,
  onClose,
}: {
  value: DocumentAttachment;
  page?: number;
  resolve(src: string): Promise<string>;
  onClose(): void;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      if (active?.isConnected) active.focus();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    let owned = '';
    void resolve(value.src).then(
      (next) => {
        if (alive) {
          owned = next;
          setUrl(next);
        } else if (next.startsWith('blob:')) URL.revokeObjectURL(next);
      },
      (e) => {
        if (alive) setError(String(e));
      },
    );
    return () => {
      alive = false;
      if (owned.startsWith('blob:')) URL.revokeObjectURL(owned);
    };
  }, [resolve, value.src]);
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-modal="true"
      aria-label={value.name}
      className="workspace-resource-reader"
      style={{
        position: 'fixed',
        inset: 24,
        zIndex: 10000,
        background: 'Canvas',
        color: 'CanvasText',
        border: '1px solid',
        padding: 20,
        overflow: 'auto',
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <strong>{value.name}</strong>
        <button type="button" onClick={onClose}>
          关闭
        </button>
        {url && (
          <a href={url} download={value.name}>
            下载原件
          </a>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      {url &&
        (value.mime === 'application/pdf' ||
        value.name.toLowerCase().endsWith('.pdf') ? (
          <Suspense fallback={<p>正在加载 PDF…</p>}>
            <PdfReader url={url} value={value} initialPage={page} />
          </Suspense>
        ) : value.mime.startsWith('image/') ? (
          <img
            src={url}
            alt={value.name}
            style={{
              maxWidth: '100%',
              maxHeight: '80vh',
              objectFit: 'contain',
            }}
            onError={() => setError('无法预览此图片，请下载原件')}
          />
        ) : value.mime.startsWith('audio/') ? (
          <audio
            controls
            preload="metadata"
            src={url}
            onError={() => setError('无法播放此格式，请下载原件')}
          />
        ) : value.mime.startsWith('video/') ? (
          <video
            controls
            preload="metadata"
            src={url}
            style={{ maxWidth: '100%' }}
            onError={() => setError('无法播放此格式，请下载原件')}
          />
        ) : (
          <p>此文件可下载后使用相应应用打开。</p>
        ))}
    </dialog>
  );
}
