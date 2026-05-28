import { test, expect } from '@playwright/test';

// Backend reliability: health, favicon, cache headers, error handling.
// These are the things that break silently and page someone at 2 AM.

test.describe('Health & uptime', () => {
  test('health endpoint responds with ok and a timestamp', async ({ request }) => {
    const resp = await request.get('/health');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe('number');
    // Timestamp should be recent (within last 60 seconds)
    expect(Math.abs(Date.now() - body.ts)).toBeLessThan(60_000);
  });

  test('health endpoint responds within 2 seconds', async ({ request }) => {
    const start = Date.now();
    await request.get('/health');
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

test.describe('Favicon & branding', () => {
  test('favicon is a valid SVG with brand mark', async ({ request }) => {
    const resp = await request.get('/favicon.ico');
    expect(resp.status()).toBe(200);

    const ct = resp.headers()['content-type'] ?? '';
    expect(ct).toContain('svg');

    const body = await resp.text();
    expect(body).toContain('<svg');
    expect(body).toContain('r1');
  });

  test('favicon has CDN-friendly cache headers', async ({ request }) => {
    const resp = await request.get('/favicon.ico');
    const cc = resp.headers()['cache-control'] ?? '';
    expect(cc).toContain('public');
    // Should cache for at least 1 hour
    const maxAge = parseInt(cc.match(/max-age=(\d+)/)?.[1] ?? '0');
    expect(maxAge).toBeGreaterThanOrEqual(3600);
  });
});

test.describe('Error handling', () => {
  test('non-existent API route returns 404 — not 500', async ({ request }) => {
    const resp = await request.get('/api/this-does-not-exist');
    expect([401, 404]).toContain(resp.status());
  });

  const visitorRoutes = [
    { name: 'search', method: 'GET' as const, path: '/__rev01/search?q=hello' },
    { name: 'form submit', method: 'POST' as const, path: '/__rev01/forms/fake-site/fake-form' },
    { name: 'unlock', method: 'POST' as const, path: '/__rev01/unlock' },
  ];

  for (const { name, method, path } of visitorRoutes) {
    test(`visitor ${name} without site context returns client error — not 500`, async ({ request }) => {
      const resp = method === 'GET'
        ? await request.get(path)
        : await request.post(path, {
            headers: { 'content-type': 'application/json' },
            data: { password: 'test', 'cf-turnstile-response': 'test' },
          });
      expect(resp.status()).toBeGreaterThanOrEqual(400);
      expect(resp.status()).toBeLessThan(500);
    });
  }
});

test.describe('Landing page performance', () => {
  test('landing page loads and becomes interactive within 5 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const dcl = Date.now() - start;

    // DOMContentLoaded within 5s (generous for cold start)
    expect(dcl).toBeLessThan(5000);

    // The main heading should be visible by this point
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 3000 });
  });
});
