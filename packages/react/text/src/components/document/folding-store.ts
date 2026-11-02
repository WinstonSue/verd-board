export interface DocumentFoldingAdapter {
  getSnapshot(): ReadonlyMap<string, boolean>;
  setCollapsed(id: string, collapsed: boolean): void;
  subscribe(listener: () => void): () => void;
}
export function createDocumentFoldingStore(): DocumentFoldingAdapter {
  let values = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => values,
    setCollapsed(id, collapsed) {
      if (values.get(id) === collapsed) return;
      values = new Map(values).set(id, collapsed);
      listeners.forEach((fn) => fn());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
export function createDocumentFoldingRegistry() {
  const views = new Map<string, DocumentFoldingAdapter>();
  return (key: string) => {
    let view = views.get(key);
    if (!view) {
      view = createDocumentFoldingStore();
      views.set(key, view);
    }
    return view;
  };
}
