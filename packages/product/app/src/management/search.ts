import type { WorkspaceFile } from '../documents/document-files';
export interface SearchFragment {
  text: string;
  normalized?: string;
  cellId?: string;
  from?: number;
}
export interface SearchRecord {
  id: string;
  title: string;
  path: string;
  revision: string;
  metadata?: string;
  fragments: SearchFragment[];
}
export interface SearchHit {
  id: string;
  title: string;
  path: string;
  revision: string;
  fragment: SearchFragment;
  term: string;
  rank: number;
}
function strings(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const v = value as Record<string, unknown>;
  if (v['type'] === 'frameReference' || v['hidden'] === true) return [];
  if (v['type'] === 'text')
    return typeof v['text'] === 'string' ? [v['text']] : [];
  if (Array.isArray(v['content'])) {
    const parts = v['content'].flatMap(strings);
    return ['paragraph', 'heading', 'codeBlock'].includes(String(v['type']))
      ? [parts.join('')]
      : parts;
  }
  return [];
}
export function searchRevision(file: WorkspaceFile) {
  const value = JSON.stringify(file);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `${value.length}:${hash >>> 0}`;
}
export function extractSearchRecord(
  file: WorkspaceFile,
  path: string,
): SearchRecord {
  const revision = searchRevision(file);
  const metadata = [
    ...(file.properties?.tags ?? []),
    file.properties?.status ?? '',
    file.properties?.source ?? '',
  ].join(' ');
  const fragments: SearchFragment[] = [];
  if (file.format === 'verd-document') {
    type TextNode = { type: string; text?: string; content?: TextNode[] };
    const size = (node: TextNode): number =>
      node.type === 'text'
        ? (node.text?.length ?? 0)
        : ['image', 'hardBreak', 'horizontalRule', 'frameReference'].includes(
              node.type,
            )
          ? 1
          : 2 +
            (node.content ?? []).reduce((sum, child) => sum + size(child), 0);
    const visit = (node: TextNode, position: number) => {
      if (['paragraph', 'heading', 'codeBlock'].includes(node.type)) {
        let text = '',
          start = position + 1,
          offset = 0;
        const flush = () => {
          if (text) fragments.push({ text, from: start });
          text = '';
        };
        for (const child of node.content ?? []) {
          if (child.type === 'text') {
            if (!text) start = position + 1 + offset;
            text += child.text ?? '';
          } else flush();
          offset += size(child);
        }
        flush();
        return;
      }
      let offset = 0;
      for (const child of node.content ?? []) {
        visit(child, position + 1 + offset);
        offset += size(child);
      }
    };
    visit(file.text.content as TextNode, -1);
    for (const fragment of fragments)
      fragment.normalized = fragment.text.toLowerCase();
    return {
      id: file.id,
      title: file.title,
      path,
      revision,
      metadata,
      fragments,
    };
  }
  const walk = (value: unknown, cellId: string, key = '') => {
    if (typeof value === 'string') {
      if (
        [
          'name',
          'label',
          'text',
          'guard',
          'signature',
          'description',
          'value',
          'type',
          'returnType',
        ].includes(key) &&
        value &&
        !value.startsWith('verd://')
      )
        fragments.push({ text: value, cellId });
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, cellId, key));
      return;
    }
    const v = value as Record<string, unknown>;
    if (v['type'] === 'frameReference') return;
    if (
      v['content'] &&
      Array.isArray(v['content']) &&
      typeof v['type'] === 'string'
    ) {
      for (const text of strings(v)) if (text) fragments.push({ text, cellId });
      return;
    }
    for (const [k, item] of Object.entries(v))
      if (
        ![
          'id',
          'plainText',
          'targetFrameId',
          'targetDocumentId',
          'link',
          'href',
          'organization',
        ].includes(k)
      )
        walk(item, cellId, k);
  };
  for (const [id, cell] of Object.entries(file.cells)) {
    if ((cell as unknown as { hidden?: boolean }).hidden) continue;
    walk(cell, id);
  }
  for (const fragment of fragments)
    fragment.normalized = fragment.text.toLowerCase();
  return {
    id: file.frame.id,
    title: file.frame.name ?? '',
    path,
    revision,
    metadata,
    fragments: fragments.filter(
      (f, i, all) =>
        all.findIndex((x) => x.cellId === f.cellId && x.text === f.text) === i,
    ),
  };
}
export function searchRecords(
  records: Iterable<SearchRecord>,
  query: string,
  namesOnly = false,
): SearchHit[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const hits: SearchHit[] = [];
  for (const record of records) {
    const meta =
      `${record.title}\n${record.path}\n${namesOnly ? '' : (record.metadata ?? '')}`.toLocaleLowerCase();
    const fragments = namesOnly ? [] : record.fragments;
    if (
      !terms.every(
        (t) =>
          meta.includes(t) ||
          fragments.some((f) =>
            (f.normalized ?? f.text.toLowerCase()).includes(t),
          ),
      )
    )
      continue;
    const rank = terms.some((t) => meta.includes(t)) ? 0 : 1;
    const base = {
      id: record.id,
      title: record.title,
      path: record.path,
      revision: record.revision,
      rank,
    };
    if (!terms.length || terms.some((t) => meta.includes(t)))
      hits.push({
        ...base,
        fragment: { text: record.path },
        term: terms.find((t) => meta.includes(t)) ?? '',
      });
    fragments.forEach((fragment) => {
      const term = terms.find((t) =>
        (fragment.normalized ?? fragment.text.toLowerCase()).includes(t),
      );
      if (term) {
        const at = (fragment.normalized ?? fragment.text.toLowerCase()).indexOf(
            term,
          ),
          start = Math.max(0, at - 65);
        const snippet = {
          cellId: fragment.cellId,
          text: fragment.text.slice(start, at + term.length + 100),
          from: fragment.from === undefined ? undefined : fragment.from + start,
        };
        hits.push({ ...base, fragment: snippet, term });
      }
    });
  }
  return hits.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
}
