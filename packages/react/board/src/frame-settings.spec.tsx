import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  ConfigPanel,
  defineSettings,
  FrameSettingsComponentsProvider,
  FrameSettingsControl,
  FrameSettingsText,
} from './frame-settings';
import type {
  ControlProps,
  SettingEditorProps,
} from '@sue/schema-settings-react';
import { createFramePluginSet, type FrameUIPlugin } from './frame-plugins';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('settings integration', () => {
  it('follows external history while retaining local drafts until cancel', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const onCommit = vi.fn();
    const render = (value: string) =>
      root.render(
        <FrameSettingsText
          field={{ key: 'name', label: 'Name' }}
          value={value}
          onCommit={onCommit}
        />,
      );
    try {
      await act(() => render('alpha'));
      const input = host.querySelector('input')!;
      await act(() => render('beta'));
      expect(host.querySelector('input')).toBe(input);
      expect(input.value).toBe('beta');
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'draft');
      await act(() =>
        input.dispatchEvent(new Event('input', { bubbles: true })),
      );
      await act(() => render('gamma'));
      expect(input.value).toBe('draft');
      await act(() =>
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      );
      expect(input.value).toBe('gamma');
      expect(onCommit).not.toHaveBeenCalled();
    } finally {
      await act(() => root.unmount());
    }
  });

  it('rejects duplicate panel identities across plugins and contribution kinds', () => {
    const plugin = (id: string): FrameUIPlugin => ({
      id,
      engine: { id, install() {} },
      propertyPanels: [{ id: 'shared', render: () => null }],
    });
    const second = {
      ...plugin('second'),
      propertyPanels: undefined,
      settingsPanels: [{ id: 'shared', render: () => null }],
    };
    expect(() => createFramePluginSet([plugin('first'), second])).toThrow(
      'settings panel id',
    );
  });
});

describe('host select components', () => {
  it('keeps native selects without a host component', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const commit = vi.fn();
    try {
      await act(() =>
        root.render(
          <FrameSettingsControl
            field={{
              key: 'choice',
              editor: 'select',
              props: {
                children: (
                  <>
                    <option value="a">Alpha</option>
                    <option value="b">Beta</option>
                  </>
                ),
              },
            }}
            value="a"
            onCommit={commit}
          />,
        ),
      );
      const select = host.querySelector('select')!;
      expect(select.value).toBe('a');
      await act(async () => {
        select.value = 'b';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(commit).toHaveBeenCalledExactlyOnceWith('b');
    } finally {
      await act(() => root.unmount());
    }
  });

  it('adapts fragments, implicit values, disabled groups and empty options, and restores rejected values', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    let editor!: SettingEditorProps<unknown, ControlProps['select']>;
    const commit = vi.fn(() => ({
      status: 'rejected',
      message: 'Host refused',
    }));
    const Probe = (props: typeof editor) => {
      editor = props;
      return (
        <button onClick={() => props.onCommit('Beta')}>
          {String(props.value)}
        </button>
      );
    };
    try {
      await act(() =>
        root.render(
          <FrameSettingsComponentsProvider components={{ select: Probe }}>
            <FrameSettingsControl
              field={{
                key: 'choice',
                editor: 'select',
                props: {
                  'aria-label': 'Choice',
                  'data-testid': 'choice',
                  children: (
                    <>
                      <option value="" disabled>
                        Choose
                      </option>
                      <>
                        <option value={1}>One</option>
                        <option>Beta</option>
                      </>
                      <optgroup label="Blocked" disabled>
                        <option value="blocked">Blocked</option>
                      </optgroup>
                    </>
                  ),
                },
              }}
              value="1"
              onCommit={commit}
            />
          </FrameSettingsComponentsProvider>,
        ),
      );
      expect(host.querySelector('select')).toBeNull();
      expect(editor.props.attributes).toMatchObject({
        'aria-label': 'Choice',
        'data-testid': 'choice',
      });
      expect(editor.options).toEqual([
        { value: '', label: 'Choose', disabled: true },
        { value: '1', label: 'One', disabled: false },
        { value: 'Beta', label: 'Beta', disabled: false },
        { value: 'blocked', label: 'Blocked', disabled: true },
      ]);
      await act(async () => host.querySelector('button')!.click());
      expect(commit).toHaveBeenCalledExactlyOnceWith('Beta');
      expect(editor.value).toBe('1');
      expect(host.textContent).toContain('Host refused');
    } finally {
      await act(() => root.unmount());
    }
  });

  it('inherits standard select editors, respects explicit overrides and blocks readonly mixed fields', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const commit = vi.fn();
    let editor!: SettingEditorProps<unknown, ControlProps['select']>;
    const Probe = (props: typeof editor) => {
      editor = props;
      return <button onClick={() => props.onCommit('b')}>Inherited</button>;
    };
    const definition = defineSettings<{ choice: string }>({
      fields: [
        {
          key: 'choice',
          editor: 'select',
          options: [{ value: 'a', label: 'Alpha' }],
        },
      ],
    });
    const panel = {
      definition,
      values: { choice: 'a' },
      identity: 'panel',
      onCommit: commit,
    };
    try {
      await act(() =>
        root.render(
          <FrameSettingsComponentsProvider components={{ select: Probe }}>
            <ConfigPanel {...panel} />
            <ConfigPanel
              {...panel}
              identity="local"
              components={{ select: () => <span>Local</span> }}
            />
            <FrameSettingsControl
              field={{
                key: 'readonly',
                editor: 'select',
                props: {
                  readOnly: true,
                  'data-mixed': true,
                  children: <option value="a">Alpha</option>,
                },
              }}
              value="a"
              onCommit={commit}
            />
          </FrameSettingsComponentsProvider>,
        ),
      );
      expect(host.textContent).toContain('Local');
      expect(host.querySelectorAll('button')).toHaveLength(2);
      expect(editor.disabled).toBe(true);
      expect(editor.state.mixed).toBe(true);
      await act(async () => editor.onCommit('b'));
      expect(commit).not.toHaveBeenCalled();
    } finally {
      await act(() => root.unmount());
    }
  });
});
