import { cloneElement, isValidElement, type ReactNode } from 'react';

/** Only callback-free native bodies use this bridge; extensions/editors stay live. */
export function createFrameNativeEvents() {
  const renders = new Map<string, { render(): ReactNode; dirty: boolean }>();
  const cells = new Map<
    string,
    Map<
      string,
      {
        current: (...args: unknown[]) => unknown;
        forward: (...args: unknown[]) => unknown;
      }
    >
  >();
  const bridge = {
    setRender(cellId: string, render: () => ReactNode) {
      renders.set(cellId, { render, dirty: true });
    },
    update(cellId: string, node: ReactNode): ReactNode {
      const source = renders.get(cellId);
      if (source) source.dirty = false;
      let handlers = cells.get(cellId);
      if (!handlers) cells.set(cellId, (handlers = new Map()));
      const seen = new Set<string>();
      const visit = (node: ReactNode, path: string): ReactNode => {
        if (Array.isArray(node))
          return node.map((child, at) =>
            visit(
              child,
              `${path}/${isValidElement(child) ? (child.key ?? at) : at}`,
            ),
          );
        if (!isValidElement<Record<string, unknown>>(node)) return node;
        const props: Record<string, unknown> = {};
        let changed = false;
        for (const [name, value] of Object.entries(node.props)) {
          if (!/^on[A-Z]/.test(name) || typeof value !== 'function') continue;
          const key = `${path}:${name}`;
          seen.add(key);
          let handler = handlers!.get(key);
          if (!handler) {
            handler = {
              current: value as (...args: unknown[]) => unknown,
              forward: (...args) => {
                const latest = renders.get(cellId);
                if (latest?.dirty) bridge.update(cellId, latest.render());
                const current = handler!.current;
                return current(...args);
              },
            };
            handlers!.set(key, handler);
          } else handler.current = value as (...args: unknown[]) => unknown;
          props[name] = handler.forward;
          changed = true;
        }
        if (
          'children' in node.props &&
          typeof node.props['children'] !== 'function'
        ) {
          const children = visit(
            node.props['children'] as ReactNode,
            path + '/children',
          );
          if (children !== node.props['children']) {
            props['children'] = children;
            changed = true;
          }
        }
        return changed ? cloneElement(node, props) : node;
      };
      const result = visit(node, cellId);
      for (const key of handlers.keys())
        if (!seen.has(key)) handlers.delete(key);
      return result;
    },
    prune(hasCell: (id: string) => boolean) {
      for (const id of cells.keys()) if (!hasCell(id)) cells.delete(id);
      for (const id of renders.keys()) if (!hasCell(id)) renders.delete(id);
    },
  };
  return bridge;
}
