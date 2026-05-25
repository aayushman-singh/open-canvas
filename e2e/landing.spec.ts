import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('1.1 — page loads with correct title and meta', async ({ page }) => {
    await expect(page).toHaveTitle('rev01 — multiplayer site builder');
    const description = page.locator('meta[name="description"]');
    await expect(description).toHaveAttribute(
      'content',
      /multiplayer.*AI-native site builder/,
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
    await expect(heading).toContainText(
      'multiplayer site builder with an agent at the cursor.',
    );
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
    await expect(titles.nth(0)).toHaveText('One canvas, not a tree of widgets.');
    await expect(titles.nth(1)).toHaveText('Style Kits change the whole surface.');
    await expect(titles.nth(2)).toHaveText('The agent proposes, the owner accepts.');
  });

  test('1.6 — stat line renders runtime counters', async ({ page }) => {
    const statline = page.locator('section.statline');
    await expect(statline).toBeVisible();
    await expect(statline.locator('.k')).toHaveCount(4);
    await expect(statline.locator('text=LOC')).toBeVisible();
    await expect(statline.locator('text=demo edit ops')).toBeVisible();
    await expect(statline.locator('text=demo agent ops')).toBeVisible();
    await expect(statline.locator('text=published sites')).toBeVisible();
  });

  test('1.7 — footer renders with links and license', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.locator('text=license: MIT')).toBeVisible();
    await expect(footer.locator('a[href="https://github.com/aayushman-singh/rev01"]')).toBeVisible();
    await expect(footer.locator('text=Ready to build?')).toBeVisible();
  });

  test('1.8 — status bar renders with brand and nav', async ({ page }) => {
    const statusbar = page.locator('header.statusbar');
    await expect(statusbar).toBeVisible();
    await expect(statusbar.locator('.brand-name')).toHaveText('rev01');

    const nav = statusbar.locator('nav');
    await expect(nav.locator('a[href*="/docs"]')).toBeVisible();
    await expect(nav.locator('a[href="https://github.com/aayushman-singh/rev01"]')).toBeVisible();
  });

  test('1.9 — "Start building" CTA links to /dashboard', async ({ page }) => {
    const cta = page.locator('section.tagline a[href="/dashboard"]');
    await expect(cta).toBeVisible();
  });

  test('1.10 — "Launch dashboard" nav button links to /dashboard', async ({ page }) => {
    const launchBtn = page.locator('header.statusbar a[href="/dashboard"]');
    await expect(launchBtn).toBeVisible();
  });

  test('1.11 — "View source" button links to GitHub repo', async ({ page }) => {
    const sourceBtn = page.locator(
      'section.tagline a[href="https://github.com/aayushman-singh/rev01"]',
    );
    await expect(sourceBtn).toBeVisible();
  });

  test('1.12 — no console errors on landing', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('1.13 — page has dark color scheme', async ({ page }) => {
    const colorScheme = page.locator('meta[name="color-scheme"]');
    await expect(colorScheme).toHaveAttribute('content', 'dark');
  });

  test('1.14 — footer CTA "Launch dashboard" links to /dashboard', async ({ page }) => {
    const footerCta = page.locator('footer a[href="/dashboard"]');
    await expect(footerCta).toBeVisible();
  });
});
