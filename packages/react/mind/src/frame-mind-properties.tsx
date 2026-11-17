import { FrameSettingsControl } from '@sue/board-react';
import type {
  CellOperation,
  CellStore,
  FrameCell,
  NodeCell,
} from '@sue/board-core';
import { MindLayoutType } from '@sue/board-layouts';
import {
  type MindChildData,
  type MindColorScheme,
  type MindNodeData,
  type MindRootData,
} from '@sue/board-mind';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import {
  Alignment,
  createBlockText,
  formatBoardText,
  isBoardTextDocument,
  sameBoardText,
  textWithDefaultAlignment,
  textWithoutDefaultAlignment,
  type BoardTextFormatPatch,
} from '@sue/board-common';
import {
  MAX_MIND_MAX_WIDTH,
  MIN_MIND_MAX_WIDTH,
  mindChildIds,
  mindBranchColor,
  mindFrameColorScheme,
  mindNoteColor,
  mindTheme,
  mindTreeLayout,
  mindTreeLayoutOverrides,
  mindTreeRootId,
  setMindTreeLayout,
  setMindTreeRightNodeCount,
  validMindMaxWidth,
} from '@sue/board-mind';
import {
  useFrameAppearance,
  useFrameTheme,
  frameThemeStyle,
  BoardTextFormatControls,
  FramePropertyNumber,
  useFrameI18n as useI18n,
} from '@sue/board-react';
import { ParagraphText } from '@sue/board-react-text';
import { useMindMaxWidth } from './settings';

const englishLabels: Record<string, string> = {
  左右对分: 'Balanced',
  单向向右: 'Right',
  单向向下: 'Down',
  单向向左: 'Left',
  单向向上: 'Up',
  右下缩进: 'Indented down right',
  右上缩进: 'Indented up right',
  左下缩进: 'Indented down left',
  左上缩进: 'Indented up left',
  经典: 'Classic',
  缤纷: 'Colorful',
  柔和: 'Soft',
  复古: 'Retro',
  清新: 'Fresh',
};
const localize = (value: string, language: string) =>
  language === 'zh' ? value : (englishLabels[value] ?? value);
const COMMON_LAYOUTS: [MindLayoutType, string][] = [
  [MindLayoutType.standard, '左右对分'],
  [MindLayoutType.right, '单向向右'],
  [MindLayoutType.downward, '单向向下'],
];
const MORE_LAYOUTS: [MindLayoutType, string][] = [
  [MindLayoutType.left, '单向向左'],
  [MindLayoutType.upward, '单向向上'],
  [MindLayoutType.rightBottomIndented, '右下缩进'],
  [MindLayoutType.rightTopIndented, '右上缩进'],
  [MindLayoutType.leftBottomIndented, '左下缩进'],
  [MindLayoutType.leftTopIndented, '左上缩进'],
];
const LAYOUT_LABELS = new Map([...COMMON_LAYOUTS, ...MORE_LAYOUTS]);

const SCHEME_LABELS: Record<MindColorScheme, string> = {
  default: '经典',
  colorful: '缤纷',
  soft: '柔和',
  retro: '复古',
  dark: '清新',
};

