import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createFrameNativeEvents } from './frame-native-events';

describe('cached native event forwarding', () => {
  it('avoids constructing unchanged JSX until an event needs the latest callback', () => {
    const events = createFrameNativeEvents(),
      calls: string[] = [];
    const first = events.update(
      'a',
      <g onPointerDown={() => calls.push('old')} />,
    ) as React.ReactElement<{ onPointerDown(): void }>;
    const render = vi.fn(() => (
      <g onPointerDown={() => calls.push('latest')} />
    ));
    events.setRender('a', render);
    expect(render).not.toHaveBeenCalled();
    first.props.onPointerDown();
    first.props.onPointerDown();
    expect(render).toHaveBeenCalledOnce();
    expect(calls).toEqual(['latest', 'latest']);
  });
  it('reuses event functions but forwards arguments and results to the latest scene callback', async () => {
    const events = createFrameNativeEvents(),
      first = vi.fn(() => 'old'),
      latest = vi.fn(
        async (event: React.PointerEvent<SVGGElement>) =>
          `current-${event.clientX}`,
      );
    const oldNode = events.update(
      'a',
      <g onPointerDown={first} />,
    ) as React.ReactElement<{
      onPointerDown(event: React.PointerEvent<SVGGElement>): Promise<string>;
    }>;
    const next = events.update(
      'a',
      <g onPointerDown={latest} />,
    ) as typeof oldNode;
    expect(next.props.onPointerDown).toBe(oldNode.props.onPointerDown);
    const event = { clientX: 12 } as React.PointerEvent<SVGGElement>;
    expect(await oldNode.props.onPointerDown(event)).toBe('current-12');
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(event);
  });
  it('keeps keyed port callbacks fresh through reordering, and recreates them after deletion', () => {
    const events = createFrameNativeEvents(),
      calls: string[] = [];
    const render = (ports: string[], version: string) => (
      <g>
        {ports.map((id) => (
          <circle key={id} onPointerDown={() => calls.push(version + id)} />
        ))}
      </g>
    );
    const first = events.update(
      'a',
      render(['p', 'q'], 'old'),
    ) as React.ReactElement<{
      children: React.ReactElement<{ onPointerDown(): void }>[];
    }>;
    const previous = first.props.children.map(
      (node) => node.props.onPointerDown,
    );
    events.update('a', render(['q', 'p'], 'new'));
    previous.forEach((handler) => handler());
    expect(calls).toEqual(['newp', 'newq']);
    events.prune(() => false);
    const next = events.update(
      'a',
      render(['p', 'q'], 'restored'),
    ) as typeof first;
    expect(next.props.children[0].props.onPointerDown).not.toBe(previous[0]);
  });
});
