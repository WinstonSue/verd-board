import { actionLabel, type ActionResult } from '@sue/board-common';
import {
  ActionScope,
  type ActionSource,
  type ActionScopeValue,
} from '@sue/board-react-actions';
import { canonicalFrameProjection } from './frame-view-projection';
import {
  assertRegisteredCellKinds,
  copyCellFragment,
  deleteCells,
  isFrameCell,
  lockedByAncestor,
  planCellPaste,
  resolveBoardTheme,
  type CellOperation,
  type FrameSnapshot,
} from '@sue/board-core';
import {
  Fragment,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type ReactElement,
} from 'react';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameCanvasProps,
  type FrameCanvasTool,
  type FrameCanvasViewState,
} from './frame-canvas';
import { FramePropertyContext } from './frame-property-panel';
import { FrameEditorProperties } from './frame-editor-properties';
import { FrameI18nProvider } from './frame-i18n';
import { FrameThemeContext } from './frame-theme';
import { FrameMenu } from './frame-menu';
import {
  createFramePluginSet,
  type FrameExporter,
  type FrameImporter,
  type FrameLanguage,
  type FramePluginContext,
  type FrameUIPlugin,
} from './frame-plugins';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
export type FrameEditorProps<T = FrameSnapshot> = DistributiveOmit<
  FrameCanvasProps<T>,
  'pluginSet' | 'registry' | 'extensions'