/** File-level mind scheme picker: name plus a palette swatch preview. */
export function MindSchemeField({
  frame,
  apply,
  readonly,
}: {
  frame: FrameCell | undefined;
  apply(frame: FrameCell): void;
  readonly?: boolean;
}) {
  const { language } = useI18n();
  const explicit = frame?.view?.mind?.colorScheme;
  const value =
    explicit === undefined ? 'inherit' : mindFrameColorScheme(frame);
  const appearance = useFrameAppearance();
  const resolved = mindTheme(mindFrameColorScheme(frame), appearance);
  return (
    <label>
      {language === 'zh' ? 'Mind 配色' : 'Mind color scheme'}
      <FrameSettingsControl
        field={{
          key: 'Mind color scheme',
          editor: 'select',
          props: {
            'aria-label': 'Mind color scheme',
            disabled: readonly,
            children: (
              <>
                <option value="inherit">
                  {language === 'zh' ? '继承画布' : 'Inherit canvas'}
                </option>
                {(Object.keys(SCHEME_LABELS) as MindColorScheme[]).map(
                  (scheme) => (
                    <option key={scheme} value={scheme}>
                      {localize(SCHEME_LABELS[scheme], language)}
                    </option>
                  ),
                )}
              </>
            ),
          },
        }}
        value={value}
        onCommit={(value) => {
          if (!frame) return;
          const selected = value;
          const mind = { ...frame.view?.mind };
          if (selected === 'inherit') delete mind.colorScheme;
          else mind.colorScheme = selected as MindColorScheme;
          const view = { ...frame.view };
          if (Object.keys(mind).length) view.mind = mind;
          else delete view.mind;
          apply({ ...frame, view });
        }}
      />
      <span aria-hidden style={{ letterSpacing: 2 }}>
        {(value === 'inherit'
          ? resolved
          : mindTheme(value, appearance)
        ).branches
          .slice(0, 6)
          .map((color) => (
            <i
              key={color}
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: 2,
                background: color,
              }}
            />
          ))}
      </span>
    </label>
  );
}

