import { createBlockText } from '@sue/board-common';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentChangeReceipt,
  DocumentEditorController,
} from '../../types/document';
import { DocumentEditor } from './document-editor';
import * as editorConfig from '../../constants/editor-config';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
HTMLElement.prototype.scrollIntoView ??= () => {};

describe('document action host acknowledgements', () => {
  it('reuses editor setup across parent renders and still adopts external content', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const value = createBlockText('hello');
    const onChange = vi.fn();
    const ready = vi.fn();
    const extensions = vi.spyOn(editorConfig, 'createDocumentExtensions');
    const stringify = vi.spyOn(JSON, 'stringify');
    const render = (document = value, readonly = false) =>
      root.render(
        <DocumentEditor
          {...{ autoFocus: false }}
          value={document}
          readonly={readonly}
          onChange={onChange}
          onReady={ready}
        />,
      );
    try {
      await act(async () => render());
      const editor = container.querySelector('.tiptap');
      const controller = ready.mock.calls.at(-1)?.[0];
      expect(editor).not.toBeNull();
      const initialExtensionCalls = extensions.mock.calls.length;
      const initialSerializations = stringify.mock.calls.filter(
        ([input]) => input === value.content,
      ).length;

      await act(async () => render());
      await act(async () => render(value, true));
      expect(extensions).toHaveBeenCalledTimes(initialExtensionCalls);
      expect(
        stringify.mock.calls.filter(([input]) => input === value.content),
      ).toHaveLength(initialSerializations);
      expect(container.querySelector('.tiptap')).toBe(editor);
      expect(ready.mock.calls.at(-1)?.[0]).toBe(controller);
      expect(editor?.getAttribute('contenteditable')).toBe('false');

      const incoming = createBlockText('updated externally');
      await act(async () => render({ ...incoming, id: value.id }, true));
      expect(editor?.textContent).toBe('updated externally');
      expect(container.querySelector('.tiptap')).toBe(editor);
      expect(onChange).not.toHaveBeenCalled();
      expect(extensions).toHaveBeenCalledTimes(initialExtensionCalls);
    } finally {
      await act(async () => root.unmount());
      stringify.mockRestore();
      extensions.mockRestore();
    }
  });

  it('waits for the host receipt and exposes a rejection to the action and flush barrier', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let controller: DocumentEditorController | null = null;
    let acknowledge!: (value: DocumentChangeReceipt) => void;
    let notifyChange!: () => void;
    const changed = new Promise<void>((resolve) => {
      notifyChange = resolve;
    });
    const onChange = vi.fn(
      () =>
        new Promise<DocumentChangeReceipt>((resolve) => {
          acknowledge = resolve;
          notifyChange();
        }),
    );
    try {
      await act(async () =>
        root.render(
          <DocumentEditor
            {...{ autoFocus: false }}
            value={createBlockText('hello')}
            onChange={onChange}
            onReady={(value) => {
              controller = value;
            }}
          />,
        ),
      );
      const active = controller! as DocumentEditorController;
      await act(async () =>
        active.restoreSelection({ from: 1, to: 6, collapsed: false }),
      );
      let completed = false;
      let work!: ReturnType<DocumentEditorController['executeAction']>;
      await act(async () => {
        work = active.executeAction('document.toggle-bold');
        void work.then(() => {
          completed = true;
        });
        await changed;
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(completed).toBe(false);
      expect(active.getActionState('document.toggle-bold').enabled).toBe(false);
      await act(async () => {
        acknowledge({ ok: false, diagnostics: [{ message: 'Conflict' }] });
        await work;
      });
      expect(await work).toMatchObject({
        status: 'rejected',
        code: 'host-rejected',
      });
      expect(await active.flushEditing()).toMatchObject({
        status: 'rejected',
        code: 'host-rejected',
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('keeps composition and a stale captured selection out of content actions', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    let controller: DocumentEditorController | null = null;
    const onChange = vi.fn();
    try {
      await act(async () =>
        root.render(
          <DocumentEditor
            {...{ autoFocus: false }}
            value={createBlockText('hello')}
            onChange={onChange}
            onReady={(value) => {
              controller = value;
            }}
          />,
        ),
      );
      const active = controller! as DocumentEditorController;
      const editor = container.querySelector('[contenteditable]')!;
      await act(async () =>
        editor.dispatchEvent(
          new CompositionEvent('compositionstart', { bubbles: true }),
        ),
      );
      expect(await active.flushEditing()).toMatchObject({
        status: 'rejected',
        code: 'composition-active',
      });
      await act(async () =>
        editor.dispatchEvent(
          new CompositionEvent('compositionend', { bubbles: true }),
        ),
      );
      const captured = active
        .actions()
        .find((action) => action.id === 'document.insert-horizontal-rule')!
        .capture();
      await act(async () =>
        active.executeAction('document.insert-horizontal-rule'),
      );
      expect(await captured.execute()).toMatchObject({
        status: 'cancelled',
        code: 'stale-context',
      });
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