> & {
  plugins: readonly FrameUIPlugin[];
  language?: FrameLanguage;
  importers?: readonly FrameImporter[];
  exporters?: readonly FrameExporter[];
};
const emptyActions: ActionSource = {
  actions: () => [],
  subscribe: () => () => {},
  revision: 0,
  getActionState: () => ({ visible: false, enabled: false }),
};
const uid = () => crypto.randomUUID();
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function Editor<T>(
  props: FrameEditorProps<T>,
  ref: ForwardedRef<FrameCanvasController>,
) {
  const {
    plugins,
    language = 'zh',
    importers = [],
    exporters = [],
    ...canvas
  } = props;
  const pluginSet = useMemo(() => createFramePluginSet(plugins), [plugins]);
  const signature = JSON.stringify([
    pluginSet.plugins.map((plugin) => plugin.id),
    pluginSet.registry.kinds().slice().sort(),
  ]);
  const initialSignature = useRef(signature);
  if (signature !== initialSignature.current)
    throw new Error(
      'Plugin kinds cannot change on a mounted editor; remount it with a new key',
    );
  const controller = useRef<FrameCanvasController>(null);
  const actionScope = useRef<ActionScopeValue | null>(null);
  useImperativeHandle(ref, () => controller.current!, []);
  const [selectionIds, setSelection] = useState<readonly string[]>([]);
  const [view, setView] = useState<FrameCanvasViewState>();
  const [tool, setTool] = useState<FrameCanvasTool>({
    mode: 'select',
    key: 'select',
  });
  const [error, setError] = useState<string>();
  const [menu, setMenu] = useState<[number, number] | null>(null);
  const [propertyRequests, setPropertyRequests] = useState<
    Record<string, number>
  >({});
  const snapshot = props.adapter
    ? props.adapter.toFrameSnapshot(props.value as T)
    : (props.value as FrameSnapshot);
  const frameId = props.frameId ?? snapshot.store.rootId;
  const store = snapshot.store;
  const selectedCell =
    selectionIds.length === 1 ? store.cells[selectionIds[0]] : undefined;
  const disabled = !!(
    props.readonly ||
    view?.readonly ||
    view?.pending ||
    selectedCell?.locked ||
    (selectedCell && lockedByAncestor(store, selectedCell.id))
  );
  const dispatch = async (operations: CellOperation[]) => {
    try {
      const result = await controller.current?.dispatch({
        id: uid(),
        operations,
      });
      if (result?.status === 'rejected') setError(result.message ?? 'Rejected');
      else setError(undefined);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return undefined;
    }
  };
  const context: FramePluginContext = {
    surface: 'editor',
    store,
    frameId,
    cell: selectionIds.length === 1 ? store.cells[selectionIds[0]] : undefined,
    selectionIds,
    language,
    disabled,
    controller: controller.current,
    dispatch,
    registry: pluginSet.registry,
    readonly: !!props.readonly,
    pending: !!view?.pending,
    locked: !!selectedCell?.locked,
    viewProjection:
      controller.current?.getViewProjection() ?? canonicalFrameProjection,
    clearRevealOverrides: (ids) =>
      controller.current?.clearRevealOverrides(ids),
    runOperations: async (operations, after) => {
      const result = await controller.current
        ?.getActionContext()
        .runOperations(operations, after);
      return result ?? { status: 'rejected', code: 'not-ready' };
    },
    executeAction: (id, args, invocation) =>
      controller.current?.executeAction(id, args, invocation) ??
      Promise.resolve({ status: 'rejected', code: 'not-ready' }),
    getActionState: (id, args) =>
      controller.current?.getActionState(id, args) ?? {
        visible: false,
        enabled: false,
      },
    allocateId: uid,
    setTool,
    propertyRequests,
    requestProperties(pluginId, cellId, section) {
      const key = `${pluginId}:${cellId}:${section}`;
      setPropertyRequests((current) => ({
        ...current,
        [key]: (current[key] ?? 0) + 1,
      }));
    },
  };
  const messages = Object.assign(
    {},
    ...plugins.map((plugin) => plugin.messages?.[language]),
  );
  const zh = language === 'zh';
  const frame = store.cells[frameId];
  const theme = useMemo(
    () =>
      resolveBoardTheme(
        isFrameCell(frame) ? frame.view?.theme : undefined,
        props.appearance,
      ),
    [frame, props.appearance],
  );
  return (
    <FrameI18nProvider language={language} messages={messages}>
      <FrameThemeContext.Provider value={theme}>
        <ActionScope
          registry={controller.current?.actionSource ?? emptyActions}
          language={language}
          onReady={(value) => {
            actionScope.current = value;
          }}
        >
          <div
            className="frame-editor"
            data-frame-editor
            data-language={language}
          >
            <div
              role="toolbar"
              aria-label={zh ? '编辑工具' : 'Editor tools'}
              className="frame-editor__toolbar"
            >
              <button
                type="button"
                onClick={() => actionScope.current?.openPalette()}
              >
                {zh ? '命令面板' : 'Command palette'}
              </button>
              <button
                type="button"
                onClick={() => actionScope.current?.openHelp()}
              >
                {zh ? '快捷键' : 'Keyboard shortcuts'}
              </button>
              <button
                type="button"
                aria-pressed={tool.mode === 'select'}
                onClick={() => setTool({ mode: 'select', key: 'select' })}
              >
                {zh ? '选择' : 'Select'}
              </button>
              <button
                type="button"
                aria-pressed={tool.mode === 'hand'}
                onClick={() => setTool({ mode: 'hand', key: 'hand' })}
              >
                {zh ? '平移' : 'Pan'}
              </button>
              <button
                type="button"
                disabled={disabled || view?.canUndo === false}
                onClick={() =>
                  controller.current?.executeAction('canvas.history.undo')
                }
              >
                {zh ? '撤销' : 'Undo'}
              </button>
              <button
                type="button"
                disabled={disabled || view?.canRedo === false}
                onClick={() =>
                  controller.current?.executeAction('canvas.history.redo')
                }
              >
                {zh ? '重做' : 'Redo'}
              </button>
              {(['copy', 'cut', 'paste'] as const).map((action) => (
                <button
                  type="button"
                  key={action}
                  disabled={action !== 'copy' && disabled}
                  onClick={() => {
                    void controller.current?.executeAction(
                      `canvas.clipboard.${action}`,
                    );
                  }}
                >
                  {
                    {
                      copy: zh ? '复制' : 'Copy',
                      cut: zh ? '剪切' : 'Cut',
                      paste: zh ? '粘贴' : 'Paste',
                    }[action]
                  }
                </button>
              ))}
              <button
                type="button"
                disabled={disabled || !selectionIds.length}
                onClick={() => {
                  void controller.current?.executeAction(
                    'canvas.selection.delete',
                  );
                }}
              >
                {zh ? '删除' : 'Delete'}
              </button>
              <button
                type="button"
                disabled={disabled || selectionIds.length < 2}
                onClick={() => {
                  void controller.current?.executeAction(
                    'canvas.selection.group',
                  );
                }}
              >
                {zh ? '组合' : 'Group'}
              </button>
              {plugins.map((plugin) =>
                plugin.Toolbar ? (
                  <plugin.Toolbar key={plugin.id} {...context} />
                ) : null,
              )}
              {pluginSet.tools.map((contribution) => (
                <button
                  type="button"
                  key={contribution.id}
                  data-frame-tool={contribution.id}
                  disabled={
                    !controller.current?.getActionState(contribution.actionId)
                      .enabled
                  }
                  title={contribution.shortcut}
                  onClick={() => {
                    void controller.current?.executeAction(
                      contribution.actionId,
                    );
                  }}
                >
                  {actionLabel(
                    controller.current
                      ?.actions()
                      .find((action) => action.id === contribution.actionId)
                      ?.label ??
                      contribution.label ??
                      contribution.id,
                    language,
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  controller.current?.executeAction('canvas.view.fit')
                }
              >
                {zh ? '适应画布' : 'Fit'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void controller.current
                    ?.exportImage({ format: 'png' })
                    .then((blob) => download(blob, 'frame.png'))
                    .catch((reason) => setError(String(reason)));
                }}
              >
                {zh ? '导出图片' : 'Export image'}
              </button>
              {importers.map((importer) => (
                <label key={importer.id}>
                  {importer.label}
                  <input
                    aria-label={importer.label}
                    type="file"
                    accept={importer.accept}
                    disabled={disabled}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      try {
                        const incoming = await importer.import(
                          await file.text(),
                          {
                            registry: pluginSet.registry,
                          },
                        );
                        assertRegisteredCellKinds(
                          incoming.store,
                          pluginSet.registry,
                        );
                        const root =
                          incoming.store.cells[incoming.store.rootId];
                        if (!isFrameCell(root))
                          throw new Error('Imported root must be a frame');
                        const fragment = copyCellFragment(
                          incoming.store,
                          [...root.children, ...root.groups],
                          pluginSet.registry,
                        );
                        const current = store.cells[frameId];
                        if (!isFrameCell(current))
                          throw new Error('Missing frame');
                        const clearing = deleteCells(
                          store,
                          [...current.children, ...current.groups],
                          { registry: pluginSet.registry },
                        );
                        const pasted = planCellPaste({
                          store,
                          frameId,
                          fragment,
                          selectionIds: [],
                          allocateId: uid,
                          registry: pluginSet.registry,
                          intent: 'open',
                          offset: [0, 0],
                        });
                        await dispatch([...clearing, ...pasted.operations]);
                      } catch (reason) {
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : String(reason),
                        );
                      }
                      event.target.value = '';
                    }}
                  />
                </label>
              ))}
              {exporters.map((exporter) => (
                <button
                  key={exporter.id}
                  type="button"
                  onClick={async () => {
                    try {
                      const result = await exporter.export(snapshot, {
                        registry: pluginSet.registry,
                        frameId,
                      });
                      download(
                        typeof result === 'string'
                          ? new Blob([result], { type: 'text/plain' })
                          : result,
                        exporter.id,
                      );
                    } catch (reason) {
                      setError(String(reason));
                    }
                  }}
                >
                  {exporter.label}
                </button>
              ))}
            </div>
            {error && <div role="alert">{error}</div>}
            {menu && (
              <FrameMenu
                point={menu}
                onClose={() => setMenu(null)}
                items={[
                  ...(['copy', 'cut', 'paste'] as const).map((action) => ({
                    id: action,
                    label: {
                      copy: zh ? '复制' : 'Copy',
                      cut: zh ? '剪切' : 'Cut',
                      paste: zh ? '粘贴' : 'Paste',
                    }[action],
                    disabled:
                      action === 'copy' ? !selectionIds.length : disabled,
                    run: () => {
                      void controller.current?.executeAction(
                        `canvas.clipboard.${action}`,
                      );
                    },
                  })),
                  {
                    id: 'delete',
                    label: zh ? '删除' : 'Delete',
                    disabled: disabled || !selectionIds.length,
                    run: () => {
                      void dispatch(
                        deleteCells(store, selectionIds, {
                          registry: pluginSet.registry,
                        }),
                      );
                    },
                  },
                  {
                    id: 'fit',
                    label: zh ? '适应画布' : 'Fit',
                    run: () =>
                      controller.current?.executeAction('canvas.view.fit'),
                  },
                ]}
              />
            )}

            <div className="frame-editor__body">
              <FrameCanvas<T>
                {...(canvas as FrameCanvasProps<T>)}
                ref={controller}
                pluginSet={pluginSet}
                actionHost={{
                  language,
                  setTool,
                  propertyRequests,
                  requestProperties: context.requestProperties,
                  actions: props.actionHost?.actions,
                }}

                onCanvasContextMenu={(point) => {
                  if (!props.onCanvasContextMenu) setMenu(point);
                  props.onCanvasContextMenu?.(point);
                }}
                tool={props.tool ?? tool}
                onSelectionChange={(selection) => {
                  setSelection(selection.ids);
                  props.onSelectionChange?.(selection);
                }}
                onViewStateChange={(state) => {
                  setView(state);
                  props.onViewStateChange?.(state);
                }}
                onReject={(result) => {
                  setError(result.message ?? 'Rejected');
                  props.onReject?.(result);
                }}
              />
              <FramePropertyContext.Provider
                value={{
                  identity: JSON.stringify([frameId, selectionIds]),
                  disabled,
                }}
              >
                <aside
                  aria-label="Properties"
                  className="frame-editor__properties"
                >
                  <FrameEditorProperties {...context} />
                  {plugins.map((plugin) => (
                    <Fragment key={plugin.id}>
                      {(plugin.propertyPanels ?? []).map((panel) => (
                        <div key={panel.id} data-settings-panel={panel.id}>
                          {panel.render(context)}
                        </div>
                      ))}
                      {plugin.Properties && <plugin.Properties {...context} />}
                    </Fragment>
                  ))}
                  {plugins.map((plugin) => (
                    <Fragment key={plugin.id}>
                      {(plugin.settingsPanels ?? []).map((panel) => (
                        <div key={panel.id} data-settings-panel={panel.id}>
                          {panel.render(context)}
                        </div>
                      ))}
                      {plugin.Settings && <plugin.Settings {...context} />}
                    </Fragment>
                  ))}
                </aside>
              </FramePropertyContext.Provider>
            </div>
          </div>
        </ActionScope>
      </FrameThemeContext.Provider>
    </FrameI18nProvider>
  );
}
export const FrameEditor = forwardRef(Editor) as <T = FrameSnapshot>(
  props: FrameEditorProps<T> & { ref?: ForwardedRef<FrameCanvasController> },
) => ReactElement;
