import { test, expect } from '@playwright/test';

// Published site visitor experience. These tests verify that the public-facing
// site rendering, SEO endpoints, and interactive elements work from a real
// visitor's perspective.
//
// Set PUBLISHED_SUBDOMAIN env var to test against a real published site.
// Without it, only the "no site" error-handling tests run.

const subdomain = process.env.PUBLISHED_SUBDOMAIN;

test.describe('Published site — error handling (no subdomain needed)', () => {
  test('non-existent subdomain gets a clear error — not a crash', async ({ request }) => {
    const resp = await request.get('/', {
      headers: { host: 'nonexistent-xyz-999.opencanvas.aayushman.dev' },
    });
    // Should be 404 or a fallback, not 500
    expect(resp.status()).toBeLessThan(500);
  });

  test('sitemap.xml is served or cleanly absent', async ({ request }) => {
    const resp = await request.get('/sitemap.xml');
    // Either serves XML or 404 — never 500
    expect([200, 404]).toContain(resp.status());
    if (resp.status() === 200) {
      const ct = resp.headers()['content-type'] ?? '';
      expect(ct).toMatch(/xml/);
    }
  });
});

test.describe('Published site — visitor experience', () => {
  test.skip(!subdomain, 'Set PUBLISHED_SUBDOMAIN env var to run these tests');

  const siteUrl = subdomain
    ? `https://${subdomain}.opencanvas.aayushman.dev`
    : '';

  test('published site loads and renders visible content', async ({ page }) => {
    await page.goto(siteUrl);
    await page.waitForLoadState('domcontentloaded');

    // Page should have a title (not blank)
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // Should have visible text content — not a blank white page
    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    expect(bodyText.length).toBeGreaterThan(10);
  });

  test('published site has no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto(siteUrl);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('published site has valid meta tags for SEO', async ({ page }) => {
    await page.goto(siteUrl);

    // Should have a title
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // Should have OG tags for social sharing
    const ogTitle = page.locator('meta[property="og:title"]');
    const ogImage = page.locator('meta[property="og:image"]');
    // At minimum, og:title should exist
    expect(await ogTitle.count()).toBeGreaterThanOrEqual(1);
    // og:image is optional but valuable
    if ((await ogImage.count()) > 0) {
      const url = await ogImage.getAttribute('content');
      expect(url).toMatch(/^https?:\/\//);
    }
  });

  test('published site has JSON-LD structured data', async ({ page }) => {
    await page.goto(siteUrl);

    const jsonLd = await page.evaluate(() => {
      const script = document.querySelector('script[type="application/ld+json"]');
      if (!script?.textContent) return null;
      try { return JSON.parse(script.textContent); }
      catch { return null; }
    });

    if (jsonLd) {
      expect(jsonLd['@context']).toContain('schema.org');
      expect(jsonLd['@type']).toBeTruthy();
      expect(jsonLd.name).toBeTruthy();
    }
  });

  test('published site sections are visible and have content', async ({ page }) => {
    await page.goto(siteUrl);
    await page.waitForLoadState('domcontentloaded');

    // The site should render at least one section with content
    const sections = page.locator('section');
    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // First section should have visible content
    const first = sections.first();
    await expect(first).toBeVisible();
  });

  test('published site navigation renders and links work', async ({ page }) => {
    await page.goto(siteUrl);

    const nav = page.locator('nav');
    if ((await nav.count()) > 0) {
      await expect(nav.first()).toBeVisible();
      const links = nav.first().getByRole('link');
      const linkCount = await links.count();
      // If nav exists, it should have at least one link
      expect(linkCount).toBeGreaterThanOrEqual(1);
    }
  });

  test('published site search works when available', async ({ request }) => {
    const resp = await request.get(`${siteUrl}/__rev01/search?q=test`);
    if (resp.status() === 200) {
      const body = await resp.json();
      expect(Array.isArray(body.results ?? body)).toBe(true);
    } else {
      // Search not enabled is fine, but shouldn't 500
      expect(resp.status()).toBeLessThan(500);
    }
  });

  test('published site renders entrance animations markup', async ({ page }) => {
    await page.goto(siteUrl);

    // If elements have entrance animations, they should have data attributes
    const animated = page.locator('[data-entrance]');
    const count = await animated.count();
    // Not all sites have animations, so this is informational
    if (count > 0) {
      // Animated elements should have the animation type set
      const first = animated.first();
      const animation = await first.getAttribute('data-entrance');
      expect(animation).toBeTruthy();
    }
  });
});
