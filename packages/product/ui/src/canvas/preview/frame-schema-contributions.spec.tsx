import {
  createCellStore,
  createFrameCell,
  type FrameSnapshot,
} from '@sue/board-core';
import {
  createFramePluginSet,
  createFrameSettingsContribution,
  defineSettings,
  FrameEditor,
} from '@sue/board-react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { createVerdFramePlugins } from '../frame-plugins';
import { FrameProductShell } from '../frame-product-shell';
import { I18nProvider } from '../../i18n';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('renders the same registered settings definition in both editor surfaces', async () => {
  const definition = defineSettings<{ surface: string }>({
    fields: [{ key: 'surface', editor: 'text', label: 'Host surface' }],
  });
  const contribution = createFrameSettingsContribution({
    id: 'test.surface',
    definition,
    bind: (context) => ({
      values: { surface: context.surface ?? '' },
      identity: context.frameId,
      disabled: context.disabled,
      onCommit() {},
    }),
  });
  const plugins = [
    ...createVerdFramePlugins(),
    {
      id: 'test-settings',
      engine: { id: 'test-settings', install() {} },
      settingsPanels: [contribution],
    },
  ];
  const value: FrameSnapshot = {
    store: createCellStore(createFrameCell('root')),
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <I18nProvider defaultLanguage="en" persistLanguage={false}>
          <FrameProductShell
            value={value}
            frameId="root"
            pluginSet={createFramePluginSet(plugins)}
            mindMaxWidth={240}
            onChange={() => {}}
            onOpenFrame={() => {}}
          />
        </I18nProvider>,
      ),
    );
    expect(host.querySelectorAll('[aria-label="Host surface"]')).toHaveLength(
      1,
    );
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Host surface"]')!
        .value,
    ).toBe('product');
    await act(() =>
      root.render(
        <FrameEditor
          value={value}
          plugins={plugins}
          language="en"
          onChange={() => {}}
        />,
      ),
    );
    expect(host.querySelectorAll('[aria-label="Host surface"]')).toHaveLength(
      1,
    );
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Host surface"]')!
        .value,
    ).toBe('editor');
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
