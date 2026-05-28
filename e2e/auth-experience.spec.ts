import { test, expect } from '@playwright/test';

// An unauthenticated user tries to access protected pages and APIs.
// Every gate should be clear: either a redirect to sign-in (for pages)
// or a clean JSON error (for APIs). Never a 500, never a blank page,
// never an HTML error page for an API route.

test.describe('Unauthenticated user — page redirects', () => {
  const protectedPages = [
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'Editor', path: '/dashboard/sites/fake-id/edit' },
    { name: 'Templates', path: '/dashboard/templates' },
    { name: 'Addon shop', path: '/dashboard/shop' },
    { name: 'Site settings', path: '/dashboard/sites/fake-id/settings' },
    { name: 'Profile', path: '/dashboard/profile' },
    { name: 'Account settings', path: '/dashboard/settings' },
  ];

  for (const { name, path } of protectedPages) {
    test(`${name} redirects to sign-in — not a 500 or blank page`, async ({ request }) => {
      const resp = await request.get(path, { maxRedirects: 0 });
      // Should be a redirect (302) to Clerk sign-in, not a server error
      expect(resp.status()).toBe(302);
      const location = resp.headers()['location'] ?? '';
      expect(location).toContain('sign-in');
    });
  }

  test('the sign-in redirect lands on Clerk — not a blank dead-end', async ({ page, baseURL }) => {
    test.skip(!baseURL?.startsWith('https'), 'Clerk redirect only testable against prod');
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    // The URL should indicate we're at a sign-in page
    expect(page.url()).toMatch(/sign-in|accounts|clerk/i);
    // Clerk renders via JS — wait for it to hydrate (up to 10s)
    await page.waitForFunction(
      () => document.querySelectorAll('input, button, form, [data-clerk], iframe').length > 0,
      { timeout: 10_000 },
    ).catch(() => {});
    // After waiting, there should be interactive elements
    const interactiveCount = await page.evaluate(() =>
      document.querySelectorAll('input, button, form, [data-clerk], iframe').length,
    );
    expect(interactiveCount).toBeGreaterThan(0);
  });
});

test.describe('Unauthenticated user — API responses', () => {
  const apiEndpoints = [
    { method: 'GET', path: '/api/sites', name: 'sites list' },
    { method: 'GET', path: '/api/canvas/sites/fake-id', name: 'canvas state' },
    { method: 'POST', path: '/api/publish/sites/fake-id', name: 'publish' },
    { method: 'GET', path: '/api/owner/assets', name: 'owner assets' },
    { method: 'POST', path: '/api/custom-templates', name: 'create template' },
    { method: 'GET', path: '/api/sites/fake-id/collaborators', name: 'collaborators' },
    { method: 'GET', path: '/api/sites/fake-id/snapshots', name: 'version history' },
    { method: 'GET', path: '/api/sites/fake-id/domains', name: 'custom domains' },
    { method: 'PUT', path: '/api/sites/fake-id/password', name: 'password admin' },
    { method: 'POST', path: '/api/sites/fake-id/chat', name: 'chat' },
    { method: 'GET', path: '/api/sites/fake-id/symbols', name: 'symbols' },
    { method: 'GET', path: '/api/sites/fake-id/fonts', name: 'fonts' },
    { method: 'POST', path: '/api/import', name: 'import' },
    { method: 'GET', path: '/api/library/sections', name: 'library sections' },
    { method: 'GET', path: '/api/on-site-edit?siteId=fake', name: 'on-site-edit' },
    { method: 'POST', path: '/api/addons/fake-addon/acquire', name: 'addon acquire' },
    { method: 'GET', path: '/api/addons/sites/fake-id', name: 'site addons' },
    { method: 'PUT', path: '/api/addons/sites/fake-id/fake-addon', name: 'addon config' },
    { method: 'POST', path: '/api/sites/fake-id/translate', name: 'translate' },
  ];

  for (const { method, path, name } of apiEndpoints) {
    test(`${name} (${method} ${path}) returns 401 JSON — not a 500 or HTML`, async ({ request }) => {
      const opts = {
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        ...(method !== 'GET' ? { data: {} } : {}),
      };

      const resp = method === 'GET'
        ? await request.get(path, opts)
        : method === 'POST'
          ? await request.post(path, opts)
          : await request.put(path, opts);

      expect(resp.status()).toBe(401);

      // Response should be JSON with an error field, not an HTML stack trace
      const ct = resp.headers()['content-type'] ?? '';
      expect(ct).toContain('json');
      const body = await resp.json();
      expect(body.error).toBeTruthy();
    });
  }

  test('edit-token auth — missing cookie returns clean 401', async ({ request }) => {
    const resp = await request.get('/__api/canvas/sites/fake-id', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body.error).toBe('unauthorized');
  });
});
