import {
  applyCellOperations,
  colorContrast,
  compositeThemeFill,
  isFrameCell,
  isNodeCell,
  resolveBoardTheme,
  resolveThemeRole,
  resolveThemeSeries,
  ThemeColorMode,
  updateCellAppearance,
  type CellStore,
  type EdgeCell,
} from '@sue/board-core';
import {
  FrameCanvas,
  type FrameRenderContext,
  type FrameCanvasController,
} from '@sue/board-react';
import {
  addUmlActivation,
  addUmlCell,
  createUmlFragmentCell,
  createUmlClassCell,
  createUmlClassFrameSnapshot,
  createUmlMessageCell,
  createUmlNoteCell,
  createUmlRelationCell,
  createUmlParticipantCell,
  createUmlSequenceFrameSnapshot,
  layoutUmlSequence,
  type UmlSequenceData,
} from '@sue/board-uml';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';
import { cloneFrameImageSvg } from '../../board/src/frame-export';
import { createUmlFrameExtensions } from './index';
import { resolveUmlPartAppearance } from './theme-appearance';
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it('renders projected message routes, activation and fragments without persisting derived geometry', async () => {
  const registry = createTestCellRegistry(),
    extensions = createUmlFrameExtensions(registry);
  let store = createUmlSequenceFrameSnapshot('f', 'root').store;
  for (const id of ['a', 'b'])
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlParticipantCell(id)),
      registry,
    );
  const message = createUmlMessageCell('message', 'a', 'b');
  message.labels = [{ text: 'Long message '.repeat(40) }];
  store = applyCellOperations(store, addUmlCell(store, 'f', message), registry);
  store = applyCellOperations(
    store,
    addUmlCell(store, 'f', createUmlFragmentCell('loop', 'loop')),
    registry,
  );
  let n = 0;
  store = applyCellOperations(
    store,
    addUmlActivation(store, 'f', 'b', 0, 1, () => `event${n++}`),
    registry,
  );
  const before = JSON.stringify(store),
    container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    controller = createRef<FrameCanvasController>();
  const rect = vi
    .spyOn(SVGSVGElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({
      x: 0,
      y: 0,
      width: 1000,
      height: 700,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 700,
      toJSON() {},
    } as DOMRect);
  try {
    await act(async () =>
      root.render(
        <FrameCanvas
          ref={controller}
          value={{ store }}
          registry={registry}
          extensions={extensions}
          autoFit={false}
        />,
      ),
    );
    expect(container.querySelectorAll('[data-uml-lifeline]')).toHaveLength(2);
    expect(container.querySelector('[data-uml-activation]')).not.toBeNull();
    expect(container.querySelector('[data-uml-fragment]')).not.toBeNull();
    const image = cloneFrameImageSvg(container.querySelector('svg')!);
    expect(image.querySelector('[data-uml-activation]')).not.toBeNull();
    expect(image.querySelector('[data-frame-export-exclude]')).toBeNull();
    const bounds = controller.current!.getContentBounds();
    const layout = layoutUmlSequence(store, 'f');
    expect(bounds.height).toBeGreaterThan(300);
    expect((layout.edges.get('message') as EdgeCell).route.mode).toBe('fixed');
    expect(JSON.stringify(controller.current!.runtime.store)).toBe(before);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    rect.mockRestore();
  }
});

const cssColor = (value: string) => {
  const element = document.createElement('div');
  element.style.color = value;
  return element.style.color;
};

