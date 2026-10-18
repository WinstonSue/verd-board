import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n';
import { MyPage } from './my-page';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function () {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function () {
  this.open = false;
};

it('shows personal preferences without workspace trash and returns to the caller', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onBack = vi.fn();
  await act(async () =>
    root.render(
      <I18nProvider defaultLanguage="zh" persistLanguage={false}>
        <MyPage onBack={onBack} />
      </I18nProvider>,
    ),
  );
  expect(
    container.querySelector('[data-testid="settings-language"]'),
  ).toBeTruthy();
  expect(container.querySelector('[data-testid="workspace-trash"]')).toBeNull();
  expect(container.querySelectorAll('nav button')).toHaveLength(1);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[data-testid="my-back"]')!
      .click(),
  );
  expect(onBack).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  container.remove();
});
