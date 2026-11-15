import { expect, type Page } from '@playwright/test';

export async function exerciseDocumentBubbleStability(page: Page) {
  const id = 'bubble-stability';
  const paragraphs = Array.from({ length: 40 }, (_, index) => ({
    type: 'paragraph',
    attrs: { blockId: `bubble-${index}` },
    content: [
      {
        type: 'text',
        text: `Paragraph ${index}: a stable document position while opening menus.`,
      },
    ],
  }));
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'Bubble stability.verd-doc.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-document',
          version: 1,
          id,
          title: 'Bubble stability',
          text: {
            schemaVersion: 1,
            id,
            kind: 'block',
            plainText: paragraphs.map((p) => p.content[0].text).join('\n'),
            content: { type: 'doc', content: paragraphs },
          },
        }),
      ),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Bubble stability$/ })
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  const content = pane.locator('.document-page__content');
  const toolbar = pane.getByRole('toolbar', { name: '文字格式' });
  await expect(pane.locator('.tiptap p')).toHaveCount(40);
  for (const scrolled of [false, true]) {
    if (scrolled) {
      await content.hover();
      await page.mouse.wheel(0, 650);
      await expect
        .poll(() => content.evaluate((node) => node.scrollTop))
        .toBeGreaterThan(300);
    }
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const ids = await content.evaluate((region) => {
      const bounds = region.getBoundingClientRect();
      return [...region.querySelectorAll<HTMLElement>('.tiptap p')]
        .filter((node) => {
          const box = node.getBoundingClientRect();
          return box.top > bounds.top + 40 && box.bottom < bounds.bottom - 40;
        })
        .slice(0, 3)
        .map((node) => node.dataset['blockId']!);
    });
    expect(ids.length).toBeGreaterThanOrEqual(2);
    // Observe both paint frames and DOM mutations so a short-lived initial
    // layout shift cannot disappear before Playwright's final assertions.
    await pane.evaluate((element) => {
      const region = element.querySelector<HTMLElement>(
        '.document-page__content',
      )!;
      const editor = element.querySelector<HTMLElement>('.tiptap')!;
      const hosts = new Set<Element>();
      const geometry = () => {
        const p = element.getBoundingClientRect(),
          e = editor.getBoundingClientRect();
        return [
          p.x,
          p.y,
          p.width,
          p.height,
          e.x,
          e.y,
          e.width,
          e.height,
          region.scrollTop,
          region.scrollHeight,
        ];
      };
      const baseline = geometry();
      const failures: string[] = [];
      let frames = 0,
        frame = 0;
      const sample = () => {
        if (
          geometry().some(
            (value, index) => Math.abs(value - baseline[index]) > 0.5,
          ) &&
          failures.length < 10
        )
          failures.push('Document geometry changed when opening a bubble');
        for (const host of element.querySelectorAll<HTMLElement>(
          '.document-block-popover-host',
        )) {
          hosts.add(host);
          if (
            getComputedStyle(host).position !== 'fixed' &&
            failures.length < 10
          )
            failures.push('Bubble entered normal document flow');
          const body = host.querySelector<HTMLElement>(
            '.document-block-popover-content',
          );
          if (!body) {
            if (failures.length < 10)
              failures.push('A stale bubble shell was reattached');
            continue;
          }
          if (
            getComputedStyle(body).visibility === 'visible' &&
            getComputedStyle(host).opacity !== '0' &&
            (!host.hasAttribute('data-positioned') || host.inert) &&
            failures.length < 10
          )
            failures.push('Bubble was visible before positioning');
        }
      };
      const observer = new MutationObserver(sample);
      observer.observe(element, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      const tick = () => {
        frames++;
        sample();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      (
        window as unknown as { finishBubbleSample(): unknown }
      ).finishBubbleSample = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        sample();
        return { frames, hosts: hosts.size, failures };
      };
    });
    let result: { frames: number; hosts: number; failures: string[] };
    try {
      for (const blockId of [...ids, ...ids.slice().reverse()]) {
        const paragraph = pane.locator(`.tiptap [data-block-id="${blockId}"]`);
        await paragraph.click();
        await expect(toolbar).toBeVisible();
        await expect(toolbar).toBeInViewport({ ratio: 1 });
        await paragraph.dblclick({ position: { x: 30, y: 12 } });
        await expect(toolbar).toBeVisible();
      }
      await pane
        .locator(`.tiptap [data-block-id="${ids[0]}"]`)
        .click({ button: 'right' });
      await expect(
        pane.getByRole('dialog', { name: '段落操作' }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
    } finally {
      result = await page.evaluate(() => {
        const state = window as unknown as {
          finishBubbleSample?: () => {
            frames: number;
            hosts: number;
            failures: string[];
          };
        };
        const result = state.finishBubbleSample!();
        delete state.finishBubbleSample;
        return result;
      });
    }
    expect(result.frames).toBeGreaterThan(2);
    expect(result.hosts).toBeGreaterThan(2);
    expect(result.failures).toEqual([]);
  }
}
