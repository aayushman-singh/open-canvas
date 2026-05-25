import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('1.1 — page loads with correct title and meta', async ({ page }) => {
    await expect(page).toHaveTitle('rev01 — build client sites, not code');
    const description = page.locator('meta[name="description"]');
    await expect(description).toHaveAttribute(
      'content',
      /canvas-first site builder/,
    );
  });

  test('1.2 — hero section renders three panels', async ({ page }) => {
    const hero = page.locator('section.hero');
    await expect(hero).toBeVisible();
    const panels = hero.locator('.hero-grid > *');
    await expect(panels).toHaveCount(3);
  });

  test('1.3 — tagline heading renders', async ({ page }) => {
    const heading = page.locator('section.tagline h1');
    await expect(heading).toContainText('ship client sites at the speed of your');
  });

  test('1.4 — three differentiator cards (01, 02, 03)', async ({ page }) => {
    const features = page.locator('section.features article.feature');
    await expect(features).toHaveCount(3);

    const nums = features.locator('.num');
    await expect(nums.nth(0)).toHaveText('01');
    await expect(nums.nth(1)).toHaveText('02');
    await expect(nums.nth(2)).toHaveText('03');
  });

  test('1.5 — feature card headings match spec', async ({ page }) => {
    const titles = page.locator('section.features article.feature h2');
    await expect(titles.nth(0)).toHaveText('Place anything, anywhere.');
    await expect(titles.nth(1)).toHaveText('Rebrand a site in seconds.');
    await expect(titles.nth(2)).toHaveText('AI drafts it. You approve it.');
  });

  test('1.6 — stat line renders runtime counters', async ({ page }) => {
    const statline = page.locator('section.statline');
    await expect(statline).toBeVisible();
    await expect(statline.locator('.k')).toHaveCount(4);
    await expect(statline.locator('text=creators')).toBeVisible();
    await expect(statline.locator('text=sites shipped')).toBeVisible();
    await expect(statline.locator('text=avg build time')).toBeVisible();
    await expect(statline.locator('text=uptime')).toBeVisible();
  });

  test('1.7 — footer renders with heading and CTA', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.locator('text=Your next client site starts here.')).toBeVisible();
    await expect(footer.locator('a[href="/dashboard"]')).toBeVisible();
  });

  test('1.8 — status bar renders with brand and nav', async ({ page }) => {
    const statusbar = page.locator('header.statusbar');
    await expect(statusbar).toBeVisible();
    await expect(statusbar.locator('.brand-name')).toHaveText('rev01');

    const nav = statusbar.locator('nav');
    await expect(nav.locator('a[href="/dashboard"]')).toBeVisible();
  });

  test('1.9 — tagline CTA links to /dashboard', async ({ page }) => {
    const cta = page.locator('section.tagline a[href="/dashboard"]');
    await expect(cta).toBeVisible();
  });

  test('1.10 — no console errors on landing', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('1.11 — page has dark color scheme', async ({ page }) => {
    const colorScheme = page.locator('meta[name="color-scheme"]');
    await expect(colorScheme).toHaveAttribute('content', 'dark');
  });
});
