import { FrameSettingsControl } from './frame-settings';
import {
  Alignment,
  boardTextFormatState,
  type BoardTextDocument,
  type BoardTextFormatDefaults,
  type BoardTextFormatPatch,
} from '@sue/board-common';
import { useMemo } from 'react';

const FONT_SIZES = [10, 12, 13, 14, 16, 18, 20, 24, 28, 32];

/**
 * Shared whole-document text controls. `document` supplies the leaves,
 * `defaults` resolve absent marks (theme color, domain font size),
 * `readonly` mirrors host lock/pending state, and `onChange` receives the
 * patch to commit through the caller's transaction path.
 */
export function BoardTextFormatControls({
  document,
  defaults,
  readonly,
  onChange,
  showThemeFollow = true,
}: {
  document: BoardTextDocument;
  defaults: BoardTextFormatDefaults;
  readonly?: boolean;
  onChange(patch: BoardTextFormatPatch): void;
  /** Whether "跟随主题" clears the color override. */
  showThemeFollow?: boolean;
}) {
  const state = boardTextFormatState(document, defaults);
  const sizeValue = String(state.fontSize ?? defaults.fontSize ?? '');
  const sizes = useMemo(() => {
    const explicit = parseFloat(sizeValue);
    return [
      ...new Set([
        ...FONT_SIZES,
        ...(Number.isFinite(explicit) ? [explicit] : []),
      ]),
    ].sort((a, b) => a - b);
  }, [sizeValue]);
  return (
    <>
      <div role="toolbar" aria-label="Text marks">
        {(
          [
            ['bold', '粗体'],
            ['italic', '斜体'],
            ['underline', '下划线'],
            ['strike', '删除线'],
          ] as const
        ).map(([mark, label]) => (
          <button
            key={mark}
            type="button"
            aria-label={`Format ${mark}`}
            aria-pressed={state[mark] === 'mixed' ? 'mixed' : state[mark]}
            disabled={readonly || state.empty}
            onClick={() => onChange({ [mark]: state[mark] !== true })}
          >
            {label}
          </button>
        ))}
      </div>
      <label>
        字号
        <FrameSettingsControl
          field={{
            key: 'Text font size',
            editor: 'select',
            props: {
              'aria-label': 'Text font size',
              disabled: readonly || state.empty,
              children: (
                <>
                  {state.fontSize === 'mixed' && (
                    <option value="" disabled>
                      混合值
                    </option>
                  )}
                  <option value="default">
                    默认
                    {defaults.fontSize
                      ? `（${parseFloat(defaults.fontSize)}）`
                      : ''}
                  </option>
                  {sizes.map((size) => (
                    <option key={size} value={`${size}px`}>
                      {size}
                    </option>
                  ))}
                </>
              ),
            },
          }}
          value={state.fontSize === 'mixed' ? '' : sizeValue}
          onCommit={(value) => {
            if (value === 'default') onChange({ fontSize: null });
            else onChange({ fontSize: value });
          }}
        />
      </label>
      <label>
        文字颜色
        <FrameSettingsControl
          field={{
            key: 'Text color',
            editor: 'input',
            props: {
              'aria-label': 'Text color',
              type: 'color',
              disabled: readonly || state.empty,
            },
          }}
          value={
            /^#[0-9a-f]{6}$/i.test(String(state.color))
              ? String(state.color)
              : (defaults.color ?? '#475569')
          }
          onCommit={(value) => onChange({ color: value })}
        />
        {showThemeFollow && (
          <button
            type="button"
            disabled={readonly || state.empty || state.color === undefined}
            onClick={() => onChange({ color: null })}
          >
            跟随主题
          </button>
        )}
        {state.color === 'mixed' && <span>混合值</span>}
      </label>
      <label>
        对齐
        <FrameSettingsControl
          field={{
            key: 'Text alignment',
            editor: 'select',
            props: {
              'aria-label': 'Text alignment',
              disabled: readonly,
              children: (
                <>
                  {state.align === 'mixed' && (
                    <option value="" disabled>
                      混合值
                    </option>
                  )}
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </>
              ),
            },
          }}
          value={
            state.align === 'mixed'
              ? ''
              : (state.align ?? defaults.align ?? 'left')
          }
          onCommit={(value) => onChange({ align: value as Alignment })}
        />
      </label>
      {state.empty && <p role="note">输入笔记内容后可调整文字样式</p>}
    </>
  );
}
