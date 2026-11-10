import { expect, test } from './service-fixture';

for (const appearance of ['light', 'dark']) {
  test(`message follows ${appearance} theme and moves into and out of fullscreen`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (value) => localStorage.setItem('verdboard.appearance', value),
      appearance,
    );
    await page.goto('/?harness=message');
    const message = page.locator('.sue-message-notice');
    await page.getByRole('button', { name: '提示', exact: true }).click();
    await expect(message).toHaveText('普通提示');
    const color = await message.evaluate(
      (node) =>
        getComputedStyle(
          node.querySelector('.sue-message-notice-content') ?? node,
        ).color,
    );
    const channels = color.match(/\d+/g)!.map(Number);
    if (appearance === 'dark') expect(channels[0]!).toBeGreaterThan(200);
    else expect(channels[0]!).toBeLessThan(80);
    await page.getByRole('button', { name: '全屏', exact: true }).click();
    await expect
      .poll(() =>
        message.evaluate((node) => document.fullscreenElement?.contains(node)),
      )
      .toBe(true);
    await page.getByRole('button', { name: '提示', exact: true }).click();
    await expect(message).toHaveCount(1);
    await message.evaluate(async (node) => {
      await Promise.all(
        node
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      );
    });
    await page.screenshot({
      path: info.outputPath(`message-${appearance}-fullscreen.png`),
    });
    await page.getByRole('button', { name: '退出全屏', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement === null))
      .toBe(true);
    await expect(message).toBeVisible();
    await page.getByRole('button', { name: '提示', exact: true }).click();
    await expect(message).toHaveCount(0, { timeout: 4500 });
  });
}
