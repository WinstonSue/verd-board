import { test, expect } from '@playwright/test';

test('workflow harness projects fixture nodes', async ({ page }) => {
  await page.goto('/?harness=workflow');
  await expect(
    page.getByTestId('workflow-nodes').getByTestId('node-cmd-1'),
  ).toBeVisible();
  await expect(page.getByTestId('fixture-json')).toContainText('cmd-1');
  await expect(page.getByTestId('palette-command')).toBeVisible();
});

test('workflow canvas mounts custom nodes in foreignObject', async ({
  page,
}) => {
  await page.goto('/?harness=workflow');
  await expect(
    page.locator('foreignObject [data-testid="node-cmd-1"]'),
  ).toBeVisible();
  await page.locator('[data-cell-kind="workflow-task"]').first().hover();
  await expect(page.locator('[data-port-id]').first()).toBeVisible();
});

test('workflow dual canvases render independently', async ({ page }) => {
  await page.goto('/?harness=workflow-dual');
  await expect(page.getByTestId('workflow-canvas-a')).toBeVisible();
  await expect(page.getByTestId('workflow-canvas-b')).toBeVisible();
});

test('mind harness renders custom nodes without a fake root', async ({
  page,
}) => {
  await page.goto('/?harness=mind');
  await expect(
    page.getByRole('heading', { name: 'Mind harness' }),
  ).toBeVisible();
  await expect(page.getByTestId('mind-node-goal-1')).toBeVisible();
  await expect(page.getByTestId('mind-node-goal-2')).toBeVisible();
  await expect(
    page.locator('foreignObject [data-testid="mind-edit-goal-1"]'),
  ).toBeVisible();
  await page
    .getByTestId('mind-edit-goal-1')
    .evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.getByTestId('mind-host-json')).toContainText('North!');
});

test('mind document canvas keeps the standard document', async ({ page }) => {
  await page.goto('/?harness=mind-document');
  await expect(
    page.getByRole('heading', { name: 'Mind document' }),
  ).toBeVisible();
  await expect(page.getByTestId('mind-document-json')).toContainText(
    'Central topic',
  );
});

test('workflow document canvas updates the host document', async ({ page }) => {
  await page.goto('/?harness=workflow-document');
  await page.getByTestId('workflow-document-add').click();
  await expect(page.getByTestId('workflow-document-json')).toContainText(
    'Added task',
  );
});

test('architecture projection and document canvases update host data', async ({
  page,
}) => {
  await page.goto('/?harness=architecture');
  await page.getByTestId('architecture-projection-rename').click();
  await expect(page.getByTestId('architecture-host-json')).toContainText(
    'Service!',
  );

  await page.goto('/?harness=architecture-document');
  await page.getByTestId('architecture-document-add').click();
  await expect(page.getByTestId('architecture-document-json')).toContainText(
    'box-1',
  );
});
