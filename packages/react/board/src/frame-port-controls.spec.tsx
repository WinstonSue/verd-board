import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { FrameControlHandle, FrameControlLayer } from './frame-port-controls';
import { FRAME_MOVE_CURSOR } from './frame-control-cursor';
import { createFrameCameraStore } from './frame-camera-store';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

it('keeps the owner across sibling controls and a queued control-to-body leave', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const camera = createFrameCameraStore({ zoom: 1 }, 'root');
  const states: (string | null)[] = [];
  camera.subscribeCell('node', () => states.push(camera.getHoveredId()));
  await act(() =>
    root.render(
      <svg>
        <g data-cell-id="node">
          <rect />
        </g>
        <FrameControlLayer camera={camera}>
          <g data-port-node-id="node">
            <FrameControlHandle
              controlKey="port"
              point={[0, 0]}
              scale={1}
              onPointerDown={() => {}}
            />
          </g>
          <g data-port-node-id="node">
            <FrameControlHandle
              controlKey="other-port"
              point={[40, 0]}
              scale={1}
              onPointerDown={() => {}}
            />
          </g>
        </FrameControlLayer>
      </svg>,
    ),
  );
  const hits = [
    ...container.querySelectorAll<SVGCircleElement>('[data-control-hit]'),
  ];
  const body = container.querySelector('rect')!;
  hits.forEach((hit) =>
    Object.defineProperty(hit, 'getScreenCTM', {
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 100, f: 50 }),
    }),
  );
  let physical: Element = hits[0];
  const singleDescriptor = Object.getOwnPropertyDescriptor(
    document,
    'elementFromPoint',
  );
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => physical,
  });
  const descriptor = Object.getOwnPropertyDescriptor(
    document,
    'elementsFromPoint',
  );
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => [physical],
  });
  cleanups.push(async () => {
    await act(() => root.unmount());
    container.remove();
    if (descriptor)
      Object.defineProperty(document, 'elementsFromPoint', descriptor);
    else Reflect.deleteProperty(document, 'elementsFromPoint');
    if (singleDescriptor)
      Object.defineProperty(document, 'elementFromPoint', singleDescriptor);
    else Reflect.deleteProperty(document, 'elementFromPoint');
  });
  const move = (hit: SVGCircleElement, x: number) =>
    hit.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: 50 }),
    );
  await act(() => move(hits[0], 100));
  physical = hits[1];
  await act(() => move(hits[1], 140));
  expect(states).toEqual(['node']);
  physical = body;
  await act(async () => {
    camera.setHovered('node');
    hits[1].dispatchEvent(
      new MouseEvent('pointerout', {
        bubbles: true,
        relatedTarget: body,
        clientX: 140,
        clientY: 50,
      }),
    );
    await Promise.resolve();
  });
  expect(camera.getHoveredId()).toBe('node');
  expect(states).toEqual(['node']);
  expect(hits[1].parentElement!.getAttribute('data-control-hovered')).toBe(
    'false',
  );
  camera.leave('node');
  expect(states).toEqual(['node', null]);
});

