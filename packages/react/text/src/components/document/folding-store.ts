export interface DocumentFoldingAdapter {
  getSnapshot(): ReadonlyMap<string, boolean>;
  setCollapsed(id: string, collapsed: boolean): void;
  subscribe(listener: () => void): () => void;
}
export function createDocumentFoldingStore(
  initial?: Iterable<readonly [string, boolean]>,
  onChange?: (values: ReadonlyMap<string, boolean>) => void,
): DocumentFoldingAdapter {
  let values = new Map(initial);
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => values,
    setCollapsed(id, collapsed) {
      if (values.get(id) === collapsed) return;
      values = new Map(values).set(id, collapsed);
      onChange?.(values);
      listeners.forEach((fn) => fn());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
export function createDocumentFoldingRegistry(persistence?: {
  read(key: string): Iterable<readonly [string, boolean]>;
  write(key: string, values: ReadonlyMap<string, boolean>): void;
}) {
  const views = new Map<string, DocumentFoldingAdapter>();
  return (key: string) => {
    let view = views.get(key);
    if (!view) {
      view = createDocumentFoldingStore(persistence?.read(key), (values) =>
        persistence?.write(key, values),
      );
      views.set(key, view);
    }
    return view;
  };
}
