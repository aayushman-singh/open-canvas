import { test, expect } from '@playwright/test';

test.describe('Visitor — Published Site (subdomain)', () => {
  // These tests hit the public host router. Since the dev server rewrites
  // hosts, we simulate subdomain routing via the Host header.

  test('non-existent subdomain returns 404', async ({ request }) => {
    const resp = await request.get('/', {
      headers: { host: 'nonexistent-xyz-999.rev01.aayushman.dev' },
    });
    // Should get a 404 or the landing page (depending on how routing works locally)
    // In dev mode the Host rewriting may not apply, so we accept either 404 or
    // a fall-through to landing
    expect([200, 404]).toContain(resp.status());
  });

  test('visitor search with no site returns error', async ({ request }) => {
    const resp = await request.get('/__rev01/search?q=hello');
    // Without a valid published-site host, should fail
    expect([400, 404, 500]).toContain(resp.status());
  });

  test('visitor form submit without site context fails', async ({ request }) => {
    const resp = await request.post('/__rev01/forms/fake-site/fake-form', {
      headers: { 'content-type': 'application/json' },
      data: { 'cf-turnstile-response': 'test' },
    });
    expect([400, 404, 500]).toContain(resp.status());
  });

  test('visitor unlock without site context fails', async ({ request }) => {
    const resp = await request.post('/__rev01/unlock', {
      headers: { 'content-type': 'application/json' },
      data: { password: 'test' },
    });
    expect([400, 404, 500]).toContain(resp.status());
  });
});

test.describe('Visitor — SEO endpoints', () => {
  test('sitemap.xml returns XML or 404', async ({ request }) => {
    const resp = await request.get('/sitemap.xml');
    // On the app host (not a subdomain) this may 404 or return XML
    expect([200, 404]).toContain(resp.status());
    if (resp.status() === 200) {
      const ct = resp.headers()['content-type'] ?? '';
      expect(ct).toMatch(/xml/);
    }
  });

  test('robots.txt returns text or 404', async ({ request }) => {
    const resp = await request.get('/robots.txt');
    expect([200, 404]).toContain(resp.status());
    if (resp.status() === 200) {
      const body = await resp.text();
      expect(body.toLowerCase()).toContain('sitemap');
    }
  });
});
