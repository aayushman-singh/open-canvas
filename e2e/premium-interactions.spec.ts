import { expect, test } from '@playwright/test';

const premiumInteractionsUrl = process.env.PREMIUM_INTERACTIONS_URL;

test.describe('Premium Interaction v1', () => {
  test.skip(
    !premiumInteractionsUrl,
    'Set PREMIUM_INTERACTIONS_URL to a published site with Premium Interaction v1 enabled',
  );

  test('published site exposes premium interaction runtime when configured', async ({ page }) => {
    await page.goto(premiumInteractionsUrl!);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('[data-opencanvas-route-container]')).toHaveCount(1);
    await expect(page.locator('script[data-opencanvas-interactive-runtime]')).toHaveCount(1);
    await expect(page.locator('[data-opencanvas-load-experience], [data-opencanvas-overlay]')).not.toHaveCount(0);
  });

  test('visitor can open and dismiss an overlay', async ({ page }) => {
    await page.goto(premiumInteractionsUrl!);
    await page.waitForLoadState('domcontentloaded');

    const overlay = page.locator('[data-opencanvas-overlay]').first();
    await expect(overlay).toHaveCount(1);

    const triggerType = await overlay.getAttribute('data-opencanvas-overlay-trigger-type');
    if (triggerType === 'element-click') {
      const targetId = await overlay.getAttribute('data-opencanvas-overlay-trigger-target');
      expect(targetId).toBeTruthy();
      await page.locator(`[data-opencanvas-element="${targetId}"]`).first().click();
    } else if (triggerType === 'scroll') {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    } else if (triggerType === 'exit-intent') {
      await page.evaluate(() => {
        document.documentElement.dispatchEvent(
          new MouseEvent('mouseleave', { bubbles: true, clientY: 0 }),
        );
      });
    } else if (triggerType === 'delay') {
      const rawDelay = await overlay.getAttribute('data-opencanvas-overlay-trigger-value');
      const delayMs = Math.min(Number(rawDelay) || 3000, 5000);
      await page.waitForTimeout(delayMs + 250);
    }

    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });
});
