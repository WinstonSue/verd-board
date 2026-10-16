import { describe, it, expect } from 'vitest';
import { createInlineText } from './editor-factory';
import { Alignment } from './editor-types';
import { inheritTextFormatting } from './inherit-formatting';

describe('inherited typography', () => {
  it('inherits an explicitly aligned paragraph when the document has only a default', () => {
    const seed = createInlineText('Parent');
    seed.content.content![0].attrs = { textAlign: 'center' };
    const next = inheritTextFormatting(createInlineText('Child'), seed);
    expect(next.align).toBeUndefined();
    expect(next.content.content![0].attrs?.textAlign).toBe('center');
  });
  it('keeps new topic identity and content, carries typography and drops the source link', () => {
    const seed = createInlineText('Parent');
    seed.align = Alignment.right;
    seed.content.content![0].content![0].marks = [
      { type: 'bold' },
      { type: 'link', attrs: { href: 'https://example.com' } },
      { type: 'textStyle', attrs: { fontSize: '24px', color: '#112233' } },
    ];
    const topic = createInlineText('Child');
    const next = inheritTextFormatting(topic, seed);
    expect(next).toMatchObject({
      id: topic.id,
      plainText: 'Child',
      align: 'right',
    });
    expect(next.content.content![0].content![0].marks).toEqual([
      { type: 'bold' },
      { type: 'textStyle', attrs: { fontSize: '24px', color: '#112233' } },
    ]);
    expect(topic.content.content![0].content![0].marks).toBeUndefined();
    expect(seed.content.content![0].content![0].marks).toHaveLength(3);
  });
});
