import { useEffect, useRef, useState } from 'react';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameRenderExtension,
} from '@sue/board-react';
import type { CellRegistry, FrameSnapshot } from '@sue/board-core';
import { materializeWorkflowPositions } from '@sue/board-workflow';
import { materializeArchitecturePositions } from '@sue/board-architecture';
import { useI18n } from './i18n';

interface FrameImportDialogProps {
  registry: CellRegistry;
  extensions: FrameRenderExtension[];
  scene?:
    | 'whiteboard'
    | 'workflow'
    | 'architecture'
    | 'mind'
    | 'uml-class'
    | 'uml-sequence';
  onImport(snapshot: FrameSnapshot): Promise<void>;
  onClose(): void;
}
export function FrameImportDialog({
  registry,
  extensions,
  scene = 'whiteboard',
  onImport,
  onClose,
}: FrameImportDialogProps) {
  const { language } = useI18n();
  const zh = language === 'zh';
  const [format, setFormat] = useState<'markdown' | 'mermaid'>(
    scene === 'mind' ? 'markdown' : 'mermaid',
  );
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<FrameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<FrameCanvasController>(null);
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.focus();
  }, []);
  useEffect(() => {
    let current = true;
    setPreview(null);
    setError(null);
    setPending(!!text.trim());
    const timer = setTimeout(async () => {
      if (!text.trim()) return;
      try {
        const snapshot =
          format === 'markdown'
            ? (
                await import('@sue/board-markdown-to-board')
              ).parseMarkdownToFrameSnapshot(text)
            : await (
                await import('@sue/board-mermaid-to-board')
              ).parseMermaidToFrameSnapshot(text, {
                scene:
                  scene === 'workflow' ||
                  scene === 'architecture' ||
                  scene === 'uml-class' ||
                  scene === 'uml-sequence'
                    ? scene
                    : 'whiteboard',
              });
        if (current) {
          setPreview({
            store: materializeArchitecturePositions(
              materializeWorkflowPositions(snapshot.store),
            ),
          });
          setPending(false);
        }
      } catch (failure) {
        if (current) {
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
          setPending(false);
        }
      }
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [format, text, scene]);
  useEffect(() => {
    if (preview) requestAnimationFrame(() => controller.current?.fit());
  }, [preview]);
  const insert = async () => {
    if (!preview || pending) return;
    setPending(true);
    try {
      await onImport(preview);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setPending(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="frame-import-dialog"
      aria-label={zh ? '文本导入' : 'Import text'}
      onCancel={onClose}
    >
      <header>
        <h2>{zh ? '文本导入' : 'Import text'}</h2>
        <button onClick={onClose}>{zh ? '关闭' : 'Close'}</button>
      </header>
      <label>
        {zh ? '格式' : 'Format'}
        <select
          aria-label={zh ? '导入格式' : 'Import format'}
          value={format}
          onChange={(event) => setFormat(event.target.value as typeof format)}
        >
          <option value="mermaid">Mermaid</option>
          <option value="markdown">Markdown</option>
        </select>
      </label>
      <div className="frame-import-body">
        <textarea
          ref={input}
          aria-label={zh ? '源文本' : 'Source text'}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            format === 'markdown'
              ? '# Center\n## Topic'
              : 'flowchart LR\nA[Start] --> B[Task]'
          }
        />
        <div
          className="frame-import-preview"
          aria-label={zh ? '导入预览' : 'Import preview'}
        >
          {preview && (
            <FrameCanvas
              ref={controller}
              value={preview}
              registry={registry}
              extensions={extensions}
              readonly
            />
          )}
          {pending && (
            <span role="status">{zh ? '处理中…' : 'Processing…'}</span>
          )}
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <footer>
        <button disabled={!preview || pending} onClick={() => void insert()}>
          {zh ? '插入' : 'Insert'}
        </button>
      </footer>
    </dialog>
  );
}
