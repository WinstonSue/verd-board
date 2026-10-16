import type { Page, Locator } from '@playwright/test';

/**
 * Arrangement starts collapsed. Controls inside it (align, group, lock,
 * auto-layout, layer order) are in the DOM but not actionable until the
 * group toggle is expanded. Hidden workspace panes stay mounted, so the
 * toggle has to be the visible one.
 */
export async function expandPropertyGroup(
  page: Page | Locator,
  id = 'arrangement',
) {
  const toggle = page
    .locator(`[data-property-group="${id}"] > button`)
    .locator('visible=true');
  if (
    (await toggle.count()) > 0 &&
    (await toggle.getAttribute('aria-expanded')) !== 'true'
  )
    await toggle.click();
}
