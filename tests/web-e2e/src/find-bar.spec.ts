import { test } from '@playwright/test';
import { exerciseFindBars } from '../../helpers/find-bar';

for (const appearance of ['light', 'dark'] as const) {
  test(`shared find bars retain focus, replace safely and fit wide/narrow layouts in ${appearance}`, async ({
    page,
  }, info) => {
    await exerciseFindBars(page, (name) => info.outputPath(name), appearance);
  });
}
