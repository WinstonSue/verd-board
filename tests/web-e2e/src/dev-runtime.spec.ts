import { expect, test } from './service-fixture';

test('Web development loads source modules and a live Vite client', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.workspace-shell')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((entry) => entry.name.includes('/@vite/client')),
      ),
    )
    .toBe(true);
  const client = await page.request.get('/@vite/client');
  expect(client.ok()).toBe(true);
  expect(await client.text()).toContain('createHotContext');
});
