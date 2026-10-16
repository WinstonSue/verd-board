import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  CellKind,
  createCellRegistry,
  createFrameCell,
  type FrameSnapshot,
  type NodeCell,
} from '@sue/board-core';
import type { FrameCanvasController, FrameCanvasProps } from '@sue/board-react';
import { I18nProvider } from '../i18n';
import {
  PresentationMode,
  type PresentationModeProps,
} from './presentation-mode';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const probe = vi.hoisted(() => ({
  props: null as FrameCanvasProps | null,
  renders: 0,
  fitCells: vi.fn<FrameCanvasController['fitCells']>(() => true),
  fitBounds: vi.fn<FrameCanvasController['fitBounds']>(),
  getContentBounds: vi.fn(() => ({ x: 10, y: 20, width: 300, height: 200 })),
  spaceDown: vi.fn(),
  spaceUp: vi.fn(),
}));
vi.mock('@sue/board-react', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    FrameCanvas: forwardRef<FrameCanvasController, FrameCanvasProps>(
      function Canvas(props, ref) {
        probe.props = props;
        probe.renders += 1;
        useImperativeHandle(
          ref,
          () =>
            ({
              fitCells: probe.fitCells,
              fitBounds: probe.fitBounds,
              getContentBounds: probe.getContentBounds,
            }) as unknown as FrameCanvasController,
        );
        return (
          <button
            type="button"
            data-testid="canvas-probe"
            onKeyDown={(event) => {
              if (event.code === 'Space') probe.spaceDown();
            }}
            onKeyUp={(event) => {
              if (event.code === 'Space') probe.spaceUp();
            }}
          />
        );
      },
    ),
  };
});

const node = (id: string, kind: string = CellKind.mindChild): NodeCell => ({
  id,
  kind,
  cellType: 'node',
  geometry: { x: 0, y: 0, width: 100, height: 40 },
});
const snapshot = (): FrameSnapshot => ({
  store: {
    rootId: 'frame',
    cells: {
      frame: {
        ...createFrameCell('frame'),
        children: [
          'root',
          'a',
          'b',
          'a-child',
          'other',
          'root-a',
          'root-b',
          'a-child-edge',
        ],
      },
      root: node('root', CellKind.mindRoot),
      a: node('a'),
      b: node('b'),
      'a-child': node('a-child'),
      other: node('other', 'rectangle'),
      'root-a': {
        id: 'root-a',
        kind: CellKind.mindBranch,
        cellType: 'edge',
        source: { cellId: 'root' },
        target: { cellId: 'a' },
        route: { mode: 'auto' },
        data: { order: '10' },
      },
      'root-b': {
        id: 'root-b',
        kind: CellKind.mindBranch,
        cellType: 'edge',
        source: { cellId: 'root' },
        target: { cellId: 'b' },
        route: { mode: 'auto' },
        data: { order: '20' },
      },
      'a-child-edge': {
        id: 'a-child-edge',
        kind: CellKind.mindBranch,
        cellType: 'edge',
        source: { cellId: 'a' },
        target: { cellId: 'a-child' },
        route: { mode: 'auto' },
        data: { order: '10' },
      },
    },
  },
});

let root: Root;
let host: HTMLDivElement;
let full: Element | null;
let resizeCallbacks: (() => void)[];
let fonts: EventTarget & { ready: Promise<void> };
let exitFullscreen: ReturnType<typeof vi.fn>;
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
const originalFull = Object.getOwnPropertyDescriptor(
  document,
  'fullscreenElement',
);
const originalExit = Object.getOwnPropertyDescriptor(
  document,
  'exitFullscreen',
);

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
  vi.clearAllMocks();
  probe.fitCells.mockReturnValue(true);
  probe.renders = 0;
  probe.props = null;
  full = null;
  resizeCallbacks = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fonts,
  });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => full,
  });
  exitFullscreen = vi.fn(async () => {
    full = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: exitFullscreen,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root.unmount());
  await Promise.resolve();
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const [key, descriptor] of [
    ['fonts', originalFonts],
    ['fullscreenElement', originalFull],
    ['exitFullscreen', originalExit],
  ] as const) {
    if (descriptor) Object.defineProperty(document, key, descriptor);
    else Reflect.deleteProperty(document, key);
  }
});

const render = async (
  overrides: Partial<PresentationModeProps> = {},
  strict = false,
) => {
  const props: PresentationModeProps = {
    value: snapshot(),
    fullscreenRoot: host,
    onExit: vi.fn(),
    ...overrides,
  };
  const tree = (
    <I18nProvider language="en" persistLanguage={false}>
      <PresentationMode {...props} />
    </I18nProvider>
  );
  await act(async () => {
    root.render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  });
  act(() => vi.advanceTimersByTime(16));
  return props;
};
const surface = () =>
  host.querySelector<HTMLElement>('[data-testid="presentation-mode"]')!;
