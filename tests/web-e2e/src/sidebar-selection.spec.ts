import { test, expect } from './service-fixture';
import { checkSidebarSelection } from './sidebar-selection-actions';

test('sidebar replaces folder reveals and multi-selection on ordinary navigation', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await checkSidebarSelection(page, () =>
    page.evaluate(() => navigator.clipboard.readText()),
  );
  await expect(page.locator('.file-tree-row.is-highlighted')).toHaveCount(1);
});
