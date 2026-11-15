import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createBlockText } from '@sue/board-common';
import {
  DefaultSkillViewer,
  type DefaultSkillContent,
} from './default-skill-viewer';
import { WorkspaceDesignProvider } from '../shared/workspace-design';
import { I18nProvider } from '../i18n';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function () {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function () {
  this.open = false;
};
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

it('reads through a readonly editor and preserves exact source while switching items', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const first = createBlockText('First document');
  const second = createBlockText('Second document');
  const source = '---\nname: example\n---\n# First document\n';
  const value: DefaultSkillContent = {
    skills: [
      { name: 'example', description: 'Description', source, document: first },
    ],
    rules: [
      {
        title: 'Another rule',
        source: '# Second document\n',
        document: second,
      },
    ],
  };
  const original = JSON.stringify(value);
  const close = vi.fn();
  const render = (content: DefaultSkillContent | string = value) =>
    root.render(
      <I18nProvider defaultLanguage="zh" persistLanguage={false}>
        <WorkspaceDesignProvider>
          <DefaultSkillViewer value={content} zh onClose={close} />
        </WorkspaceDesignProvider>
      </I18nProvider>,
    );
  const click = async (selector: string) =>
    act(async () =>
      container.querySelector<HTMLButtonElement>(selector)!.click(),
    );
  try {
    await act(async () => render());
    const editor = container.querySelector<HTMLElement>('.tiptap')!;
    expect(editor.textContent).toBe('First document');
    expect(editor.getAttribute('contenteditable')).toBe('false');
    expect(document.activeElement).not.toBe(editor);
    expect(container.querySelector('.document-selection-tools')).toBeNull();
    await click('[data-testid="workspace-default-skill-source"]');
    expect(container.querySelector('.tiptap')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe(source);
    await click('[data-testid="workspace-default-skill-source"]');
    expect(container.querySelector('.tiptap')?.textContent).toBe(
      'First document',
    );
    await click('.workspace-default-skill-tabs button:last-child');
    const other = container.querySelector('.tiptap');
    expect(other?.textContent).toBe('Second document');
    expect(other?.getAttribute('contenteditable')).toBe('false');
    expect(other).not.toBe(editor);
    expect(JSON.stringify(value)).toBe(original);
    await click('[aria-label="关闭默认 Skill"]');
    expect(close).toHaveBeenCalledOnce();
    await act(async () => render('Legacy guidance\n  keep spacing'));
    expect(container.querySelector('pre')?.textContent).toBe(
      'Legacy guidance\n  keep spacing',
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
