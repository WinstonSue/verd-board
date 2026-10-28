import {
  createCellStore,
  createFrameCell,
  type FrameSnapshot,
} from '@sue/board-core';
import { act, createRef, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FrameCanvasController } from './frame-canvas';
import { FrameEditor } from './frame-editor';
import { createFramePluginSet, type FrameUIPlugin } from './frame-plugins';
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const plugin = (id: string, label: string): FrameUIPlugin => ({
  id,
  engine: { id, install: (registry) => registry.register({ kind: id }) },
  tools: [{ id: `${id}.add`, actionId: `${id}.add` }],
  actions: [
    {
      id: `${id}.add`,
      label,
      effect: 'content',
      execute: (c) =>
        c.runOperations([
          {
            type: 'insert_cell',
            parentId: c.frameId,
            cell: {
              id: c.allocateId(),
              kind: id,
              cellType: 'node',
              geometry: { x: 20, y: 20, width: 100, height: 40 },
              content: { label },
            },
          },
        ]),
    },
  ],
});
const empty = (id: string): FrameSnapshot => ({
  store: createCellStore(createFrameCell(id)),
});
async function surface() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(async () => {
    await act(() => root.unmount());
    host.remove();
  });
  return {
    host,
    render: async (node: React.ReactNode) => {
      await act(() => root.render(node));
    },
  };
}
describe('composable FrameEditor', () => {
  it('keeps plugin and language instances separate under StrictMode', async () => {
    const first = createRef<FrameCanvasController>(),
      second = createRef<FrameCanvasController>();
    const a = [plugin('custom-a', 'Add A')],
      b = [plugin('custom-b', 'Add B')];
    const { host, render } = await surface();
    await render(
      <StrictMode>
        <FrameEditor
          ref={first}
          plugins={a}
          language="en"
          value={empty('a')}
          onChange={() => {}}
          autoFit={false}
        />
        <FrameEditor
          ref={second}
          plugins={b}
          language="zh"
          value={empty('b')}
          onChange={() => {}}
          autoFit={false}
        />
      </StrictMode>,
    );
    expect(first.current!.runtime.registry.get('custom-b')).toBeUndefined();
    expect(second.current!.runtime.registry.get('custom-a')).toBeUndefined();
    expect(host.querySelectorAll('[data-language="en"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-language="zh"]')).toHaveLength(1);
    expect(host.textContent).toContain('Add A');
    expect(host.textContent).toContain('Add B');
  });
  it('routes host rejection and acceptance through the same runtime without adding rejected history', async () => {
    const ref = createRef<FrameCanvasController>(),
      plugins = [plugin('custom', 'Add custom')];
    const { render } = await surface();
    let value = empty('frame'),
      accept = false;
    const paint = () => (
      <FrameEditor
        ref={ref}
        plugins={plugins}
        value={{ snapshot: value }}
        adapter={{ toFrameSnapshot: (host) => host.snapshot }}
        autoFit={false}
        onIntent={async (transaction) => {
          if (!accept)
            return { status: 'rejected' as const, message: 'Denied by host' };
          const { applyCellOperations } = await import('@sue/board-core');
          value = {
            store: applyCellOperations(
              value.store,
              transaction.operations,
              ref.current!.runtime.registry,
            ),
          };
          return { status: 'accepted' as const };
        }}
      />
    );
    await render(paint());
    const before = ref.current!.runtime.store;
    const operation = {
      type: 'insert_cell' as const,
      parentId: 'frame',
      cell: {
        id: 'new',
        kind: 'custom',
        cellType: 'node' as const,
        geometry: { x: 0, y: 0, width: 50, height: 40 },
      },
    };
    await act(async () => {
      expect(
        await ref.current!.dispatch({
          id: 'rejected',
          operations: [operation],
        }),
      ).toMatchObject({ status: 'rejected' });
    });
    expect(ref.current!.runtime.store).toBe(before);
    expect(ref.current!.runtime.history.undos).toHaveLength(0);
    accept = true;
    await act(async () => {
      await ref.current!.dispatch({ id: 'accepted', operations: [operation] });
    });
    await render(paint());
    expect(ref.current!.runtime.store.cells.new).toBeTruthy();
  });
  it('dispatches a custom UI shortcut only inside its editor', async () => {
    const ref = createRef<FrameCanvasController>(),
      { host, render } = await surface();
    const custom = plugin('shortcut-node', 'Add');
    custom.actions = [
      {
        id: 'shortcut-node.add',
        label: 'Add',
        effect: 'content',
        shortcuts: [{ key: 'k', mod: true }],
        execute: (context) => {
          return context.runOperations([
            {
              type: 'insert_cell',
              parentId: context.frameId,
              cell: {
                id: 'shortcut-cell',
                kind: 'shortcut-node',
                cellType: 'node',
                geometry: { x: 0, y: 0, width: 30, height: 30 },
              },
            },
          ]);
        },
      },
    ];
    await render(
      <FrameEditor
        ref={ref}
        plugins={[custom]}
        value={empty('frame')}
        autoFit={false}
        onChange={() => {}}
      />,
    );
    await act(async () => {
      host.querySelector('svg')!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'k',
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(ref.current!.runtime.store.cells['shortcut-cell']).toBeTruthy();
  });
  it('keeps contributions immutable and rejects ambiguous plugin/tool registrations', () => {
    const set = createFramePluginSet([plugin('custom', 'Add')]);
    expect(Object.isFrozen(set)).toBe(true);
    expect(Object.isFrozen(set.plugins)).toBe(true);
    expect(() =>
      createFramePluginSet([plugin('custom', 'A'), plugin('custom', 'B')]),
    ).toThrow('Duplicate frame UI plugin id');
    expect(() => set.registry.register({ kind: 'late' })).toThrow('sealed');
  });
});
