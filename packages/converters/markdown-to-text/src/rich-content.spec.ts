import { it, expect } from 'vitest';
import {
  parseMarkdownToTextDocument,
  serializeTextDocumentToMarkdown,
} from './index';
it('roundtrips mathematical source and keeps code literal', () => {
  const parsed = parseMarkdownToTextDocument(
    'A $x^2$ and `cost $3`.\n\n$$\nx+y\n$$',
  );
  expect(parsed.document.plainText).toContain('x^2');
  expect(parsed.document.content.content?.[1].type).toBe('blockMath');
  const output = serializeTextDocumentToMarkdown(parsed.document);
  expect(output.markdown).toContain('$x^2$');
  expect(output.markdown).toContain('`cost $3`');
});
it('reports folded container degradation without losing body or formula', () => {
  const document = parseMarkdownToTextDocument('Body').document;
  document.content.content = [
    {
      type: 'details',
      content: [
        {
          type: 'detailsSummary',
          content: [{ type: 'text', text: 'Summary' }],
        },
        {
          type: 'detailsContent',
          content: [{ type: 'blockMath', attrs: { latex: 'a=b' } }],
        },
      ],
    },
  ];
  const output = serializeTextDocumentToMarkdown(document);
  expect(output.warnings.some((w) => w.message.includes('折叠'))).toBe(true);
  expect(output.markdown).toContain('Summary');
  expect(output.markdown).toContain('a=b');
});
