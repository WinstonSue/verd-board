import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { FrameImageExportDialog } from './frame-image-export-dialog';
import type { FrameImageOptions } from '@sue/board-react';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('exports a concrete appearance and its theme background, frozen before asynchronous rendering', async () => {
  const oldShow = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = vi.fn();
  const container = document.createElement('div'),
    root = createRoot(container);
  let complete!: () => void;
  const onExport = vi.fn(
    (_options: FrameImageOptions) =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const props = {
    hasSelection: false,
    onExport,
    onClose: vi.fn(),
    themeBackground: (mode: 'light' | 'dark') =>
      mode === 'light' ? '#fff' : '#141414',
  };
  const render = (appearance: 'light' | 'dark') =>
    act(async () =>
      root.render(
        <I18nProvider persistLanguage={false}>
          <FrameImageExportDialog {...props} appearance={appearance} />
        </I18nProvider>,
      ),
    );
  const choose = async (label: string, value: string) => {
    const select = container.querySelector(
      `[aria-label="${label}"]`,
    ) as HTMLSelectElement;
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  try {
    await render('dark');
    expect(
      (
        container.querySelector(
          '[aria-label="Image appearance"]',
        ) as HTMLSelectElement
      ).value,
    ).toBe('current');
    await choose('Image appearance', 'light');
    await choose('Image background', 'theme');
    await act(async () =>
      (
        container.querySelector(
          '[data-testid="image-export-button"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ appearance: 'light', background: '#fff' }),
    );
    await render('light');
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(container.querySelector('fieldset')!.disabled).toBe(true);
    await act(async () => complete());
    expect(props.onClose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    HTMLDialogElement.prototype.showModal = oldShow;
  }
});
