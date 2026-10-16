// @vitest-environment jsdom
import React, { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { createInlineText, type BoardTextController } from '@sue/board-common';
import { LineText } from './line-text';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
describe('mounted text controllers', () => {
  it('binds the live editor through StrictMode remounts and changes in readonly state', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container),
      text = createInlineText('Current document'),
      changes = vi.fn();
    let controller: BoardTextController | undefined;
    const render = (readonly: boolean) => (
      <StrictMode>
        <LineText
          text={text}
          readonly={readonly}
          onChange={changes}
          afterInit={(next) => {
            controller = next;
          }}
        />
      </StrictMode>
    );
    try {
      await act(async () => {
        root.render(render(false));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(controller?.getSelection()).not.toBeNull();
      await act(async () => {
        controller!.selectAll();
        controller!.toggleMark('bold');
      });
      expect(controller!.commit().plainText).toBe('Current document');
      expect(container.querySelector('strong')?.textContent).toBe(
        'Current document',
      );
      await act(async () => {
        root.render(render(true));
      });
      await act(async () => {
        root.render(render(false));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(controller?.getSelection()).not.toBeNull();
      await act(async () => {
        controller!.selectAll();
        controller!.toggleMark('italic');
      });
      expect(container.querySelector('em')?.textContent).toBe(
        'Current document',
      );
      expect(changes).toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
