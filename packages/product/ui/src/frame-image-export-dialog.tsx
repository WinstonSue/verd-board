import { useEffect, useRef, useState } from 'react';
import type { FrameImageOptions } from '@sue/board-react';
import { useI18n } from './i18n';
export function FrameImageExportDialog({
  hasSelection,
  themeBackground,
  onExport,
  onClose,
}: {
  hasSelection: boolean;
  themeBackground: string;
  onExport(options: FrameImageOptions): Promise<void>;
  onClose(): void;
}) {
  const { language } = useI18n(),
    zh = language === 'zh';
  const dialog = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<'svg' | 'png' | 'jpeg'>('png');
  const [scope, setScope] = useState(hasSelection ? 'selection' : 'frame');
  const [ratio, setRatio] = useState(4),
    [padding, setPadding] = useState(20);
  const [background, setBackground] = useState('transparent'),
    [custom, setCustom] = useState('#ffffff');
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string>();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const submit = async () => {
    setPending(true);
    setError(undefined);
    try {
      await onExport({
        format,
        ratio,
        padding,
        background:
          background === 'theme'
            ? themeBackground
            : background === 'custom'
              ? custom
              : background,
        ...(scope === 'frame' ? { ids: [] } : {}),
      });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      aria-label={zh ? '图像导出' : 'Export image'}
      className="frame-image-export-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <h2>{zh ? '图像导出' : 'Export image'}</h2>
      <fieldset disabled={pending}>
        <label>
          {zh ? '格式' : 'Format'}
          <select
            aria-label="Image format"
            value={format}
            onChange={(event) => {
              const next = event.target.value as typeof format;
              setFormat(next);
              setBackground(next === 'jpeg' ? '#ffffff' : 'transparent');
            }}
          >
            <option value="svg">SVG</option>
            <option value="png">PNG</option>
            <option value="jpeg">JPG</option>
          </select>
        </label>
        <label>
          {zh ? '范围' : 'Scope'}
          <select
            aria-label="Image scope"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="frame">{zh ? '整个画布' : 'Whole frame'}</option>
            <option value="selection" disabled={!hasSelection}>
              {zh ? '选中内容' : 'Selection'}
            </option>
          </select>
        </label>
        {format !== 'svg' && (
          <label>
            {zh ? '分辨率' : 'Resolution'}
            <select
              aria-label="Image scale"
              value={ratio}
              onChange={(event) => setRatio(Number(event.target.value))}
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {zh ? '边距' : 'Padding'}
          <input
            aria-label="Image padding"
            type="number"
            min={0}
            max={500}
            value={padding}
            onChange={(event) => setPadding(Number(event.target.value))}
          />
        </label>
        <label>
          {zh ? '背景' : 'Background'}
          <select
            aria-label="Image background"
            value={background}
            onChange={(event) => setBackground(event.target.value)}
          >
            <option value="transparent" disabled={format === 'jpeg'}>
              {zh ? '透明' : 'Transparent'}
            </option>
            <option value="#ffffff">{zh ? '白色' : 'White'}</option>
            <option value="theme">
              {zh ? '画布背景' : 'Frame background'}
            </option>
            <option value="custom">{zh ? '自定义' : 'Custom'}</option>
          </select>
        </label>
        {background === 'custom' && (
          <input
            type="color"
            aria-label="Export background color"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 16,
        }}
      >
        <button disabled={pending} onClick={onClose}>
          {zh ? '取消' : 'Cancel'}
        </button>
        <button
          data-testid="image-export-button"
          disabled={pending || !Number.isFinite(padding) || padding < 0}
          onClick={() => void submit()}
        >
          {pending
            ? zh
              ? '导出中…'
              : 'Exporting…'
            : zh
              ? '导出图像'
              : 'Export image'}
        </button>
      </div>
    </dialog>
  );
}
