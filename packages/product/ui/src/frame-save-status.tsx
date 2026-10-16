import { useI18n } from './i18n';

export function FrameSaveStatus({
  status = 'idle',
  lastSavedAt,
  onRetrySave,
}: {
  status?: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt?: number;
  onRetrySave?(): void;
}) {
  const { t, language } = useI18n();
  const date =
    typeof lastSavedAt === 'number' && lastSavedAt > 0
      ? new Date(lastSavedAt)
      : undefined;
  const saved = date && !Number.isNaN(date.getTime()) ? date : undefined;
  const now = new Date();
  const today = saved?.toDateString() === now.toDateString();
  const locale = language === 'zh' ? 'zh-CN' : 'en-GB';
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  };
  const fullOptions: Intl.DateTimeFormatOptions = {
    ...timeOptions,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  const time = saved?.toLocaleString(locale, today ? timeOptions : fullOptions);
  const label = status === 'idle' ? t('save.unsaved') : t(`save.${status}`);
  return (
    <>
      <span
        role="status"
        className="frame-save-status"
        data-testid="save-status"
        data-save-state={status}
        title={
          saved
            ? `${t('save.lastSaved')}: ${saved.toLocaleString(locale, fullOptions)}`
            : undefined
        }
      >
        {label}
        {time
          ? ` · ${time}`
          : status === 'saved'
            ? ` · ${t('save.unknownTime')}`
            : ''}
      </span>
      {status === 'error' && onRetrySave && (
        <button onClick={onRetrySave}>{t('save.retry')}</button>
      )}
    </>
  );
}
