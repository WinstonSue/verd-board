import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrameWheelOwner } from './frame-wheel';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const input = (target: Element, props: WheelEventInit = {}) => {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: 20,
    ...props,
  });
  target.dispatchEvent(event);
  return event;
};
function surface() {
  const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const foreign = document.createElementNS(root.namespaceURI, 'foreignObject');
  const editor = document.createElement('div');
  editor.contentEditable = 'true';
  foreign.append(editor);
  root.append(foreign);
  document.body.append(root);
  const handle = vi.fn(),
    owner = createFrameWheelOwner(handle);
  const cleanup = owner.register(root);
  return { root, editor, owner, handle, cleanup };
}
describe('canvas-owned wheel arbitration', () => {
  it('captures zoom before editable children stop propagation and preserves focus', () => {
    const test = surface();
    test.editor.tabIndex = 0;
    test.editor.focus();
    test.editor.addEventListener('wheel', (event) => event.stopPropagation());
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(input(test.editor, modifier).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(test.editor);
    }
    expect(test.handle).toHaveBeenCalledTimes(2);
    test.cleanup();
    input(test.editor, { ctrlKey: true });
    expect(test.handle).toHaveBeenCalledTimes(2);
  });
  it('lets content consume either axis, pans at both boundaries and ignores clipped overflow', () => {
    const test = surface();
    test.editor.style.overflowY = 'auto';
    test.editor.style.overflowX = 'auto';
    Object.defineProperties(test.editor, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 300 },
      clientWidth: { value: 100 },
      scrollWidth: { value: 300 },
    });
    test.editor.scrollTop = 50;
    expect(input(test.editor).defaultPrevented).toBe(false);
    test.editor.scrollTop = 200;
    expect(input(test.editor).defaultPrevented).toBe(true);
    expect(input(test.editor, { deltaY: -20 }).defaultPrevented).toBe(false);
    test.editor.scrollTop = 0;
    expect(input(test.editor, { deltaY: -20 }).defaultPrevented).toBe(true);
    test.editor.scrollLeft = 50;
    expect(
      input(test.editor, { deltaX: 20, deltaY: -20 }).defaultPrevented,
    ).toBe(false);
    expect(input(test.editor, { ctrlKey: true }).defaultPrevented).toBe(true);
    test.editor.style.overflowX = 'clip';
    test.editor.style.overflowY = 'hidden';
    expect(input(test.editor).defaultPrevented).toBe(true);
    expect(test.handle).toHaveBeenCalledTimes(4);
    test.cleanup();
  });
  it('finds an outer scrollable owner and handles registered portals and nested canvases once', () => {
    const outer = surface(),
      inner = surface();
    outer.editor.append(inner.root);
    input(inner.editor, { ctrlKey: true });
    expect(inner.handle).toHaveBeenCalledOnce();
    expect(outer.handle).not.toHaveBeenCalled();
    const portal = document.createElement('div'),
      toolbar = document.createElement('div');
    portal.append(toolbar);
    document.body.append(portal);
    const releasePortal = outer.owner.register(portal),
      releaseToolbar = outer.owner.register(toolbar);
    input(toolbar, { ctrlKey: true });
    expect(outer.handle).toHaveBeenCalledOnce();
    input(document.body, { ctrlKey: true });
    expect(outer.handle).toHaveBeenCalledOnce();
    releaseToolbar();
    releasePortal();
    outer.cleanup();
    inner.cleanup();
  });
  it('does not measure ordinary SVG nodes', () => {
    const test = surface(),
      shape = document.createElementNS(test.root.namespaceURI, 'rect');
    test.root.append(shape);
    const styles = vi.spyOn(window, 'getComputedStyle');
    input(shape);
    expect(test.handle).toHaveBeenCalledOnce();
    expect(styles).not.toHaveBeenCalled();
    test.cleanup();
  });
});
