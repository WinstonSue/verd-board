import { test, expect, type Page } from '@playwright/test';

const active = (page: Page) => page.locator('.workspace-pane.is-active');
const tab = (page: Page, id: string) =>
  page.locator(`ylib-tabs [role="tab"][data-tab-id="${id}"]`);
const strip = (page: Page) => page.getByTestId('workspace-navigation-progress');
const busy = (page: Page) => page.locator('.workspace-content');

async function seed(page: Page) {
  await page.route('**/document-page.tsx*', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'const t = labels[locale];';
    expect(source).toContain(marker);
    await route.fulfill({
      response,
      body: source.replace(
        marker,
        `${marker}\n if (globalThis.__verdForceDocumentError && value.id === 'feedback-b') throw new Error('Controlled document renderer failure');`,
      ),
    });
  });
  // Hold the real editor flush without adding a production testing API.
  await page.route(
    '**/components/document/document-editor.tsx*',
    async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const marker = 'flushEditing: async () => {';
      expect(source).toContain(marker);
      const readyMarker = 'onReadyRef.current?.(controller);';
      expect(source).toContain(readyMarker);
      const gatedReady = source.replace(
        readyMarker,
        "if (globalThis.__verdReadyGate && originalElementRef.current.id === 'feedback-d') void globalThis.__verdReadyGate.promise.then(() => onReadyRef.current?.(controller)); else onReadyRef.current?.(controller);",
      );
      await route.fulfill({
        response,
        body: gatedReady.replace(
          marker,
          `${marker}\n await globalThis.__verdNavigationGate?.wait?.();`,
        ),
      });
    },
  );
  await page.goto('/');
  const files = ['a', 'b', 'c', 'd'].map((id) => ({
    format: 'verd-document',
    version: 1,
    id: `feedback-${id}`,
    title: `Feedback ${id.toUpperCase()}`,
    text: {
      schemaVersion: 1,
      id: `feedback-${id}`,
      kind: 'block',
      plainText: `Feedback ${id}`,
      content: {
        type: 'doc',
        content: Array.from({ length: 50 }, (_, i) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: `Document ${id} line ${i}` }],
        })),
      },
    },
  }));
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'feedback.verd.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-canvas-bundle',
          version: 1,
          rootFileId: 'feedback-a',
          files,
        }),
      ),
    });
  for (const letter of ['A', 'B', 'C', 'A']) {
    await page
      .locator('.file-tree-name')
      .getByText(`Feedback ${letter}`, { exact: true })
      .click();
    await expect(active(page).locator('.document-page__title')).toHaveValue(
      `Feedback ${letter}`,
    );
    await expect(busy(page)).toHaveAttribute('aria-busy', 'false');
  }
}

async function holdFlush(page: Page) {
  await page.evaluate(() => {
    const waiting: Array<{ resolve(): void; reject(error: Error): void }> = [];
    const gate = {
      enabled: true,
      wait() {
        return gate.enabled
          ? new Promise<void>((resolve, reject) =>
              waiting.push({ resolve, reject }),
            )
          : Promise.resolve();
      },
      release(fail = false) {
        gate.enabled = false;
        waiting
          .splice(0)
          .forEach((waiter) =>
            fail
              ? waiter.reject(new Error('Controlled flush failure'))
              : waiter.resolve(),
          );
      },
    };
    (
      window as unknown as { __verdNavigationGate: typeof gate }
    ).__verdNavigationGate = gate;
  });
}
async function releaseFlush(page: Page, fail = false) {
  await page.evaluate(
    (fail) =>
      (
        window as unknown as {
          __verdNavigationGate: { release(fail: boolean): void };
        }
      ).__verdNavigationGate.release(fail),
    fail,
  );
}

