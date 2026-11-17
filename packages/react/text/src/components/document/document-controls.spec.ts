import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { createDocumentExtensions } from '../../constants/editor-config';
import {
  documentBlockHandleLeft,
  hasDocumentTextSelection,
} from './document-controls';

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('requires selected text, including keyboard and whole-document selections', () => {
  const editor = new Editor({
    extensions: createDocumentExtensions({ history: false }),
    content: '<p>Selected words</p><hr><p></p>',
  });
  editors.push(editor);
  const doc = editor.state.doc;
  expect(hasDocumentTextSelection(TextSelection.create(doc, 2))).toBe(false);
  expect(hasDocumentTextSelection(TextSelection.create(doc, 1, 9))).toBe(true);
  expect(hasDocumentTextSelection(new AllSelection(doc))).toBe(true);
  expect(hasDocumentTextSelection(NodeSelection.create(doc, 16))).toBe(false);
  const empty = doc.type.create(null, doc.type.schema.nodes.paragraph.create());
  expect(hasDocumentTextSelection(new AllSelection(empty))).toBe(false);
});

function bounds(element: Element, left: number, width = 100) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(left, 20, width, 28),
  );
}

it('keeps ordinary paragraph and quote handles aligned to their own blocks', () => {
  document.body.innerHTML = '<p>Text</p><blockquote><p>Quote</p></blockquote>';
  const paragraphs = document.querySelectorAll('p');
  bounds(paragraphs[0], 120);
  bounds(paragraphs[1], 150);
  expect(documentBlockHandleLeft(paragraphs[0])).toBe(92);
  expect(documentBlockHandleLeft(paragraphs[1])).toBe(122);
});

it('places a bullet handle before its list gutter and a nested handle before its own list', () => {
  document.body.innerHTML =
    '<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>';
  const lists = document.querySelectorAll('ul');
  const items = document.querySelectorAll('li');
  bounds(lists[0], 120);
  bounds(items[0], 146);
  bounds(lists[1], 146);
  bounds(items[1], 172);
  expect(documentBlockHandleLeft(items[0])).toBe(92);
  expect(documentBlockHandleLeft(items[1])).toBe(118);
});

it('clears three-digit markers and fold controls without changing list indentation', () => {
  document.body.innerHTML =
    '<ol start="998"><li>First</li><li><button class="document-list-fold">Fold</button><p>Nested</p></li></ol>';
  const list = document.querySelector('ol')!;
  const item = list.children[1] as HTMLLIElement;
  const fold = item.querySelector('button')!;
  bounds(list, 120);
  bounds(item, 146);
  bounds(fold, 86, 16);
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    font: '16px serif',
    fontSize: '16px',
  } as CSSStyleDeclaration);
  const measure = vi.fn(() => 42);
  const before = list.outerHTML;
  const left = documentBlockHandleLeft(item, measure);
  expect(measure).toHaveBeenCalledWith('999.', '16px serif', document);
  expect(left + 24).toBeLessThanOrEqual(146 - 42 - 8 - 4);
  expect(left + 24).toBeLessThanOrEqual(86 - 4);
  expect(list.outerHTML).toBe(before);
});
