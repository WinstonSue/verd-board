import { useEffect, useRef, useState, useMemo, type ChangeEvent } from 'react';
import type {
  NodeCell,
  MindNodeData,
  MindChildData,
  CellStore,
  CellOperation,
  FrameCell,
  MindColorScheme,
} from '@sue/board-core';
import { MindLayoutType } from '@sue/board-layouts';
import type { MindRootData } from '@sue/board-core';
import {
  mindTreeLayout,
  mindTreeLayoutOverrides,
  setMindTreeLayout,
  setMindTreeRightNodeCount,
  mindTreeRootId,
  mindChildIds,
  mindTheme,
  mindFrameColorScheme,
  mindNoteColor,
} from '@sue/board-mind';
import { useI18n } from './i18n';
import { useMindMaxWidth } from './mind-preferences';
import { FramePropertyNumber } from './frame-property-number';
import {
  MIN_MIND_MAX_WIDTH,
  MAX_MIND_MAX_WIDTH,
  validMindMaxWidth,
} from '@sue/board-mind';
import {
  Alignment,
  createBlockText,
  isBoardTextDocument,
  textWithDefaultAlignment,
  textWithoutDefaultAlignment,
  sameBoardText,
  formatBoardText,
  type BoardTextFormatPatch,
} from '@sue/board-common';
import { ParagraphText } from '@sue/board-react-text';
import { BoardTextFormatControls } from './frame-text-format-controls';

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
  default: '默认',
  colorful: '缤纷',
  soft: '柔和',
  retro: '复古',
  dark: '暗色',
  starry: '星空',
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
  const explicit = frame?.view?.mind?.colorScheme;
  const value = explicit && explicit in SCHEME_LABELS ? explicit : 'inherit';
  const resolved = mindTheme(mindFrameColorScheme(frame));
  return (
    <label>
      Mind 配色
      <select
        aria-label="Mind color scheme"
        disabled={readonly}
        value={value}
        onChange={(event) => {
          if (!frame) return;
          const selected = event.target.value;
          const mind = { ...frame.view?.mind };
          if (selected === 'inherit') delete mind.colorScheme;
          else mind.colorScheme = selected as MindColorScheme;
          const view = { ...frame.view };
          if (Object.keys(mind).length) view.mind = mind;
          else delete view.mind;
          apply({ ...frame, view });
        }}
      >
        <option value="inherit">继承画布</option>
        {(Object.keys(SCHEME_LABELS) as MindColorScheme[]).map((scheme) => (
          <option key={scheme} value={scheme}>
            {SCHEME_LABELS[scheme]}
          </option>
        ))}
      </select>
      <span aria-hidden style={{ letterSpacing: 2 }}>
        {(value === 'inherit' ? resolved : mindTheme(value)).branches
          .slice(0, 5)
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
  const noteColor = mindNoteColor(store, cell.id, frame?.id);
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
        <select
          aria-label="Mind topic shape"
          value={topicShape}
          onChange={(event) => {
            const latest = getCell();
            if (latest)
              replace({
                ...latest,
                geometry: { ...latest.geometry, outline: event.target.value },
              });
          }}
        >
          <option value="roundRectangle">
            {language === 'zh' ? '圆角矩形' : 'Rounded rectangle'}
          </option>
          <option value="underline">
            {language === 'zh' ? '下划线' : 'Underline'}
          </option>
          {!['roundRectangle', 'underline'].includes(topicShape) && (
            <option value={topicShape}>{topicShape}</option>
          )}
        </select>
      </label>
      {(cell.kind === 'mind-child' || cell.kind === 'mind-root') && (
        <>
          <label>
            {language === 'zh' ? '分支形状' : 'Branch shape'}
            <select
              aria-label="Mind branch shape"
              value={data?.branchShape ?? 'bight'}
              onChange={(event) =>
                update({
                  branchShape: event.target.value as 'bight' | 'polyline',
                })
              }
            >
              <option value="bight">
                {language === 'zh' ? '曲线' : 'Curve'}
              </option>
              <option value="polyline">
                {language === 'zh' ? '折线' : 'Polyline'}
              </option>
            </select>
          </label>
          <label>
            {language === 'zh' ? '分支颜色' : 'Branch color'}
            <input
              aria-label="Mind branch color"
              type="color"
              value={
                data?.branchAppearance?.strokeColor ??
                cell.appearance?.strokeColor ??
                '#64748b'
              }
              onChange={(event) =>
                update({
                  branchAppearance: {
                    ...data?.branchAppearance,
                    strokeColor: event.target.value,
                  },
                })
              }
            />
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
            <select
              aria-label="Mind branch style"
              value={data?.branchAppearance?.strokeStyle ?? 'solid'}
              onChange={(event) =>
                update({
                  branchAppearance: {
                    ...data?.branchAppearance,
                    strokeStyle: event.target.value as
                      'solid' | 'dashed' | 'dotted',
                  },
                })
              }
            >
              <option value="solid">
                {language === 'zh' ? '实线' : 'Solid'}
              </option>
              <option value="dashed">
                {language === 'zh' ? '虚线' : 'Dashed'}
              </option>
              <option value="dotted">
                {language === 'zh' ? '点线' : 'Dotted'}
              </option>
            </select>
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
        <input
          aria-label="Mind emojis"
          value={data?.emojis?.map((emoji) => emoji.name).join(' ') ?? ''}
          placeholder="🙂 🚀"
          onChange={(event) =>
            update({
              emojis: event.target.value
                .split(/\s+/)
                .filter(Boolean)
                .map((name) => ({ name })),
            })
          }
        />
      </label>
      {(cell.kind === 'mind-root' || cell.kind === 'mind-child') && (
        <fieldset>
          <legend>整树布局（应用于整棵树）</legend>
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
                {label}
              </button>
            ))}
            <select
              aria-label="More mind layouts"
              disabled={readonly || disabled}
              value={
                MORE_LAYOUTS.some(([layout]) => layout === treeLayout)
                  ? treeLayout
                  : ''
              }
              onChange={(event) => {
                if (!event.target.value) return;
                dispatch(
                  setMindTreeLayout(
                    store,
                    cell.id,
                    event.target.value as MindLayoutType,
                  ),
                );
              }}
            >
              <option value="" disabled>
                更多布局…
              </option>
              {MORE_LAYOUTS.map(([layout, label]) => (
                <option key={layout} value={layout}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <p>
            当前：
            {LAYOUT_LABELS.get(treeLayout as MindLayoutType) ?? treeLayout}
          </p>
          {treeOverrides.length > 0 && (
            <button
              type="button"
              disabled={readonly || disabled}
              onClick={() =>
                dispatch(setMindTreeLayout(store, cell.id, treeLayout))
              }
            >
              统一整树布局（清理 {treeOverrides.length} 处局部覆盖）
            </button>
          )}
          {treeLayout === MindLayoutType.standard && (
            <label>
              右侧主题数（0～{rightTopicTotal}）
              <FramePropertyNumber
                aria-label="Mind right node count"
                min={0}
                max={rightTopicTotal}
                step={1}
                disabled={readonly || disabled}
                value={rightNodeCount}
                placeholder="自动"
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
                恢复自动分配
              </button>
            </label>
          )}
        </fieldset>
      )}
      {cell.kind === 'mind-root' && (
        <>
          <label>
            {t('mind.maxNodeWidth')}
            <select
              aria-label={t('mind.widthMode')}
              data-testid="mind-width-mode"
              value={data?.maxNodeWidth === undefined ? 'default' : 'custom'}
              onChange={(event) =>
                update({
                  maxNodeWidth:
                    event.target.value === 'default'
                      ? undefined
                      : defaultMaxWidth,
                })
              }
            >
              <option value="default">{t('mind.followDefault')}</option>
              <option value="custom">{t('mind.customWidth')}</option>
            </select>
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
          <input
            aria-label="Collapse topic"
            type="checkbox"
            checked={!!data?.collapsed}
            onChange={(event) => update({ collapsed: event.target.checked })}
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
          <legend>笔记文本</legend>
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
          <input
            aria-label="Collapse note"
            type="checkbox"
            checked={!!data.noteCollapsed}
            onChange={(event) =>
              update({ noteCollapsed: event.target.checked })
            }
          />
        </label>
      )}
      {noteOpen && (
        <div
          role="region"
          aria-label="Mind note"
          style={{
            minHeight: 100,
            padding: 8,
            border: '1px solid #cbd5e1',
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
          <button onClick={() => setNoteOpen(false)}>完成笔记</button>
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
