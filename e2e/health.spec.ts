import { test, expect } from '@playwright/test';

test.describe('Health & Favicon Endpoints', () => {
  test('health endpoint returns ok', async ({ request }) => {
    const resp = await request.get('/health');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe('number');
  });

  test('favicon returns SVG', async ({ request }) => {
    const resp = await request.get('/favicon.ico');
    expect(resp.status()).toBe(200);
    const contentType = resp.headers()['content-type'];
    expect(contentType).toContain('image/svg+xml');
    const body = await resp.text();
    expect(body).toContain('r1');
    expect(body).toContain('<svg');
  });

  test('favicon has cache header', async ({ request }) => {
    const resp = await request.get('/favicon.ico');
    const cacheControl = resp.headers()['cache-control'];
    expect(cacheControl).toContain('public');
    expect(cacheControl).toContain('max-age=86400');
  });
});