const hud = () =>
  host.querySelector<HTMLElement>('[data-testid="presentation-hud"]')!;
const canvas = () =>
  host.querySelector<HTMLElement>('[data-testid="canvas-probe"]')!;
const button = (label: string) =>
  hud().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const counter = () =>
  host.querySelector('[data-testid="presentation-step"]')?.textContent;
const key = (
  key: string,
  options: KeyboardEventInit = {},
  target: EventTarget = surface(),
  type = 'keydown',
) => {
  const event = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    key,
    ...options,
  });
  act(() => target.dispatchEvent(event));
  return event;
};
const tap = (id: string | null) => act(() => probe.props!.onPresentTap!(id));
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('PresentationMode', () => {
  it('passes the original readonly canvas inputs and begins at padded overview', async () => {
    const value = snapshot(),
      registry = createCellRegistry(),
      extensions: FrameCanvasProps['extensions'] = [];
    const interactionSettings: FrameCanvasProps['interactionSettings'] = {};
    await render({ value, registry, extensions, interactionSettings });
    expect(probe.props).toMatchObject({
      value,
      registry,
      extensions,
      interactionSettings,
      readonly: true,
      inputMode: 'present',
      tool: { mode: 'hand' },
      autoFit: false,
    });
    expect(probe.props!.value).toBe(value);
    expect(probe.props!.extensions).toBe(extensions);
    expect(probe.props!.onChange).toBeUndefined();
    expect(probe.props!.runtime).toBeUndefined();
    expect(counter()).toBe('Overview');
    expect(probe.fitBounds).toHaveBeenLastCalledWith(probe.getContentBounds(), {
      animate: false,
      maxZoom: 2,
      insets: { top: 48, right: 48, bottom: 48, left: 48 },
    });
  });

  it('clamps arrows/page/Enter and handles 0/Home, laser and exit within its surface', async () => {
    const props = await render();
    key('ArrowRight');
    expect(counter()).toBe('1 / 2');
    expect(probe.fitCells.mock.lastCall?.[0]).toEqual(['a', 'a-child']);
    key('PageDown');
    key('Enter');
    key('ArrowDown');
    expect(counter()).toBe('2 / 2');
    expect(button('Next').disabled).toBe(true);
    key('ArrowLeft');
    key('PageUp');
    key('ArrowUp');
    expect(counter()).toBe('Overview');
    key('Enter');
    key('Home');
    expect(counter()).toBe('Overview');
    key('Enter');
    key('0');
    expect(counter()).toBe('Overview');
    key('L');
    expect(surface().classList.contains('is-laser')).toBe(true);
    key('l', { repeat: true });
    expect(surface().classList.contains('is-laser')).toBe(true);
    key('l');
    expect(surface().classList.contains('is-laser')).toBe(false);
    key('Escape');
    key('Escape');
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it('synchronizes known taps, preserves index on arbitrary taps and resets blank taps', async () => {
    await render();
    tap('b');
    expect(counter()).toBe('2 / 2');
    tap('other');
    expect(counter()).toBe('2 / 2');
    expect(probe.fitCells.mock.lastCall?.[0]).toEqual(['other']);
    tap('a');
    expect(counter()).toBe('1 / 2');
    tap('a-child');
    expect(counter()).toBe('1 / 2');
    key('ArrowRight');
    expect(counter()).toBe('2 / 2');
    tap(null);
    expect(counter()).toBe('Overview');
  });

  it('returns navigation focus to the surface before a boundary button disables', async () => {
    await render();
    key('ArrowRight');
    act(() => button('Previous').focus());
    act(() => button('Previous').click());
    expect(counter()).toBe('Overview');
    expect(document.activeElement).toBe(surface());
    key('ArrowRight', {}, document.activeElement!);
    expect(counter()).toBe('1 / 2');
    act(() => button('Next').focus());
    act(() => button('Next').click());
    expect(counter()).toBe('2 / 2');
    expect(document.activeElement).toBe(surface());
    key('ArrowLeft', {}, document.activeElement!);
    expect(counter()).toBe('1 / 2');
  });

  it('scopes editing/navigation keys, passes Space down/up to canvas and leaves HUD native activation', async () => {
    const outside = vi.fn(),
      inside = vi.fn();
    document.addEventListener('keydown', outside);
    await render();
    canvas().addEventListener('keydown', inside);
    expect(key('ArrowRight', {}, canvas()).defaultPrevented).toBe(true);
    key('z', { ctrlKey: true }, canvas());
    expect(inside).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled();
    expect(key(' ', { code: 'Space' }, canvas()).defaultPrevented).toBe(false);
    key(' ', { code: 'Space' }, canvas(), 'keyup');
    expect(probe.spaceDown).toHaveBeenCalledTimes(1);
    expect(probe.spaceUp).toHaveBeenCalledTimes(1);
    expect(key(' ', { code: 'Space' }, button('Laser')).defaultPrevented).toBe(
      false,
    );
    expect(key('Enter', {}, button('Laser')).defaultPrevented).toBe(false);
    expect(probe.spaceDown).toHaveBeenCalledTimes(1);
    key('ArrowLeft', {}, window);
    expect(counter()).toBe('1 / 2');
    document.removeEventListener('keydown', outside);
  });

  it('traps Tab/Shift-Tab and keeps HUD visible while a control holds focus', async () => {
    await render();
    key('Tab');
    expect(document.activeElement).toBe(button('Overview'));
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(button('Exit'));
    tick(3000);
    expect(hud().classList.contains('is-hidden')).toBe(false);
    act(() => surface().focus());
    tick(2500);
    expect(hud().classList.contains('is-hidden')).toBe(true);
    const external = document.createElement('button');
    document.body.append(external);
    act(() => external.focus());
    expect(document.activeElement).toBe(surface());
    external.remove();
  });

  it('auto hides at 2500ms, shows a hint only once and avoids pointer-move rerenders', async () => {
    await render();
    expect(host.querySelector('.presentation-hint')?.textContent).toContain(
      'Click to focus',
    );
    tick(2483);
    expect(hud().classList.contains('is-hidden')).toBe(false);
    tick(1);
    expect(hud().classList.contains('is-hidden')).toBe(true);
    expect(host.querySelector('.presentation-hint')).toBeNull();
    act(() =>
      surface().dispatchEvent(new Event('pointermove', { bubbles: true })),
    );
    expect(hud().classList.contains('is-hidden')).toBe(false);
    const count = probe.renders;
    act(() => {
      for (let i = 0; i < 20; i++)
        surface().dispatchEvent(new Event('pointermove', { bubbles: true }));
    });
    expect(probe.renders).toBe(count);
    expect(host.querySelector('.presentation-hint')).toBeNull();
    tick(2500);
    expect(hud().classList.contains('is-hidden')).toBe(true);
  });

  it('omits navigation UI for whiteboards/workflows and permits fullscreen fallback', async () => {
    const props = await render({
      scene: 'workflow-start',
      fullscreenRoot: null,
    });
    expect(counter()).toBeUndefined();
    expect(button('Previous')).toBeNull();
    expect(button('Next')).toBeNull();
    key('ArrowRight');
    expect(probe.fitCells).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(props.onExit).not.toHaveBeenCalled();
    key('Escape');
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it('refits the live target on resize/value/extensions/font changes and falls back when geometry disappears', async () => {
    const props = await render();
    tap('a');
    probe.fitCells.mockClear();
    act(() => resizeCallbacks.forEach((callback) => callback()));
    tick(16);
    expect(probe.fitCells).toHaveBeenLastCalledWith(
      ['a', 'a-child'],
      expect.objectContaining({ animate: false }),
    );
    probe.fitCells.mockClear();
    await render({
      ...props,
      value: {
        store: {
          ...props.value.store,
          cells: {
            ...props.value.store.cells,
            'a-child': { ...props.value.store.cells['a-child'], hidden: true },
          },
        },
      },
    });
    expect(probe.fitCells.mock.lastCall?.[0]).toEqual(['a']);
    probe.fitCells.mockClear();
    await render({ ...props, extensions: [] });
    expect(probe.fitCells).toHaveBeenCalled();
    probe.fitCells.mockClear();
    act(() => fonts.dispatchEvent(new Event('loadingdone')));
    tick(16);
    expect(probe.fitCells).toHaveBeenCalled();
    probe.fitCells.mockReturnValue(false);
    probe.fitBounds.mockClear();
    act(() => window.dispatchEvent(new Event('resize')));
    tick(16);
    expect(probe.fitBounds).toHaveBeenCalledWith(
      probe.getContentBounds(),
      expect.objectContaining({ animate: false, maxZoom: 2 }),
    );
  });

  it('waits for actual fullscreen entry before treating fullscreenchange as exit', async () => {
    const props = await render();
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    expect(props.onExit).not.toHaveBeenCalled();
    full = host;
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    expect(props.onExit).not.toHaveBeenCalled();
    full = null;
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it('does not exit fullscreen on StrictMode cleanup or value updates, and cleans only its own owner on actual unmount', async () => {
    full = host;
    const props = await render({}, true);
    await Promise.resolve();
    expect(exitFullscreen).not.toHaveBeenCalled();
    await render({ ...props, value: snapshot() }, true);
    await Promise.resolve();
    expect(exitFullscreen).not.toHaveBeenCalled();
    act(() => root.unmount());
    await Promise.resolve();
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    root = createRoot(host);
    await render();
    full = document.body;
    act(() => root.unmount());
    await Promise.resolve();
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });
});