it.each([
  {
    name: 'nearest screen center',
    x: 4,
    otherX: 10,
    selected: false,
    kind: 'port' as const,
  },
  {
    name: 'selected on equal distance',
    x: 10,
    otherX: 10,
    selected: true,
    kind: 'port' as const,
  },
  {
    name: 'port before a route point',
    x: 10,
    otherX: 10,
    selected: false,
    kind: 'point' as const,
  },
  {
    name: 'stable identity on equal priority',
    x: 10,
    otherX: 10,
    selected: false,
    kind: 'port' as const,
  },
  {
    name: 'selected endpoint before a closer port on its node',
    x: 10,
    otherX: 5,
    selected: true,
    kind: 'port' as const,
    nodeId: 'node-a',
    otherNodeId: 'node-a',
  },
  {
    name: 'nearest port on an unrelated node',
    x: 10,
    otherX: 5,
    selected: true,
    kind: 'port' as const,
    nodeId: 'node-a',
    otherNodeId: 'node-b',
    expectChosen: false,
  },
])(
  'uses $name when the browser targets a different overlapping circle',
  async (options) => {
    const { name, x, otherX, selected, kind } = options;
    const nodeId = 'nodeId' in options ? options.nodeId : undefined;
    const otherNodeId =
      'otherNodeId' in options ? options.otherNodeId : undefined;
    const expectChosen = !('expectChosen' in options) || options.expectChosen;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const chosen = vi.fn(),
      covered = vi.fn();
    await act(async () =>
      root.render(
        <svg>
          <FrameControlLayer>
            <FrameControlHandle
              controlKey={
                name === 'stable identity on equal priority' ? 'a' : 'z'
              }
              point={[0, 0]}
              scale={2}
              selected={selected}
              nodeId={nodeId}
              endpoint={!!nodeId}
              onPointerDown={chosen}
            />
            <FrameControlHandle
              controlKey={
                name === 'stable identity on equal priority' ? 'z' : 'a'
              }
              point={[otherX, 0]}
              scale={2}
              kind={kind}
              nodeId={otherNodeId}
              cursor="crosshair"
              onPointerDown={covered}
            />
          </FrameControlLayer>
        </svg>,
      ),
    );
    const hits = [
      ...container.querySelectorAll<SVGCircleElement>('[data-control-hit]'),
    ];
    hits.forEach((hit) =>
      Object.defineProperty(hit, 'getScreenCTM', {
        value: () => ({ a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 }),
      }),
    );
    const descriptor = Object.getOwnPropertyDescriptor(
      document,
      'elementsFromPoint',
    );
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [...hits].reverse(),
    });
    cleanups.push(async () => {
      await act(async () => root.unmount());
      container.remove();
      if (descriptor)
        Object.defineProperty(document, 'elementsFromPoint', descriptor);
      else Reflect.deleteProperty(document, 'elementsFromPoint');
    });
    const fire = (type: string, button = 0) =>
      hits[1].dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          button,
          clientX: 100 + x,
          clientY: 50,
        }),
      );
    await act(async () => fire('pointermove'));
    const winner = expectChosen ? 0 : 1;
    const layer = container.querySelector<SVGSVGElement>('svg')!;
    expect(layer.style.getPropertyValue('--frame-control-cursor')).toBe(
      expectChosen ? FRAME_MOVE_CURSOR : 'crosshair',
    );
    expect(
      hits[winner].parentElement!.getAttribute('data-control-hovered'),
    ).toBe('true');
    expect(
      hits[1 - winner].parentElement!.getAttribute('data-control-hovered'),
    ).toBe('false');
    await act(async () => fire('pointerdown'));
    await act(async () => fire('pointerdown', 2));
    expect(expectChosen ? chosen : covered).toHaveBeenCalledTimes(2);
    expect((expectChosen ? chosen : covered).mock.calls[1][0].button).toBe(2);
    expect(expectChosen ? covered : chosen).not.toHaveBeenCalled();
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [],
    });
    await act(async () => fire('pointerout'));
    expect(layer.style.getPropertyValue('--frame-control-cursor')).toBe('');
  },
);

it('updates a hovered cursor after selection changes without moving the pointer', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const render = (cursor: string) =>
    root.render(
      <svg>
        <FrameControlLayer>
          <FrameControlHandle
            controlKey="port"
            point={[0, 0]}
            scale={1}
            cursor={cursor}
            onPointerDown={() => {}}
          />
        </FrameControlLayer>
      </svg>,
    );
  await act(async () => render('move'));
  const hit = container.querySelector('[data-control-hit]')!;
  await act(async () =>
    hit.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })),
  );
  const layer = container.querySelector<SVGSVGElement>('svg')!;
  expect(layer.style.getPropertyValue('--frame-control-cursor')).toBe(
    FRAME_MOVE_CURSOR,
  );
  await act(async () => render('not-allowed'));
  expect(layer.style.getPropertyValue('--frame-control-cursor')).toBe(
    'not-allowed',
  );
});

