import { expect, test } from './service-fixture';

for (const mode of ['light', 'dark'] as const) {
  for (const locale of ['zh', 'en'] as const) {
    for (const width of [1440, 1024]) {
      test(`interface geometry ${mode} ${locale} ${width}`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(
          ({ mode, locale }) => {
            localStorage.setItem('verdboard.appearance', mode);
            localStorage.setItem('language', locale);
          },
          { mode, locale },
        );
        await page.goto('/');
        const zh = locale === 'zh';
        const trigger = page.getByTestId('workspace-menu-trigger');
        await expect(trigger).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute(
          'lang',
          zh ? 'zh-CN' : 'en',
        );
        const baseline = await trigger.evaluate((el) => ({
          family: getComputedStyle(el).fontFamily,
          size: getComputedStyle(el).fontSize,
        }));
        expect(baseline.size).toBe('14px');
        const rail = await page
          .locator('.workspace-sidebar')
          .evaluate((aside) => {
            const selectors = [
              '.workspace-menu-name',
              '.management-navigation nav svg',
              '.vm-sidebar-section__label',
              '.file-tree-header > span',
              '.workspace-sidebar-footer svg',
            ];
            return selectors.map(
              (s) => aside.querySelector(s)!.getBoundingClientRect().left,
            );
          });
        expect(Math.max(...rail) - Math.min(...rail)).toBeLessThanOrEqual(1);
        const toggle = page.getByRole('button', {
          name: zh ? '收起侧栏' : 'Collapse sidebar',
          exact: true,
        });
        const triggerBox = (await trigger.boundingBox())!;
        const toggleBox = (await toggle.boundingBox())!;
        expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(
          toggleBox.x,
        );
        await toggle.click();
        await page
          .getByRole('button', {
            name: zh ? '展开侧栏' : 'Expand sidebar',
            exact: true,
          })
          .click();
        await expect(trigger).toBeVisible();
        await trigger.focus();
        await page.keyboard.press('ArrowDown');
        const switcher = page.getByTestId('workspace-switcher-dialog');
        await expect(switcher).toBeVisible();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(
          await switcher.evaluate((el) => getComputedStyle(el).fontFamily),
        ).toBe(baseline.family);
        expect(
          await switcher.evaluate((el) => getComputedStyle(el).fontSize),
        ).toBe('14px');
        await expect(
          switcher.locator('.workspace-switcher-row').first(),
        ).toHaveAttribute('aria-current', 'true');
        expect(
          await switcher.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        expect(
          await switcher.evaluate((el) => getComputedStyle(el).backgroundColor),
        ).toBe(mode === 'dark' ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)');
        await page.screenshot({ path: info.outputPath('switcher.png') });
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        await page.getByTestId('workspace-my').click();
        const settings = page.getByTestId('my-page');
        await expect(settings).toBeVisible();
        await expect(settings.locator('.vm-settings-page__title')).toHaveText(
          zh ? '外观' : 'Appearance',
        );
        expect(
          await settings.evaluate((el) => getComputedStyle(el).fontFamily),
        ).toBe(baseline.family);
        const lefts = await settings.evaluate((el) =>
          [
            '.settings-search .sue-input-prefix svg',
            '.settings-sections-nav .sue-menu-item-group-title',
            '.settings-sections-nav .sue-menu-title-content',
          ].map((selector) => {
            const element = el.querySelector(selector)!;
            if (selector.includes('menu-item-group-title')) {
              const range = document.createRange();
              range.selectNodeContents(element);
              return range.getBoundingClientRect().left;
            }
            return element.getBoundingClientRect().left;
          }),
        );
        expect(
          Math.max(...lefts) - Math.min(...lefts),
          JSON.stringify(lefts),
        ).toBeLessThanOrEqual(1);
        const contentLefts = await settings
          .locator('.settings-sections-panel')
          .evaluate((el) =>
            [...el.children]
              .filter((child) => child.getBoundingClientRect().width > 0)
              .map((child) => child.getBoundingClientRect().left),
          );
        expect(
          Math.max(...contentLefts) - Math.min(...contentLefts),
        ).toBeLessThanOrEqual(1);
        await page.screenshot({ path: info.outputPath('settings.png') });
        await page.keyboard.press('Escape');
        await page.keyboard.press('ControlOrMeta+p');
        const quick = page.locator('.workspace-quick-open');
        await expect(quick).toBeVisible();
        expect(
          await quick.evaluate((el) => getComputedStyle(el).fontFamily),
        ).toBe(baseline.family);
        expect(
          await quick.evaluate((el) => getComputedStyle(el).fontSize),
        ).toBe('14px');
        await page.keyboard.press('Escape');
        await trigger.focus();
        await page.keyboard.press('ControlOrMeta+Shift+p');
        const palette = page.locator('[data-action-panel]');
        await expect(palette).toBeVisible();
        expect(
          await palette.evaluate((el) => getComputedStyle(el).fontFamily),
        ).toBe(baseline.family);
        expect(
          await palette.evaluate((el) => getComputedStyle(el).fontSize),
        ).toBe('14px');
        expect(
          await palette.evaluate((el) => getComputedStyle(el).backgroundColor),
        ).toBe(mode === 'dark' ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)');
        await page.keyboard.press('Escape');
        await page.getByTestId('file-tree-new').click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();
        expect(
          await menu.evaluate((el) => getComputedStyle(el).fontFamily),
        ).toBe(baseline.family);
        expect(await menu.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
          '14px',
        );
        expect(
          await menu.evaluate((el) => getComputedStyle(el).backgroundColor),
        ).toBe(mode === 'dark' ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)');
      });
    }
  }
}
