import type { Cell, CellStore } from './types';
import { isFrameCell, isGroupCell } from './types';

const searchableKeys = new Set([
  'name',
  'label',
  'text',
  'guard',
  'signature',
  'description',
  'value',
  'type',
  'returnType',
]);
const excludedKeys = new Set([
  'id',
  'plainText',
  'targetFrameId',
  'targetDocumentId',
  'link',
  'href',
  'organization',
]);

function richText(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const node = value as Record<string, unknown>;
  if (node['type'] === 'frameReference' || node['hidden'] === true) return [];
  if (node['type'] === 'text')
    return typeof node['text'] === 'string' ? [node['text']] : [];
  if (!Array.isArray(node['content'])) return [];
  const parts = node['content'].flatMap(richText);
  return ['paragraph', 'heading', 'codeBlock'].includes(String(node['type']))
    ? [parts.join('')]
    : parts;
}

/** Visible text fields only; never follow links or reference addresses. */
export function cellSearchTexts(cell: Cell): string[] {
  if (cell.hidden) return [];
  const texts = new Set<string>();
  const walk = (value: unknown, key = '') => {
    if (typeof value === 'string') {
      if (searchableKeys.has(key) && value && !value.startsWith('verd://'))
        texts.add(value);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, key));
      return;
    }
    const node = value as Record<string, unknown>;
    if (node['type'] === 'frameReference' || node['hidden'] === true) return;
    if (Array.isArray(node['content']) && typeof node['type'] === 'string') {
      richText(node).forEach((text) => {
        if (text) texts.add(text);
      });
      return;
    }
    for (const [name, item] of Object.entries(node))
      if (!excludedKeys.has(name)) walk(item, name);
  };
  walk(cell);
  return [...texts];
}

/** Search one owned frame tree, even when the store contains other files. */
export function findFrameCells(
  store: CellStore,
  frameId: string,
  query: string,
  caseSensitive = false,
): string[] {
  if (!query) return [];
  const term = caseSensitive ? query : query.toLocaleLowerCase();
  const result: string[] = [];
  const seen = new Set<string>();
  const groupOf = new Map<string, string>();
  for (const cell of Object.values(store.cells))
    if (isGroupCell(cell))
      for (const member of cell.members) groupOf.set(member, cell.id);
  const hiddenByGroup = (id: string) => {
    const ancestors = new Set<string>();
    let group = groupOf.get(id);
    while (group && !ancestors.has(group)) {
      ancestors.add(group);
      if (store.cells[group]?.hidden) return true;
      group = groupOf.get(group);
    }
    return false;
  };
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const cell = store.cells[id];
    if (!cell || cell.hidden || hiddenByGroup(id)) return;
    if (
      id !== frameId &&
      cellSearchTexts(cell).some((text) =>
        (caseSensitive ? text : text.toLocaleLowerCase()).includes(term),
      )
    )
      result.push(id);
    if (isFrameCell(cell)) [...cell.children, ...cell.groups].forEach(visit);
  };
  visit(frameId);
  return result;
}