it('reconciles hover and pointerdown when a stationary port migrates to the selected layer', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const nodeDown = vi.fn(),
    edgeDown = vi.fn();
  const matrixDescriptor = Object.getOwnPropertyDescriptor(
    SVGElement.prototype,
    'getScreenCTM',
  );
  const pointDescriptor = Object.getOwnPropertyDescriptor(
    document,
    'elementsFromPoint',
  );
  Object.defineProperty(SVGElement.prototype, 'getScreenCTM', {
    configurable: true,
    value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  });
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => [...container.querySelectorAll('[data-control-hit]')],
  });
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
    if (matrixDescriptor)
      Object.defineProperty(
        SVGElement.prototype,
        'getScreenCTM',
        matrixDescriptor,
      );
    else Reflect.deleteProperty(SVGElement.prototype, 'getScreenCTM');
    if (pointDescriptor)
      Object.defineProperty(document, 'elementsFromPoint', pointDescriptor);
    else Reflect.deleteProperty(document, 'elementsFromPoint');
  });
  const render = (selected: boolean) =>
    root.render(
      <svg>
        <FrameControlLayer>
          <g key={selected ? 'overlay' : 'ordinary'}>
            <FrameControlHandle
              controlKey={selected ? 'edge' : 'node'}
              point={[0, 0]}
              scale={1}
              selected={selected}
              onPointerDown={selected ? edgeDown : nodeDown}
            />
          </g>
        </FrameControlLayer>
      </svg>,
    );
  await act(async () => render(false));
  const oldHit = container.querySelector('[data-control-hit]')!;
  await act(async () =>
    oldHit.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })),
  );
  await act(async () => render(true));
  const hit = container.querySelector('[data-control-hit]')!;
  expect(hit).not.toBe(oldHit);
  expect(hit.parentElement!.getAttribute('data-control-hovered')).toBe('true');
  expect(
    container
      .querySelector<SVGSVGElement>('svg')!
      .style.getPropertyValue('--frame-control-cursor'),
  ).toBe(FRAME_MOVE_CURSOR);
  await act(async () =>
    hit.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })),
  );
  expect(edgeDown).toHaveBeenCalledOnce();
  expect(nodeDown).not.toHaveBeenCalled();
});

it.each([0, 14])(
  'hands only transparent port padding to node dragging (distance=%s)',
  async (distance) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const portDown = vi.fn();
    const bodyDown = vi.fn((event: React.PointerEvent<SVGElement>) => {
      event.preventDefault();
      event.stopPropagation();
      return true;
    });
    await act(() =>
      root.render(
        <svg>
          <g data-cell-id="selected">
            <rect width="100" height="40" />
          </g>
          <FrameControlLayer onNodeBodyPointerDown={bodyDown}>
            <FrameControlHandle
              controlKey="port"
              point={[0, 0]}
              scale={1}
              radius={5}
              visible
              nodeId="selected"
              onPointerDown={portDown}
            />
          </FrameControlLayer>
        </svg>,
      ),
    );
    const hit =
      container.querySelector<SVGCircleElement>('[data-control-hit]')!;
    hit.getScreenCTM = () =>
      ({ a: 1, b: 0, c: 0, d: 1, e: 100, f: 50 }) as DOMMatrix;
    const body = container.querySelector('rect')!;
    const descriptor = Object.getOwnPropertyDescriptor(
      document,
      'elementsFromPoint',
    );
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [hit, body],
    });
    cleanups.push(async () => {
      await act(() => root.unmount());
      container.remove();
      if (descriptor)
        Object.defineProperty(document, 'elementsFromPoint', descriptor);
      else Reflect.deleteProperty(document, 'elementsFromPoint');
    });
    await act(() =>
      hit.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: 100 + distance,
          clientY: 50,
        }),
      ),
    );
    expect(bodyDown).toHaveBeenCalledTimes(distance ? 1 : 0);
    expect(portDown).toHaveBeenCalledTimes(distance ? 0 : 1);
  },
);