test('warm switches fade once and retain the editor and scroll through input and saving', async ({
  page,
}) => {
  await seed(page);
  await active(page)
    .locator('.ProseMirror')
    .evaluate((node) => node.setAttribute('data-retained-editor', 'yes'));
  await active(page)
    .locator('.document-page__content')
    .evaluate((node) => {
      node.scrollTop = 200;
    });
  await page.evaluate(() => {
    const starts: Array<{ duration: number; opacities: number[] }> = [];
    (
      window as unknown as { __paneAnimations: typeof starts }
    ).__paneAnimations = starts;
    new MutationObserver((records) => {
      for (const record of records) {
        const node = record.target as HTMLElement;
        if (node.dataset['paneEntrance'] !== 'running') continue;
        const animation = node
          .getAnimations()
          .find((item) => item.id === 'workspace-pane-enter');
        if (!animation) continue;
        const sample = {
          duration: Number(animation.effect!.getTiming().duration),
          opacities: [] as number[],
        };
        starts.push(sample);
        const frame = () => {
          if (!node.isConnected || !node.classList.contains('is-active'))
            return;
          sample.opacities.push(Number(getComputedStyle(node).opacity));
          if (node.dataset['paneEntrance'] === 'running')
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }
    }).observe(document.querySelector('.workspace-content')!, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-pane-entrance'],
    });
  });
  await tab(page, 'feedback-b').click();
  await expect(active(page).locator('.document-page__title')).toHaveValue(
    'Feedback B',
  );
  await expect(busy(page)).toHaveAttribute('aria-busy', 'false');
  await expect(strip(page)).toHaveAttribute('data-loading', 'false');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __paneAnimations: string[] }).__paneAnimations
            .length,
      ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const samples = (
          window as unknown as {
            __paneAnimations: Array<{ opacities: number[] }>;
          }
        ).__paneAnimations;
        return samples[0]?.opacities.some(
          (opacity) => opacity > 0.55 && opacity < 0.95,
        );
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __paneAnimations: Array<{ duration: number }> })
          .__paneAnimations[0].duration,
    ),
  ).toBe(180);
  await tab(page, 'feedback-b').click();
  await active(page).locator('.ProseMirror').click();
  await active(page).locator('.ProseMirror').press('End');
  await active(page)
    .locator('.ProseMirror')
    .pressSequentially(' unchanged animation');
  await expect(
    active(page).locator('.document-page__save.is-saved'),
  ).toBeVisible();
  await expect(busy(page)).toHaveAttribute('aria-busy', 'false');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __paneAnimations: string[] }).__paneAnimations
          .length,
    ),
  ).toBe(1);
  await tab(page, 'feedback-a').click();
  await expect(
    active(page).locator('[data-retained-editor="yes"]'),
  ).toBeVisible();
  expect(
    await active(page)
      .locator('.document-page__content')
      .evaluate((node) => node.scrollTop),
  ).toBe(200);
  await expect(active(page)).toHaveAttribute('data-pane-entrance', 'complete');
  expect(
    await active(page).evaluate((node) => getComputedStyle(node).opacity),
  ).toBe('1');
});

