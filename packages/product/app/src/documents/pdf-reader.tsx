import { useEffect, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createAssetLink } from '@sue/board-common';
import type { DocumentAttachment } from '@sue/board-react-text';
import 'pdfjs-dist/web/pdf_viewer.css';
async function readPdfText(
  page: PDFPageProxy,
): Promise<Awaited<ReturnType<PDFPageProxy['getTextContent']>>> {
  const reader = page.streamTextContent().getReader();
  const result: Awaited<ReturnType<PDFPageProxy['getTextContent']>> = {
    items: [],
    styles: Object.create(null),
    lang: null,
  };
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const value = next.value;
      result.items.push(...value.items);
      Object.assign(result.styles, value.styles);
      result.lang ??= value.lang;
    }
  } finally {
    reader.releaseLock();
  }
  return result;
}
export default function PdfReader({
  url,
  value,
  initialPage = 1,
}: {
  url: string;
  value: DocumentAttachment;
  initialPage?: number;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(initialPage);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState('');
  const [passwordRequest, setPasswordRequest] = useState<{
    submit(password: string): void;
    cancel(): void;
  } | null>(null);
  const [password, setPassword] = useState('');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<number[]>([]);
  const [outline, setOutline] = useState<{ title: string; page: number }[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const bridge = (
      window as unknown as {
        electronAPI?: {
          readBundledPdfAsset?(kind: string, name: string): Promise<Uint8Array>;
        };
      }
    ).electronAPI?.readBundledPdfAsset;
    let loading: PDFDocumentLoadingTask | undefined;
    let ownedWorker = '';
    void (async () => {
      if (bridge) {
        const bytes = await bridge('worker', 'pdf.worker.min.mjs');
        if (!alive) return;
        ownedWorker = URL.createObjectURL(
          new Blob([bytes as BlobPart], { type: 'text/javascript' }),
        );
        GlobalWorkerOptions.workerSrc = ownedWorker;
      } else {
        GlobalWorkerOptions.workerSrc = new URL(
          'pdf-assets/pdf.worker.min.mjs',
          document.baseURI,
        ).href;
      }
      if (!alive) return;
      loading = getDocument({
        url,
        useWorkerFetch: false,
        enableXfa: false,
        BinaryDataFactory: class {
          async fetch({ kind, filename }: { kind: string; filename: string }) {
            if (bridge) return new Uint8Array(await bridge(kind, filename));
            const folders: Record<string, string> = {
              cMapUrl: 'cmaps',
              standardFontDataUrl: 'standard_fonts',
              wasmUrl: 'wasm',
            };
            const response = await fetch(
              new URL(
                `pdf-assets/${folders[kind]}/${filename}`,
                document.baseURI,
              ),
            );
            if (!response.ok) throw new Error('Missing PDF resource');
            return new Uint8Array(await response.arrayBuffer());
          }
        },
      });
      loading.onPassword = (
        update: (password: string) => void,
        reason: number,
      ) => {
        if (!alive) return;
        setError(reason === 2 ? '密码错误，请重试' : '');
        setPassword('');
        setPasswordRequest({
          submit: update,
          cancel: () => {
            setError('已取消密码输入，可下载原件');
            void loading?.destroy();
          },
        });
      };
      void loading.promise
        .then(async (next) => {
          if (!alive) return;
          setPdf(next);
          if (initialPage > next.numPages)
            setError(`页码 ${initialPage} 超出范围，共 ${next.numPages} 页`);
          const entries = await next.getOutline();
          const result: { title: string; page: number }[] = [];
          const visit = async (
            items: NonNullable<typeof entries>,
            depth = 0,
          ) => {
            for (const entry of items) {
              const dest =
                typeof entry.dest === 'string'
                  ? await next.getDestination(entry.dest)
                  : entry.dest;
              if (dest?.[0] !== undefined)
                result.push({
                  title: `${'　'.repeat(depth)}${entry.title}`,
                  page:
                    typeof dest[0] === 'number'
                      ? dest[0] + 1
                      : (await next.getPageIndex(dest[0])) + 1,
                });
              await visit(entry.items, depth + 1);
            }
          };
          await visit(entries ?? []);
          if (alive) setOutline(result);
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    })().catch((e) => {
      if (alive) setError(String(e));
    });
    return () => {
      alive = false;
      const destroyed = loading?.destroy();
      void Promise.resolve(destroyed).finally(() => {
        if (ownedWorker) URL.revokeObjectURL(ownedWorker);
      });
    };
  }, [url, initialPage]);
  useEffect(() => {
    if (!pdf || page < 1 || page > pdf.numPages) return;
    let cancelled = false;
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>
      | undefined;
    let layer: TextLayer | undefined;
    void pdf
      .getPage(page)
      .then(async (current) => {
        if (cancelled || !canvas.current || !text.current) return;
        const requested = current.getViewport({ scale });
        const viewport =
          requested.width * requested.height > 8000000
            ? current.getViewport({
                scale:
                  scale *
                  Math.sqrt(8000000 / (requested.width * requested.height)),
              })
            : requested;
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        text.current.replaceChildren();
        text.current.style.setProperty(
          '--scale-factor',
          String(viewport.scale),
        );
        task = current.render({ canvas: canvas.current, viewport });
        const content = await readPdfText(current);
        if (cancelled || !text.current) return;
        // Chromium 120 lacks ReadableStream async iteration. Keep the adapter
        // local to this stream rather than changing browser globals.
        const source = new ReadableStream({
          start(controller) {
            controller.enqueue(content);
            controller.close();
          },
        });
        Object.defineProperty(source, Symbol.asyncIterator, {
          value: async function* () {
            const reader = source.getReader();
            try {
              for (;;) {
                const next = await reader.read();
                if (next.done) break;
                yield next.value;
              }
            } finally {
              reader.releaseLock();
            }
          },
        });
        layer = new TextLayer({
          textContentSource: source,
          container: text.current,
          viewport,
        });
        await Promise.all([task.promise, layer.render()]);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [pdf, page, scale]);
  useEffect(() => {
    let cancelled = false;
    setMatches([]);
    if (!pdf || !query) return;
    void (async () => {
      const found: number[] = [];
      for (let i = 1; i <= pdf.numPages && !cancelled; i++) {
        const content = await readPdfText(await pdf.getPage(i));
        if (
          content.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ')
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase())
        )
          found.push(i);
      }
      if (!cancelled) setMatches(found);
    })().catch((e) => {
      if (!cancelled) setError(String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, query]);
  return (
    <section>
      {passwordRequest && (
        <div role="group" aria-label="PDF 密码">
          <label>
            PDF 密码
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              passwordRequest.submit(password);
              setPassword('');
              setPasswordRequest(null);
              setError('');
            }}
          >
            解锁
          </button>
          <button
            type="button"
            onClick={() => {
              passwordRequest.cancel();
              setPassword('');
              setPasswordRequest(null);
            }}
          >
            取消
          </button>
        </div>
      )}
      <nav>
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <label>
          页码
          <input
            type="number"
            min={1}
            max={pdf?.numPages}
            value={page}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 1 && n <= (pdf?.numPages ?? 1)) {
                setError('');
                setPage(n);
              }
            }}
          />
        </label>{' '}
        / {pdf?.numPages ?? '…'}
        <button
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
        <button onClick={() => setScale(Math.max(0.25, scale - 0.25))}>
          缩小
        </button>
        <button onClick={() => setScale(Math.min(4, scale + 0.25))}>
          放大
        </button>
        <button
          onClick={() => {
            void pdf
              ?.getPage(page)
              .then((p) =>
                setScale(
                  Math.min(
                    4,
                    (text.current?.parentElement?.clientWidth || 800) /
                      p.getViewport({ scale: 1 }).width,
                  ),
                ),
              );
          }}
        >
          适合宽度
        </button>
        <button
          onClick={() => {
            void pdf?.getPage(page).then((p) => {
              const v = p.getViewport({ scale: 1 });
              setScale(Math.min(1, 650 / v.height, 800 / v.width));
            });
          }}
        >
          适合整页
        </button>
        {value.src.startsWith('verd-asset:') && (
          <button
            onClick={() => {
              const assetId = value.src.split('/').pop()!;
              void navigator.clipboard
                .writeText(createAssetLink({ assetId, page }))
                .catch((e) => setError(String(e)));
            }}
          >
            复制页码引用
          </button>
        )}
      </nav>
      <label>
        PDF 内查找
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {matches.map((n) => (
        <button key={n} onClick={() => setPage(n)}>
          第 {n} 页
        </button>
      ))}
      {outline.length > 0 && (
        <details>
          <summary>目录</summary>
          {outline.map((item, i) => (
            <button key={i} onClick={() => setPage(item.page)}>
              {item.title}
            </button>
          ))}
        </details>
      )}
      {pdf && (
        <details>
          <summary>缩略图</summary>
          <PdfThumbnails pdf={pdf} onSelect={setPage} />
        </details>
      )}
      {error && <p role="alert">{error}</p>}
      <div
        style={{ position: 'relative', overflow: 'auto', maxHeight: '70vh' }}
      >
        <canvas ref={canvas} />
        <div ref={text} className="textLayer" />
      </div>
    </section>
  );
}
function PdfThumbnail({
  pdf,
  page,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  onSelect(): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>
      | undefined;
    void pdf
      .getPage(page)
      .then((current) => {
        if (cancelled || !canvas.current) return;
        const base = current.getViewport({ scale: 1 });
        const viewport = current.getViewport({ scale: 90 / base.width });
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        task = current.render({ canvas: canvas.current, viewport });
        return task.promise;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page]);
  return (
    <button type="button" onClick={onSelect} aria-label={`第 ${page} 页缩略图`}>
      <canvas ref={canvas} style={{ maxHeight: 90 }} />
      <span>{page}</span>
    </button>
  );
}
function PdfThumbnails({
  pdf,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  onSelect(page: number): void;
}) {
  const [start, setStart] = useState(0);
  return (
    <div
      style={{ height: 240, overflow: 'auto', position: 'relative' }}
      onScroll={(event) =>
        setStart(Math.floor(event.currentTarget.scrollTop / 120))
      }
    >
      <div style={{ height: pdf.numPages * 120, position: 'relative' }}>
        {Array.from(
          { length: Math.min(4, pdf.numPages - start) },
          (_, index) => start + index + 1,
        ).map((page) => (
          <div
            key={page}
            style={{ position: 'absolute', top: (page - 1) * 120, height: 120 }}
          >
            <PdfThumbnail
              pdf={pdf}
              page={page}
              onSelect={() => onSelect(page)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
