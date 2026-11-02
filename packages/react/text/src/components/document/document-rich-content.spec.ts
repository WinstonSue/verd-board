// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Editor, getSchema } from '@tiptap/react';
import {
  createDocumentExtensions,
  contentExtensions,
} from '../../constants/editor-config';
import { deriveBoardTextPlainText, isBoardTextNode } from '@sue/board-common';
import { prepareListFolding } from './document-rich-content';
describe('document-only rich content', () => {
  it('preserves formulas and foldable structure without enabling canvas labels', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'details',
          content: [
            {
              type: 'detailsSummary',
              content: [{ type: 'text', text: 'Proof' }],
            },
            {
              type: 'detailsContent',
              content: [{ type: 'blockMath', attrs: { latex: 'x^2' } }],
            },
          ],
        },
      ],
    };
    const schema = getSchema(createDocumentExtensions());
    schema.nodeFromJSON(content).check();
    expect(deriveBoardTextPlainText(content)).toContain('x^2');
    expect(() => getSchema(contentExtensions).nodeFromJSON(content)).toThrow();
    expect(isBoardTextNode({ type: 'inlineMath', attrs: { latex: 3 } })).toBe(
      false,
    );
  });
  it('list folding leaves parent explanation and serialized content unchanged', () => {
    const editor = new Editor({
      extensions: createDocumentExtensions(),
      content:
        '<ul><li><p>Parent</p><p>Explanation</p><ul><li><p>Child</p></li></ul></li></ul>',
    });
    document.body.append(editor.view.dom);
    const before = JSON.stringify(editor.getJSON());
    const button = editor.view.dom.querySelector<HTMLButtonElement>(
      '.document-list-fold',
    )!;
    expect(button).not.toBeNull();
    button.click();
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    expect(
      editor.view.dom.querySelector('ul ul')?.getAttribute('style'),
    ).toContain('display: none');
    expect(editor.view.dom.textContent).toContain('Explanation');
    editor.destroy();
  });
  it('readonly folding hides only nested lists', () => {
    const body = document.createElement('div');
    body.innerHTML =
      '<ul><li><p>Parent</p><p>Explanation</p><ol><li>Child</li></ol></li></ul>';
    prepareListFolding(body);
    body.querySelector<HTMLButtonElement>('button')!.click();
    expect(body.querySelector('ol')?.hidden).toBe(true);
    expect(body.querySelector('p')?.hidden).toBe(false);
  });
  it('folds legacy details without writing identities and moves a hidden caret to its summary', () => {
    const editor = new Editor({
      extensions: createDocumentExtensions(),
      content: {
        type: 'doc',
        content: [
          {
            type: 'details',
            content: [
              {
                type: 'detailsSummary',
                content: [{ type: 'text', text: 'Summary' }],
              },
              {
                type: 'detailsContent',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Body' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    document.body.append(editor.view.dom);
    const before = JSON.stringify(editor.getJSON());
    const details = editor.view.dom.querySelector<HTMLElement>(
      '[data-type=details]',
    )!;
    const button = details.querySelector<HTMLButtonElement>(':scope > button')!;
    button.click();
    editor.commands.setTextSelection(13);
    expect(details.classList.contains('is-open')).toBe(true);
    button.click();
    expect(details.classList.contains('is-open')).toBe(false);
    expect(editor.state.selection.from).toBeLessThan(10);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    editor.destroy();
  });
});
