import { test } from './service-fixture';
import { exerciseDocumentTables } from './document-table-actions';

test('document tables expose contextual structure controls and preserve edits', async ({
  page,
}) => {
  await page.goto('/');
  await exerciseDocumentTables(page);
});
