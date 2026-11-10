import { afterEach, expect, it, vi } from 'vitest';
import {
  FRAME_MOVE_CURSOR,
  frameCursorController,
  type FrameCursorSource,
} from './frame-control-cursor';

const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup()),
);

function setup() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cursor = 'crosshair';
  document.body.append(svg);
  cleanups.push(() => svg.remove());
  const controller = frameCursorController(svg);
  cleanups.push(controller.attach());
  const source: FrameCursorSource = { reconcile: vi.fn(), leave: vi.fn() };
  return { svg, controller, source };
}

function pointer(type: string, id = 1) {
  const event = new MouseEvent(type, { bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: id });
  return event;
}

it('keeps the accepted gesture cursor above hover and tool updates until its pointer ends', async () => {
  const { svg, controller, source } = setup();
  controller.setBase('grab');
  expect(svg.style.cursor).toBe('grab');
  controller.hover(source, { key: 'endpoint', cursor: 'move' });
  expect(svg.style.cursor).toBe(FRAME_MOVE_CURSOR);
  controller.lock(source, { key: 'endpoint', cursor: 'move' }, 1);
  controller.setBase('crosshair');
  controller.hover(source, { key: 'segment', cursor: 'ew-resize' });
  expect(svg.getAttribute('data-frame-cursor-owner')).toBe('endpoint');
  svg.dispatchEvent(pointer('pointerleave'));
  expect(svg.style.cursor).toBe(FRAME_MOVE_CURSOR);
  controller.hover(source, { key: 'segment', cursor: 'ew-resize' });
  window.dispatchEvent(pointer('pointerup', 2));
  expect(svg.style.cursor).toBe(FRAME_MOVE_CURSOR);
  window.dispatchEvent(pointer('pointerup'));
  await Promise.resolve();
  expect(svg.style.cursor).toBe('ew-resize');
  expect(source.reconcile).toHaveBeenCalledOnce();
  controller.hover(source, null);
  expect(svg.style.cursor).toBe('crosshair');
  expect(svg.style.getPropertyValue('--frame-control-cursor')).toBe('');
});

it.each(['pointercancel', 'blur'])(
  'clears a locked operation on %s',
  (type) => {
    const { svg, controller, source } = setup();
    controller.setBase('grab');
    controller.hover(source, { key: 'endpoint', cursor: 'move' });
    controller.lock(source, { key: 'endpoint', cursor: 'move' }, 1);
    window.dispatchEvent(pointer(type));
    expect(svg.style.cursor).toBe('grab');
    expect(svg.getAttribute('data-frame-cursor-owner')).toBeNull();
    expect(source.leave).toHaveBeenCalledOnce();
  },
);

it('keeps stationary hover through normal lost-capture canvas cleanup', async () => {
  const { svg, controller, source } = setup();
  controller.hover(source, { key: 'endpoint', cursor: 'move' });
  controller.lock(source, { key: 'endpoint', cursor: 'move' }, 1);
  window.dispatchEvent(pointer('pointerup'));
  controller.cancel();
  expect(svg.style.cursor).toBe(FRAME_MOVE_CURSOR);
  expect(svg.getAttribute('data-frame-cursor-mode')).toBe('control');
  await Promise.resolve();
  expect(svg.style.cursor).toBe(FRAME_MOVE_CURSOR);
  expect(source.leave).not.toHaveBeenCalled();
});

it('shares the root writer across layers and restores prior styles after the last owner unmounts', () => {
  const { svg, controller, source } = setup();
  expect(frameCursorController(svg)).toBe(controller);
  const detach = controller.attach();
  controller.setBase('grab');
  controller.hover(source, { key: 'node', cursor: 'move' });
  const other: FrameCursorSource = { reconcile() {}, leave() {} };
  controller.hover(other, { key: 'edge', cursor: 'not-allowed' });
  controller.hover(source, null);
  expect(svg.style.cursor).toBe('not-allowed');
  detach();
  expect(svg.style.cursor).toBe('not-allowed');
  cleanups.pop()!();
  expect(svg.style.cursor).toBe('crosshair');
  expect(svg.getAttribute('data-frame-cursor')).toBeNull();
});

it('uses a naturally sized SVG with a central hotspot and native move fallback', () => {
  expect(FRAME_MOVE_CURSOR).toMatch(/ 12 12, move$/);
  const svg = decodeURIComponent(FRAME_MOVE_CURSOR.split(',')[1].split('"')[0]);
  expect(svg).toContain('width="24" height="24"');
  expect(svg).toContain('stroke="#fff"');
});