test('slow flushes show a thin strip and only the latest requested target activates', async ({
  page,
}) => {
  await seed(page);
  await holdFlush(page);
  await tab(page, 'feedback-b').click();
  await expect(busy(page)).toHaveAttribute('aria-busy', 'true');
  await expect(active(page).locator('.document-page__title')).toHaveValue(
    'Feedback A',
  );
  await expect(strip(page)).toHaveAttribute('data-loading', 'true');
  await expect
    .poll(() => strip(page).evaluate((node) => getComputedStyle(node).opacity))
    .toBe('1');
  expect(
    await strip(page).evaluate((node) => node.getBoundingClientRect().height),
  ).toBe(2);
  await tab(page, 'feedback-c').click();
  await expect(strip(page)).toHaveAttribute('data-loading', 'false');
  expect(
    await strip(page).evaluate((node) => getComputedStyle(node).opacity),
  ).toBe('0');
  await releaseFlush(page);
  await expect(active(page).locator('.document-page__title')).toHaveValue(
    'Feedback C',
  );
  await expect(busy(page)).toHaveAttribute('aria-busy', 'false');
  await expect(strip(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(tab(page, 'feedback-b')).toHaveAttribute(
    'aria-selected',
    'false',
  );
});

test('failed flushes and closed pending targets clear loading and preserve the source', async ({
  page,
}) => {
  await seed(page);
  await holdFlush(page);
  await tab(page, 'feedback-b').click();
  await expect(strip(page)).toHaveAttribute('data-loading', 'true');
  await releaseFlush(page, true);
  await expect(busy(page)).toHaveAttribute('aria-busy', 'false');
  await expect(active(page).locator('.document-page__title')).toHaveValue(
    'Feedback A',
  );
  await holdFlush(page);
  await tab(page, 'feedback-b').click();
  await expect(busy(page)).toHaveAttribute('aria-busy', 'true');
  await tab(page, 'feedback-b').getByRole('button').click();
  await expect(busy(page)).toHaveAttribute('aria-busy', 'false');
  await releaseFlush(page);
  await expect(tab(page, 'feedback-b')).toHaveCount(0);
  await expect(active(page).locator('.document-page__title')).toHaveValue(
    'Feedback A',
  );
});

test('reduced motion keeps delayed loading static and disables the pane fade', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page);
  expect(
    await active(page).evaluate((node) => getComputedStyle(node).animationName),
  ).toBe('none');
  expect(
    await active(page).evaluate((node) =>
      node
        .getAnimations()
        .some((animation) => animation.id === 'workspace-pane-enter'),
    ),
  ).toBe(false);
  await holdFlush(page);
  await tab(page, 'feedback-b').click();
  await expect(strip(page)).toHaveAttribute('data-loading', 'true');
  expect(
    await strip(page)
      .locator('span')
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe('none');
  expect(
    await strip(page)
      .locator('span')
      .evaluate((node) => getComputedStyle(node).transform),
  ).toBe('none');
  await releaseFlush(page);
  await expect(busy(page)).toHaveAttribute('aria-busy', 'false');
});

test('cold content holds its initial opacity until ready and still fades after loading ends', async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(() => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    (
      window as unknown as {
        __verdReadyGate: { promise: Promise<void>; release(): void };
      }
    ).__verdReadyGate = { promise, release };
  });
  await page
    .locator('.file-tree-name')
    .getByText('Feedback D', { exact: true })
    .click();
  await expect(active(page)).toHaveAttribute('data-pane-entrance', 'preparing');
  await expect(strip(page)).toHaveAttribute('data-loading', 'true');
  expect(
    await active(page).evaluate((node) => getComputedStyle(node).opacity),
  ).toBe('0.55');
  await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(
      '.workspace-pane.is-active',
    )!;
    const samples: number[] = [];
    (window as unknown as { __coldOpacity: number[] }).__coldOpacity = samples;
    const sample = () => {
      samples.push(Number(getComputedStyle(pane).opacity));
      if (pane.dataset['paneEntrance'] !== 'complete')
        requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    (
      window as unknown as { __verdReadyGate: { release(): void } }
    ).__verdReadyGate.release();
  });
  await expect(busy(page)).toHaveAttribute('aria-busy', 'false');
  await expect(active(page)).toHaveAttribute('data-pane-entrance', 'complete');
  expect(
    await page.evaluate(() =>
      (window as unknown as { __coldOpacity: number[] }).__coldOpacity.some(
        (opacity) => opacity > 0.55 && opacity < 0.95,
      ),
    ),
  ).toBe(true);
  expect(
    await active(page).evaluate((node) => getComputedStyle(node).opacity),
  ).toBe('1');
});

test('a renderer error completes feedback without an editor and leaves other tabs available', async ({
  page,
}) => {
  await seed(page);
  await tab(page, 'feedback-b').hover();
  await tab(page, 'feedback-b').getByRole('button').click();
  await expect(tab(page, 'feedback-b')).toHaveCount(0);
  await page.evaluate(() => {
    (
      window as unknown as { __verdForceDocumentError: boolean }
    ).__verdForceDocumentError = true;
  });
  await page
    .locator('.file-tree-name')
    .getByText('Feedback B', { exact: true })
    .click();
  await expect(active(page).getByTestId('workspace-file-error')).toBeVisible();
  await expect(busy(page)).toHaveAttribute('aria-busy', 'false');
  await tab(page, 'feedback-a').click();
  await expect(active(page).locator('.document-page__title')).toHaveValue(
    'Feedback A',
  );
  await expect(busy(page)).toHaveAttribute('aria-busy', 'false');
});
