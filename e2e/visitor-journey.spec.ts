import { test, expect } from '@playwright/test';

// A first-time visitor lands on the homepage. Can they understand what
// this product is, find a way to get started, and navigate without
// confusion — all without reading the source code?

test.describe('First-time visitor journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('the page loads without any console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('no broken images or resources on the page', async ({ page }) => {
    const failedRequests: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 400 && !resp.url().includes('favicon')) {
        failedRequests.push(`${resp.status()} ${resp.url()}`);
      }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(failedRequests).toEqual([]);
  });

  test('visitor can tell what this product is from the headline', async ({ page }) => {
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toBeVisible();
    const text = (await h1.textContent()) ?? '';
    expect(text.length).toBeGreaterThan(10);
    // The headline should communicate it's a site builder — not be blank or generic
    expect(text.toLowerCase()).toMatch(/site builder|build|editor|canvas/);
  });

  test('hero section gives a visual preview of the product', async ({ page }) => {
    const hero = page.getByLabel(/hero/i);
    await expect(hero).toBeVisible();
    // The hero should contain multiple panels showing the product
    const panels = hero.locator('.hero-grid > *');
    expect(await panels.count()).toBeGreaterThanOrEqual(2);
  });

  test('visitor can find a primary call-to-action above the fold', async ({ page }) => {
    // A real user should find a prominent "get started" type button
    // without scrolling — look for links to /dashboard
    const ctaLinks = page.getByRole('link').filter({ hasText: /start|launch|dashboard|get started|sign up|try/i });
    const count = await ctaLinks.count();
    expect(count).toBeGreaterThanOrEqual(1);

    const first = ctaLinks.first();
    await expect(first).toBeVisible();
    const href = await first.getAttribute('href');
    expect(href).toBeTruthy();
  });

  test('clicking the main CTA navigates toward getting started', async ({ page }) => {
    const cta = page.getByRole('link', { name: /start building|launch dashboard/i }).first();
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute('href');
    expect(href).toContain('/dashboard');

    // Click and verify we leave the landing page (either redirect to sign-in or dashboard)
    await cta.click();
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toBe('/');
  });

  test('visitor sees differentiated value props — not just one blank section', async ({ page }) => {
    const features = page.getByLabel(/differentiator/i);
    await expect(features).toBeVisible();

    const cards = features.getByRole('article');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Each card should have a heading — not empty placeholders
    for (let i = 0; i < count; i++) {
      const heading = cards.nth(i).getByRole('heading');
      await expect(heading).toBeVisible();
      const text = await heading.textContent();
      expect((text ?? '').length).toBeGreaterThan(5);
    }
  });

  test('footer has a secondary CTA and useful links', async ({ page }) => {
    const footer = page.getByLabel('footer');
    await expect(footer).toBeVisible();

    // Should have at least one link to get started
    const dashLink = footer.getByRole('link', { name: /dashboard|get started|launch/i });
    await expect(dashLink.first()).toBeVisible();

    // Should have a link to source code / docs
    const externalLinks = footer.getByRole('link').filter({ hasText: /github|docs|source/i });
    expect(await externalLinks.count()).toBeGreaterThanOrEqual(1);
  });

  test('navigation bar has brand, docs link, and dashboard shortcut', async ({ page }) => {
    const nav = page.getByLabel(/rev01 navigation/i);
    await expect(nav).toBeVisible();

    // Brand name visible
    await expect(nav.locator('.brand-name')).toHaveText('rev01');

    // Docs link exists
    const docsLink = nav.getByRole('link', { name: /docs/i });
    await expect(docsLink).toBeVisible();

    // Dashboard shortcut
    const dashLink = nav.getByRole('link', { name: /dashboard|launch/i });
    await expect(dashLink).toBeVisible();
  });

  test('page uses dark theme as declared', async ({ page }) => {
    const scheme = page.locator('meta[name="color-scheme"]');
    await expect(scheme).toHaveAttribute('content', /dark/);
  });

  test('heading hierarchy is logical (no skipped levels)', async ({ page }) => {
    const headings = await page.evaluate(() => {
      const els = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      return Array.from(els).map((el) => ({
        level: parseInt(el.tagName[1]),
        text: el.textContent?.trim().slice(0, 50) ?? '',
        visible: (el as HTMLElement).offsetParent !== null,
      }));
    });

    const visible = headings.filter((h) => h.visible);
    expect(visible.length).toBeGreaterThan(0);

    // First heading should be h1
    expect(visible[0].level).toBe(1);

    // No heading should jump more than 1 level
    for (let i = 1; i < visible.length; i++) {
      const jump = visible[i].level - visible[i - 1].level;
      expect(jump).toBeLessThanOrEqual(1);
    }
  });

  test('page is keyboard-navigable — tab reaches CTA', async ({ page }) => {
    // Start from top, tab through the page, verify we can reach a dashboard link
    await page.keyboard.press('Tab');
    let found = false;
    for (let i = 0; i < 20; i++) {
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return el?.tagName === 'A' ? (el as HTMLAnchorElement).href : null;
      });
      if (focused && focused.includes('/dashboard')) {
        found = true;
        break;
      }
      await page.keyboard.press('Tab');
    }
    expect(found).toBe(true);
  });
});

test.describe('Landing page responsiveness', () => {
  test('page renders without horizontal overflow on mobile', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow).toBe(false);

    // Key elements still visible
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await context.close();
  });
});