it('paints classifier headers and members with coordinated local colors and honors whole-cell overrides', async () => {
  const registry = createTestCellRegistry();
  const extensions = createUmlFrameExtensions(registry);
  let store = createUmlClassFrameSnapshot('f', 'root').store;
  for (const classifier of [
    'class',
    'interface',
    'abstract',
    'enum',
  ] as const) {
    const cell = createUmlClassCell(classifier, classifier);
    cell.data!.attributes = ['+id: string'];
    cell.data!.methods = ['+save() void'];
    cell.appearance = { fill: '#ff00ff', strokeColor: '#00ff00' };
    store = applyCellOperations(store, addUmlCell(store, 'f', cell), registry);
  }
  store = applyCellOperations(
    store,
    addUmlCell(
      store,
      'f',
      createUmlRelationCell('relation', 'class', 'interface', 'realization'),
    ),
    registry,
  );
  const before = JSON.stringify(store);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const controller = createRef<FrameCanvasController>();
  const onChange = vi.fn();
  const render = async (snapshot: CellStore, appearance?: 'light' | 'dark') =>
    act(async () =>
      root.render(
        <FrameCanvas
          ref={controller}
          value={{ store: snapshot }}
          registry={registry}
          extensions={extensions}
          appearance={appearance}
          autoFit={false}
          onChange={onChange}
        />,
      ),
    );
  try {
    for (const mode of Object.values(ThemeColorMode)) {
      const frame = store.cells.f;
      if (!isFrameCell(frame)) throw new Error('Missing UML frame');
      const snapshot: CellStore = {
        ...store,
        cells: {
          ...store.cells,
          f: { ...frame, view: { theme: { themeColorMode: mode } } },
        },
      };
      for (const appearance of ['light', 'dark'] as const) {
        const theme = resolveBoardTheme({ themeColorMode: mode }, appearance);
        await render(snapshot, appearance);
        expect(
          controller.current!.resolveAppearance('relation')?.strokeColor,
        ).toBe(resolveThemeSeries(theme, 0, 'normal', 'overlay').strokeColor);
        ['class', 'interface', 'abstract', 'enum'].forEach((id, ordinal) => {
          const element = container.querySelector(`[data-cell-id="${id}"]`)!;
          const body = element.querySelector('[data-uml-class-body]')!;
          const header = element.querySelector('[data-uml-class-header]')!;
          const bodyTone = resolveThemeSeries(
            theme,
            ordinal,
            'node',
            'overlay',
          );
          const headerTone = resolveThemeSeries(
            theme,
            ordinal,
            'emphasis',
            'overlay',
          );
          expect(body.getAttribute('fill')).toBe(bodyTone.fill);
          expect(header.getAttribute('fill')).toBe(headerTone.fill);
          expect(bodyTone.fill).not.toBe(headerTone.fill);
          expect(controller.current!.resolveAppearance(id)?.fill).toBe(
            bodyTone.fill,
          );
          expect(
            colorContrast(
              headerTone.textColor,
              compositeThemeFill(headerTone.fill, theme.background),
            ),
          ).toBeGreaterThanOrEqual(4.5);
          for (const member of element.querySelectorAll<HTMLDivElement>(
            '[data-uml-class] foreignObject > div',
          )) {
            expect(member.style.color).toBe(cssColor(bodyTone.textColor));
            expect(
              colorContrast(
                bodyTone.textColor,
                compositeThemeFill(bodyTone.fill, theme.background),
              ),
            ).toBeGreaterThanOrEqual(4.5);
          }
          for (const classifier of element.querySelectorAll(
            '[data-uml-class] > text',
          ))
            expect(classifier.getAttribute('fill')).toBe(headerTone.textColor);
        });
      }
    }
    const edited = applyCellOperations(
      store,
      updateCellAppearance(store, ['class'], {
        fill: '#ffffff',
        strokeColor: '#123456',
      }),
      registry,
    );
    await render(edited, 'dark');
    expect(controller.current!.resolveAppearance('relation')?.strokeColor).toBe(
      resolveThemeSeries(
        resolveBoardTheme(undefined, 'dark'),
        0,
        'normal',
        'overlay',
      ).strokeColor,
    );
    const editedClass = container.querySelector('[data-cell-id="class"]')!;
    for (const rect of editedClass.querySelectorAll(
      '[data-uml-class] > rect',
    )) {
      expect(rect.getAttribute('fill')).toBe('#ffffff');
      expect(rect.getAttribute('stroke')).toBe('#123456');
    }
    for (const member of editedClass.querySelectorAll<HTMLDivElement>(
      '[data-uml-class] foreignObject > div',
    ))
      expect(member.style.color).toBe(cssColor('#0f172a'));
    const reset = applyCellOperations(
      edited,
      updateCellAppearance(edited, ['class'], {
        fill: undefined,
        strokeColor: undefined,
        colorSources: { fill: 'theme', strokeColor: 'theme' },
      }),
      registry,
    );
    await render(reset, 'dark');
    const theme = resolveBoardTheme(undefined, 'dark');
    expect(
      container
        .querySelector('[data-cell-id="class"] [data-uml-class-body]')
        ?.getAttribute('fill'),
    ).toBe(resolveThemeSeries(theme, 0, 'node', 'overlay').fill);
    expect(
      container
        .querySelector('[data-cell-id="class"] [data-uml-class-header]')
        ?.getAttribute('fill'),
    ).toBe(resolveThemeSeries(theme, 0, 'emphasis', 'overlay').fill);
    await render(store);
    expect(
      container
        .querySelector('[data-cell-id="class"] [data-uml-class-body]')
        ?.getAttribute('fill'),
    ).toBe('#ff00ff');
    expect(container.querySelector('[data-uml-class-header]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(JSON.stringify(store)).toBe(before);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('shares sequence families across participant parts and messages and reassigns them with participant order', async () => {
  const registry = createTestCellRegistry();
  const extensions = createUmlFrameExtensions(registry);
  let store = createUmlSequenceFrameSnapshot('f', 'root').store;
  for (const [id, actorType] of [
    ['actor', 'actor'],
    ['participant', 'participant'],
  ] as const)
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlParticipantCell(id, actorType)),
      registry,
    );
  store = applyCellOperations(
    store,
    addUmlCell(
      store,
      'f',
      createUmlMessageCell('message', 'actor', 'participant'),
    ),
    registry,
  );
  for (const operator of ['alt', 'opt', 'loop'] as const)
    store = applyCellOperations(
      store,
      addUmlCell(store, 'f', createUmlFragmentCell(operator, operator)),
      registry,
    );
  store = applyCellOperations(
    store,
    addUmlCell(store, 'f', createUmlNoteCell('note', ['participant'])),
    registry,
  );
  let n = 0;
  store = applyCellOperations(
    store,
    addUmlActivation(
      store,
      'f',
      'participant',
      0,
      1,
      () => `theme-event-${n++}`,
    ),
    registry,
  );
  const original = JSON.stringify(store);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const controller = createRef<FrameCanvasController>();
  const render = async (snapshot: CellStore, appearance: 'light' | 'dark') =>
    act(async () =>
      root.render(
        <FrameCanvas
          ref={controller}
          value={{ store: snapshot }}
          registry={registry}
          extensions={extensions}
          appearance={appearance}
          autoFit={false}
        />,
      ),
    );
  try {
    for (const mode of Object.values(ThemeColorMode)) {
      const snapshot = {
        ...store,
        cells: {
          ...store.cells,
          f: { ...store.cells.f, view: { theme: { themeColorMode: mode } } },
        },
      };
      for (const appearance of ['light', 'dark'] as const) {
        const theme = resolveBoardTheme({ themeColorMode: mode }, appearance);
        await render(snapshot, appearance);
        expect(
          container
            .querySelector('[data-cell-id="actor"] circle')
            ?.getAttribute('fill'),
        ).toBe('none');
        const participant = container.querySelector(
          '[data-cell-id="participant"]',
        )!;
        expect(
          participant
            .querySelector('[data-uml-lifeline] > rect')
            ?.getAttribute('fill'),
        ).toBe(resolveThemeSeries(theme, 1, 'node', 'overlay').fill);
        expect(
          participant
            .querySelector('[data-uml-activation]')
            ?.getAttribute('fill'),
        ).toBe(resolveThemeSeries(theme, 1, 'emphasis', 'overlay').fill);
        expect(
          controller.current!.resolveAppearance('message')?.strokeColor,
        ).toBe(resolveThemeSeries(theme, 0, 'node', 'overlay').strokeColor);
        expect(
          container.querySelector('[data-uml-note]')?.getAttribute('fill'),
        ).toBe(resolveThemeRole(theme, 'annotation', 'node', 'overlay').fill);
        for (const [operator, role] of [
          ['alt', 'tertiary'],
          ['opt', 'secondary'],
          ['loop', 'primary'],
        ] as const) {
          const fragment = container.querySelector(
            `[data-cell-id="${operator}"] [data-uml-fragment]`,
          )!;
          expect(fragment.getAttribute('fill')).toBe('none');
          expect(
            fragment
              .querySelector('[data-uml-fragment-label]')
              ?.getAttribute('fill'),
          ).toBe(resolveThemeRole(theme, role, 'emphasis').fill);
        }
      }
    }
    const custom = applyCellOperations(
      store,
      updateCellAppearance(store, ['actor', 'participant', 'alt'], {
        fill: '#ffffff',
        strokeColor: '#123456',
      }),
      registry,
    );
    await render(custom, 'dark');
    const participant = container.querySelector(
      '[data-cell-id="participant"]',
    )!;
    expect(
      participant
        .querySelector('[data-uml-lifeline] > rect')
        ?.getAttribute('fill'),
    ).toBe('#ffffff');
    expect(
      participant.querySelector('[data-uml-activation]')?.getAttribute('fill'),
    ).toBe('#ffffff');
    expect(
      participant
        .querySelector('[data-uml-lifeline] > line')
        ?.getAttribute('stroke'),
    ).toBe('#123456');
    expect(
      container
        .querySelector('[data-cell-id="actor"] circle')
        ?.getAttribute('fill'),
    ).toBe('#ffffff');
    expect(
      container
        .querySelector('[data-cell-id="actor"] [data-uml-lifeline] > g')
        ?.getAttribute('fill'),
    ).toBe('none');
    expect(
      container
        .querySelector('[data-cell-id="alt"] [data-uml-fragment-label]')
        ?.getAttribute('fill'),
    ).toBe('#ffffff');
    expect(controller.current!.resolveAppearance('message')?.strokeColor).toBe(
      resolveThemeSeries(resolveBoardTheme(undefined, 'dark'), 0).strokeColor,
    );
    const rootCell = store.cells.root;
    if (!isNodeCell(rootCell)) throw new Error('Missing UML root');
    const reordered = {
      ...store,
      cells: {
        ...store.cells,
        root: {
          ...rootCell,
          data: {
            ...(rootCell.data as UmlSequenceData),
            participantIds: ['participant', 'actor'],
          },
        },
      },
    };
    await render(reordered, 'light');
    const theme = resolveBoardTheme(undefined, 'light');
    expect(controller.current!.resolveAppearance('participant')?.fill).toBe(
      resolveThemeSeries(theme, 0, 'node', 'overlay').fill,
    );
    expect(controller.current!.resolveAppearance('message')?.strokeColor).toBe(
      resolveThemeSeries(theme, 1, 'node', 'overlay').strokeColor,
    );
    const actor = store.cells.actor;
    if (!isNodeCell(actor)) throw new Error('Missing actor');
    const overridden = {
      ...actor,
      appearance: {
        fill: '#ffffff',
        colorSources: { fill: 'custom' as const },
      },
    };
    const lifeline = resolveUmlPartAppearance(
      {
        cell: overridden,
        store,
        frameId: 'f',
        theme: resolveBoardTheme(undefined, 'dark'),
      },
      'lifeline',
    );
    expect(lifeline.fill).toBe('none');
    expect(
      colorContrast(
        lifeline.strokeColor!,
        resolveBoardTheme(undefined, 'dark').background,
      ),
    ).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(store)).toBe(original);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('uses fragment label contrast for its common text presentation', () => {
  const registry = createTestCellRegistry();
  const { store } = createUmlSequenceFrameSnapshot('f', 'r');
  const cell = createUmlFragmentCell('fragment', 'loop');
  const theme = resolveBoardTheme(
    { themeColorMode: ThemeColorMode.retro },
    'dark',
  );
  const extension = createUmlFrameExtensions(registry).find(
    (value) => value.kind === 'uml-fragment',
  )!;
  const context = { store, cell, frameId: 'f', theme } as FrameRenderContext;
  const label = resolveUmlPartAppearance(context, 'fragment-label');
  expect(extension.presentation!(context)?.color).toBe(label.textColor);
  expect(colorContrast(label.fill!, label.textColor!)).toBeGreaterThanOrEqual(
    4.5,
  );
});
