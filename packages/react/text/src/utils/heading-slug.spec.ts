import { describe, expect, it } from 'vitest';
import { createDocumentHeadingSlugger } from './heading-slug';

describe('document heading fragments', () => {
  it('matches GitHub Unicode, punctuation and duplicate heading rules', () => {
    const slug = createDocumentHeadingSlugger();
    expect(slug('架构与验收状态')).toBe('架构与验收状态');
    expect(slug('Sidebar、节点名称与连接交互')).toBe(
      'sidebar节点名称与连接交互',
    );
    expect(slug('Hello_world!')).toBe('hello_world');
    expect(slug('🚀 快速开始')).toBe('-快速开始');
    expect(slug('重复标题')).toBe('重复标题');
    expect(slug('重复标题')).toBe('重复标题-1');
    expect(slug('重复标题-1')).toBe('重复标题-1-1');
    expect(slug('重复标题')).toBe('重复标题-2');
    expect(createDocumentHeadingSlugger()('重复标题')).toBe('重复标题');
  });
});
