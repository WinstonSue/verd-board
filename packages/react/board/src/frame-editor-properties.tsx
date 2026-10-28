import { FrameAppearanceSettings } from './frame-appearance-settings';
import { FrameSettingsText } from './frame-settings';
import { FrameGeometryControls } from './frame-settings';
import { FrameSettingsControl } from './frame-settings';
import { createInlineText } from '@sue/board-common';
import {
  isEdgeCell,
  isFrameCell,
  isNodeCell,
  type Cell,
  type NodeCell,
  type NodeGeometry,
} from '@sue/board-core';
import type { FramePluginContext } from './frame-plugins';
import { FramePropertyNumber } from './frame-property-number';
import {
  FrameRichTextField,
  existingTextDocument,
} from './frame-rich-text-field';
/** Common properties do not interpret domain payloads. All writes use the canvas transaction path. */
export function FrameEditorProperties(context: FramePluginContext) {
  const { cell, disabled, language, controller } = context;
  if (!cell) return null;
  const zh = language === 'zh';
  const current = () =>
    controller ? controller.runtime.store.cells[cell.id] : cell;
  const replace = (next: Cell) => {
    void context.dispatch([{ type: 'replace_cell', cell: next }]);
  };
  const capabilities = controller?.runtime.registry
    .get(cell.kind)
    ?.capabilities?.(
      context.store,
      cell,
      isFrameCell(cell) && cell.id !== context.frameId ? 'embedded' : 'root',
    );
  return (
    <fieldset disabled={disabled} className="frame-editor__common-properties">
      {isNodeCell(cell) && (
        <>
          <label>
            {zh ? '名称' : 'Name'}
            <FrameSettingsText
              key={`${cell.id}:name`}
              identity={String(`${cell.id}:name`)}
              field={{
                key: 'common-text-0',
                props: { attributes: { 'aria-label': 'Name' } },
              }}
              value={cell.name ?? cell.content?.label ?? ''}
              onCommit={(value) => {
                const latest = current();
                if (isNodeCell(latest) && latest.name !== value)
                  replace({ ...latest, name: value });
              }}
            />
          </label>
          <div className="frame-property-grid">
            <FrameGeometryControls
              values={cell.geometry}
              identity={cell.id}
              disabled={(key) =>
                disabled ||
                (key === 'x' || key === 'y'
                  ? capabilities?.move === false
                  : capabilities?.resize === false)
              }
              shortLabels
              onCommit={(key, value) => {
                const latest = current();
                if (isNodeCell(latest))
                  replace({
                    ...latest,
                    geometry: { ...latest.geometry, [key]: value },
                  });
              }}
            />
          </div>
          {capabilities?.rotate !== false && (
            <label>
              {zh ? '旋转' : 'Rotation'}
              <FramePropertyNumber
                aria-label="Rotation"
                identity={cell.id}
                value={((cell.geometry.rotation ?? 0) * 180) / Math.PI}
                onCommit={(value) => {
                  const latest = current();
                  if (isNodeCell(latest))
                    replace({
                      ...latest,
                      geometry: {
                        ...latest.geometry,
                        rotation: (value * Math.PI) / 180,
                      } as NodeGeometry,
                    });
                }}
              />
            </label>
          )}
          <FrameRichTextField
            label={zh ? '文本' : 'Text'}
            readonly={disabled}
            text={
              existingTextDocument(cell.content?.text) ??
              createInlineText(cell.content?.label ?? '')
            }
            onChange={(text) => {
              const latest = current();
              if (isNodeCell(latest))
                replace({
                  ...latest,
                  content: { ...latest.content, text, label: text.plainText },
                });
            }}
          />
        </>
      )}
      {(isNodeCell(cell) || isEdgeCell(cell)) && (
        <FrameAppearanceSettings
          values={{
            fill: isNodeCell(cell) ? (cell.appearance?.fill ?? '') : undefined,
            strokeColor: cell.appearance?.strokeColor ?? '',
            strokeWidth: cell.appearance?.strokeWidth ?? 1.5,
            opacity: cell.appearance?.opacity ?? 1,
            strokeStyle: undefined,
            shadow: undefined,
          }}
          identity={cell.id}
          language={language}
          profile="editor"
          includeFill={isNodeCell(cell)}
          disabled={disabled}
          onCommit={({ changes }) => {
            const latest = current();
            if (!isNodeCell(latest) && !isEdgeCell(latest)) return;
            const patch = Object.fromEntries(
              changes.map((change) => [
                change.key,
                change.kind === 'reset'
                  ? undefined
                  : (change.key === 'fill' || change.key === 'strokeColor') &&
                      change.value === ''
                    ? undefined
                    : change.value,
              ]),
            );
            replace({
              ...latest,
              appearance: { ...latest.appearance, ...patch },
            } as Cell);
          }}
        />
      )}
      {isEdgeCell(cell) &&
        controller?.runtime.registry.get(cell.kind)?.routable !== false && (
          <label>
            {zh ? '路由' : 'Route'}
            <FrameSettingsControl
              field={{
                key: 'Edge route',
                editor: 'select',
                props: {
                  'aria-label': 'Edge route',
                  children: (
                    <>
                      {['auto', 'straight', 'orthogonal', 'curve'].map(
                        (mode) => (
                          <option key={mode}>{mode}</option>
                        ),
                      )}
                    </>
                  ),
                },
              }}
              value={cell.route.mode}
              onCommit={(value) => {
                const latest = current();
                if (isEdgeCell(latest))
                  replace({
                    ...latest,
                    route: {
                      mode: value as
                        'auto' | 'straight' | 'orthogonal' | 'curve',
                      ...((value === 'auto' || value === 'orthogonal') &&
                      'strategy' in latest.route &&
                      latest.route.strategy
                        ? { strategy: latest.route.strategy }
                        : {}),
                    },
                  });
              }}
            />
          </label>
        )}
    </fieldset>
  );
}