export function FrameMindProperties({
  cell,
  replace,
  getCell,
  store,
  dispatch,
  frame,
  readonly,
  openNoteRequest = 0,
  onNoteOpened,
  defaultMaxWidth: workspaceMaxWidth,
  disabled = false,
}: {
  cell: NodeCell;
  defaultMaxWidth?: number;
  disabled?: boolean;
  replace(cell: NodeCell): void;
  getCell(): NodeCell | undefined;
  store: CellStore;
  dispatch(operations: CellOperation[]): void;
  frame?: FrameCell;
  readonly?: boolean;
  openNoteRequest?: number;
  onNoteOpened?(): void;
}) {
  const { t, language } = useI18n();
  const preferenceMaxWidth = useMindMaxWidth();
  const defaultMaxWidth = workspaceMaxWidth ?? preferenceMaxWidth;
  const data = cell.data as (MindRootData & MindChildData) | undefined;
  const treeLayout = mindTreeLayout(store, cell.id);
  const treeOverrides = mindTreeLayoutOverrides(store, cell.id);
  const treeRoot = mindTreeRootId(store, cell.id);
  const treeRootCell = treeRoot ? store.cells[treeRoot] : undefined;
  const rightNodeCount =
    treeRootCell && 'data' in treeRootCell
      ? (treeRootCell.data as MindRootData | undefined)?.rightNodeCount
      : undefined;
  const rightTopicTotal = treeRoot ? mindChildIds(store, treeRoot).length : 0;
  const note = useMemo(
    () =>
      isBoardTextDocument(data?.note)
        ? data.note
        : createBlockText('', Alignment.left),
    [data?.note],
  );
  const effectiveNote = useMemo(
    () => textWithDefaultAlignment(note, Alignment.left),
    [note],
  );
  const [noteOpen, setNoteOpen] = useState(false);
  const [mediaPending, setMediaPending] = useState(false);
  const [mediaError, setMediaError] = useState<string>();
  const imageInput = useRef<HTMLInputElement>(null);
  const handledNoteRequest = useRef(0);
  useEffect(() => {
    if (!openNoteRequest || handledNoteRequest.current === openNoteRequest)
      return;
    handledNoteRequest.current = openNoteRequest;
    const latest = getCell();
    if (!latest) return;
    if (!(latest.data as MindNodeData | undefined)?.note)
      replace({
        ...latest,
        data: {
          ...(latest.data as object),
          note: createBlockText('', Alignment.left),
        },
      });
    setNoteOpen(true);
    onNoteOpened?.();
  }, [openNoteRequest, getCell, replace, onNoteOpened]);
  const topicShape =
    typeof cell.geometry.outline === 'object'
      ? cell.geometry.outline.kind
      : (cell.geometry.outline ?? 'roundRectangle');
  const update = (patch: Partial<MindRootData & MindChildData>) => {
    const latest = getCell();
    if (latest)
      replace({ ...latest, data: { ...(latest.data as object), ...patch } });
  };
  const appearance = useFrameAppearance();
  const theme = useFrameTheme();
  const noteColor = mindNoteColor(store, cell.id, frame?.id, appearance);
  const changeNote = (patch: BoardTextFormatPatch) => {
    const latest = getCell();
    const current = (latest?.data as MindNodeData | undefined)?.note;
    if (!latest || !isBoardTextDocument(current)) return;
    const next = formatBoardText(current, patch);
    // Identical results never reach history.
    if (sameBoardText(current, next)) return;
    replace({
      ...latest,
      data: { ...(latest.data as object), note: next },
    });
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setMediaPending(true);
    setMediaError(undefined);
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Cannot read image'));
        reader.readAsDataURL(file);
      });
      const image = new Image();
      image.src = url;
      await image.decode();
      const latest = getCell();
      if (!latest) throw new Error('The topic was removed');
      const width = Math.min(300, image.naturalWidth),
        height = (width * image.naturalHeight) / image.naturalWidth;
      replace({
        ...latest,
        geometry: {
          ...latest.geometry,
          width: Math.max(latest.geometry.width, width + 16),
        },
        data: { ...(latest.data as object), image: { url, width, height } },
      });
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : String(error));
    } finally {
      setMediaPending(false);
    }
  };
  return (
    <>
      <label>
        {language === 'zh' ? '主题形状' : 'Topic shape'}
        <FrameSettingsControl
          field={{
            key: 'Mind topic shape',
            editor: 'select',
            props: {
              'aria-label': 'Mind topic shape',
              children: (
                <>
                  <option value="roundRectangle">
                    {language === 'zh' ? '圆角矩形' : 'Rounded rectangle'}
                  </option>
                  <option value="underline">
                    {language === 'zh' ? '下划线' : 'Underline'}
                  </option>
                  {!['roundRectangle', 'underline'].includes(topicShape) && (
                    <option value={topicShape}>{topicShape}</option>
                  )}
                </>
              ),
            },
          }}
          value={topicShape}
          onCommit={(value) => {
            const latest = getCell();
            if (latest)
              replace({
                ...latest,
                geometry: { ...latest.geometry, outline: value },
              });
          }}
        />
      </label>
      {(cell.kind === 'mind-child' || cell.kind === 'mind-root') && (
        <>
          <label>
            {language === 'zh' ? '分支形状' : 'Branch shape'}
            <FrameSettingsControl
              field={{
                key: 'Mind branch shape',
                editor: 'select',
                props: {
                  'aria-label': 'Mind branch shape',
                  children: (
                    <>
                      <option value="bight">
                        {language === 'zh' ? '曲线' : 'Curve'}
                      </option>
                      <option value="polyline">
                        {language === 'zh' ? '折线' : 'Polyline'}
                      </option>
                    </>
                  ),
                },
              }}
              value={data?.branchShape ?? 'bight'}
              onCommit={(value) =>
                update({
                  branchShape: value as 'bight' | 'polyline',
                })
              }
            />
          </label>
          <label>
            {language === 'zh' ? '分支颜色' : 'Branch color'}
            <input
              aria-label="Mind branch color"
              type="color"
              disabled={disabled}
              value={
                mindBranchColor(store, cell.id, frame?.id, appearance) ??
                '#64748b'
              }
              onChange={(event) =>
                update({
                  branchAppearance: {
                    ...data?.branchAppearance,
                    colorSources: {
                      ...data?.branchAppearance?.colorSources,
                      strokeColor: 'custom',
                    },
                    strokeColor: event.target.value,
                  },
                })
              }
            />
            <button
              type="button"
              aria-label="Reset Mind branch to theme"
              disabled={disabled}
              onClick={() => {
                const latest = getCell();
                if (!latest) return;
                const branch = (latest.data as MindNodeData | undefined)
                  ?.branchAppearance;
                update({
                  branchAppearance: {
                    ...branch,
                    strokeColor: undefined,
                    colorSources: {
                      ...branch?.colorSources,
                      strokeColor: 'theme',
                    },
                  },
                });
              }}
            >
              {language === 'zh' ? '主题颜色' : 'Theme color'}
            </button>
          </label>
          <label>
            {language === 'zh' ? '分支宽度' : 'Branch width'}
            <FramePropertyNumber
              aria-label="Mind branch width"
              min={0}
              step={1}
              disabled={disabled}
              value={
                data?.branchAppearance?.strokeWidth ??
                cell.appearance?.strokeWidth ??
                2
              }
              onCommit={(strokeWidth) => {
                const latest = getCell();
                if (latest)
                  replace({
                    ...latest,
                    data: {
                      ...(latest.data as object),
                      branchAppearance: {
                        ...(latest.data as MindNodeData | undefined)
                          ?.branchAppearance,
                        strokeWidth,
                      },
                    },
                  });
              }}
            />
          </label>
          <label>
            {language === 'zh' ? '分支样式' : 'Branch style'}
            <FrameSettingsControl
              field={{
                key: 'Mind branch style',
                editor: 'select',
                props: {
                  'aria-label': 'Mind branch style',
                  children: (
                    <>
                      <option value="solid">
                        {language === 'zh' ? '实线' : 'Solid'}
                      </option>
                      <option value="dashed">
                        {language === 'zh' ? '虚线' : 'Dashed'}
                      </option>
                      <option value="dotted">
                        {language === 'zh' ? '点线' : 'Dotted'}
                      </option>
                    </>
                  ),
                },
              }}
              value={data?.branchAppearance?.strokeStyle ?? 'solid'}
              onCommit={(value) =>
                update({
                  branchAppearance: {
                    ...data?.branchAppearance,
                    strokeStyle: value as 'solid' | 'dashed' | 'dotted',
                  },
                })
              }
            />
          </label>
        </>
      )}
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        aria-label="Mind image file"
        hidden
        onChange={(event) => void upload(event)}
      />
      <button
        type="button"
        disabled={mediaPending}
        onClick={() => imageInput.current?.click()}
      >
        {mediaPending
          ? language === 'zh'
            ? '正在加载图片…'
            : 'Loading image…'
          : data?.image
            ? language === 'zh'
              ? '替换图片'
              : 'Replace image'
            : language === 'zh'
              ? '上传图片'
              : 'Upload image'}
      </button>
      {data?.image && (
        <>
          <label>
            {language === 'zh' ? '图片宽度' : 'Image width'}
            <FramePropertyNumber
              aria-label="Mind image width"
              min={16}
              max={1920}
              disabled={disabled}
              value={data.image.width}
              onCommit={(width) => {
                const latest = getCell(),
                  media = (latest?.data as MindNodeData | undefined)?.image;
                if (!latest || !media) return;
                replace({
                  ...latest,
                  geometry: {
                    ...latest.geometry,
                    width: Math.max(latest.geometry.width, width + 16),
                  },
                  data: {
                    ...(latest.data as object),
                    image: {
                      ...media,
                      width,
                      height: (width * media.height) / media.width,
                    },
                  },
                });
              }}
            />
          </label>
          <button type="button" onClick={() => update({ image: undefined })}>
            {language === 'zh' ? '移除图片' : 'Remove image'}
          </button>
        </>
      )}
      {mediaError && <p role="alert">{mediaError}</p>}
      <label>
        {language === 'zh' ? '表情' : 'Emojis'}
        <FrameSettingsControl
          field={{
            key: 'Mind emojis',
            editor: 'input',
            props: { 'aria-label': 'Mind emojis', placeholder: '🙂 🚀' },
          }}
          value={data?.emojis?.map((emoji) => emoji.name).join(' ') ?? ''}
          onCommit={(value) =>
            update({
              emojis: value
                .split(/\s+/)
                .filter(Boolean)
                .map((name) => ({ name })),
            })
          }
        />
      </label>
      {(cell.kind === 'mind-root' || cell.kind === 'mind-child') && (
        <fieldset>
          <legend>
            {language === 'zh'
              ? '整树布局（应用于整棵树）'
              : 'Tree layout (entire tree)'}
          </legend>
          <div role="toolbar" aria-label="Mind tree layout">
            {COMMON_LAYOUTS.map(([layout, label]) => (
              <button
                key={layout}
                type="button"
                aria-label={`Mind layout ${layout}`}
                aria-pressed={treeLayout === layout}
                disabled={readonly || disabled}
                onClick={() =>
                  dispatch(setMindTreeLayout(store, cell.id, layout))
                }
              >
                {localize(label, language)}
              </button>
            ))}
            <FrameSettingsControl
              field={{
                key: 'More mind layouts',
                editor: 'select',
                props: {
                  'aria-label': 'More mind layouts',
                  disabled: readonly || disabled,
                  children: (
                    <>
                      <option value="" disabled>
                        {language === 'zh' ? '更多布局…' : 'More layouts…'}
                      </option>
                      {MORE_LAYOUTS.map(([layout, label]) => (
                        <option key={layout} value={layout}>
                          {localize(label, language)}
                        </option>
                      ))}
                    </>
                  ),
                },
              }}
              value={
                MORE_LAYOUTS.some(([layout]) => layout === treeLayout)
                  ? treeLayout
                  : ''
              }
              onCommit={(value) => {
                if (!value) return;
                dispatch(
                  setMindTreeLayout(store, cell.id, value as MindLayoutType),
                );
              }}
            />
          </div>
          <p>
            {language === 'zh' ? '当前：' : 'Current: '}
            {localize(
              LAYOUT_LABELS.get(treeLayout as MindLayoutType) ?? treeLayout,
              language,
            )}
          </p>
          {treeOverrides.length > 0 && (
            <button
              type="button"
              disabled={readonly || disabled}
              onClick={() =>
                dispatch(setMindTreeLayout(store, cell.id, treeLayout))
              }
            >
              {language === 'zh'
                ? `统一整树布局（清理 ${treeOverrides.length} 处局部覆盖）`
                : `Apply tree layout (clear ${treeOverrides.length} overrides)`}
            </button>
          )}
          {treeLayout === MindLayoutType.standard && (
            <label>
              {language === 'zh'
                ? `右侧主题数（0～${rightTopicTotal}）`
                : `Right topics (0–${rightTopicTotal})`}
              <FramePropertyNumber
                aria-label="Mind right node count"
                min={0}
                max={rightTopicTotal}
                step={1}
                disabled={readonly || disabled}
                value={rightNodeCount}
                placeholder={language === 'zh' ? '自动' : 'Automatic'}
                validate={(value) => Number.isInteger(value)}
                onCommit={(value) =>
                  dispatch(setMindTreeRightNodeCount(store, cell.id, value))
                }
              />
              <button
                type="button"
                disabled={readonly || disabled || rightNodeCount === undefined}
                onClick={() =>
                  dispatch(setMindTreeRightNodeCount(store, cell.id, undefined))
                }
              >
                {language === 'zh'
                  ? '恢复自动分配'
                  : 'Restore automatic distribution'}
              </button>
            </label>
          )}
        </fieldset>
      )}
      {cell.kind === 'mind-root' && (
        <>
          <label>
            {t('mind.maxNodeWidth')}
            <FrameSettingsControl
              field={{
                key: 'mind-width-mode',
                editor: 'select',
                props: {
                  'aria-label': t('mind.widthMode'),
                  'data-testid': 'mind-width-mode',
                  children: (
                    <>
                      <option value="default">{t('mind.followDefault')}</option>
                      <option value="custom">{t('mind.customWidth')}</option>
                    </>
                  ),
                },
              }}
              value={data?.maxNodeWidth === undefined ? 'default' : 'custom'}
              onCommit={(value) =>
                update({
                  maxNodeWidth:
                    value === 'default' ? undefined : defaultMaxWidth,
                })
              }
            />
          </label>
          {data?.maxNodeWidth === undefined ? (
            <p>
              {t('mind.effectiveWidth')}: {defaultMaxWidth}
            </p>
          ) : (
            <FramePropertyNumber
              value={data.maxNodeWidth}
              disabled={disabled}
              min={MIN_MIND_MAX_WIDTH}
              max={MAX_MIND_MAX_WIDTH}
              step={1}
              validate={validMindMaxWidth}
              onCommit={(maxNodeWidth) => update({ maxNodeWidth })}
              aria-label={t('mind.maxNodeWidth')}
              data-testid="mind-max-width"
            />
          )}
        </>
      )}
      {cell.kind === 'mind-child' && (
        <label>
          {language === 'zh' ? '折叠' : 'Collapsed'}
          <FrameSettingsControl
            field={{
              key: 'Collapse topic',
              editor: 'input',
              props: { 'aria-label': 'Collapse topic', type: 'checkbox' },
            }}
            value={!!data?.collapsed}
            onCommit={(value) => update({ collapsed: value })}
          />
        </label>
      )}
      <MindSchemeField
        frame={frame}
        readonly={readonly}
        apply={(next) => replace(next)}
      />
      <button
        title={
          data?.note
            ? language === 'zh'
              ? '编辑笔记'
              : 'Edit note'
            : language === 'zh'
              ? '添加笔记'
              : 'Add note'
        }
        onClick={() => {
          if (!data?.note)
            update({ note: createBlockText('', Alignment.left) });
          setNoteOpen(true);
        }}
      >
        {data?.note
          ? language === 'zh'
            ? '编辑笔记'
            : 'Edit note'
          : language === 'zh'
            ? '添加笔记'
            : 'Add note'}
      </button>
      {isBoardTextDocument(data?.note) && (
        <fieldset>
          <legend>{language === 'zh' ? '笔记文本' : 'Note text'}</legend>
          <BoardTextFormatControls
            document={note}
            defaults={{ fontSize: '13px', align: Alignment.left }}
            readonly={readonly}
            onChange={changeNote}
          />
        </fieldset>
      )}
      {data?.note !== undefined && (
        <label>
          {language === 'zh' ? '收起笔记' : 'Collapse note'}
          <FrameSettingsControl
            field={{
              key: 'Collapse note',
              editor: 'input',
              props: { 'aria-label': 'Collapse note', type: 'checkbox' },
            }}
            value={!!data.noteCollapsed}
            onCommit={(value) => update({ noteCollapsed: value })}
          />
        </label>
      )}
      {noteOpen && (
        <div
          role="region"
          aria-label="Mind note"
          className="frame-note-content"
          style={{
            ...frameThemeStyle(theme),
            minHeight: 100,
            padding: 8,
            border: '1px solid var(--vm-border-strong, #cbd5e1)',
            // Explicit note defaults: the editor must not inherit the sidebar.
            fontSize: 13,
            lineHeight: 1.5,
            color: noteColor,
            textAlign: 'left',
          }}
        >
          <ParagraphText
            text={effectiveNote}
            // Notes stay out of the autofocus path so selecting a topic does not steal focus.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={false}
            onChange={({ newText }) => {
              const next = textWithoutDefaultAlignment(
                newText,
                note,
                Alignment.left,
              );
              if (!sameBoardText(note, next)) update({ note: next });
            }}
          />
          <button onClick={() => setNoteOpen(false)}>
            {language === 'zh' ? '完成笔记' : 'Done'}
          </button>
          <button
            onClick={() => {
              update({ note: undefined });
              setNoteOpen(false);
            }}
          >
            {language === 'zh' ? '删除笔记' : 'Delete note'}
          </button>
        </div>
      )}
    </>
  );
}
