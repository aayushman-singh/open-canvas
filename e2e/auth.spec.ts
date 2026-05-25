import { test, expect } from '@playwright/test';

test.describe('Authentication & Authorization', () => {
  test('unauthenticated /dashboard redirects to Clerk sign-in', async ({ page }) => {
    const response = await page.goto('/dashboard');
    const url = page.url();
    // Should redirect to Clerk's account portal
    expect(url).toContain('accounts');
    expect(url).toContain('sign-in');
  });

  test('unauthenticated API request returns 401 JSON', async ({ request }) => {
    const resp = await request.get('/api/sites', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body.error).toBe('unauthorized');
  });

  test('unauthenticated canvas API returns 401', async ({ request }) => {
    const resp = await request.get('/api/canvas/sites/fake-id', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated publish API returns 401', async ({ request }) => {
    const resp = await request.post('/api/publish/sites/fake-id', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated owner assets API returns 401', async ({ request }) => {
    const resp = await request.get('/api/owner/assets', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated template creation returns 401', async ({ request }) => {
    const resp = await request.post('/api/custom-templates', {
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      data: {},
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated collaborators API returns 401', async ({ request }) => {
    const resp = await request.get('/api/sites/fake-id/collaborators', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated version history returns 401', async ({ request }) => {
    const resp = await request.get('/api/sites/fake-id/snapshots', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated custom domain API returns 401', async ({ request }) => {
    const resp = await request.get('/api/sites/fake-id/domains', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated password admin API returns 401', async ({ request }) => {
    const resp = await request.put('/api/sites/fake-id/password', {
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      data: {},
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated chat API returns 401', async ({ request }) => {
    const resp = await request.post('/api/sites/fake-id/chat', {
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      data: {},
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated symbols API returns 401', async ({ request }) => {
    const resp = await request.get('/api/sites/fake-id/symbols', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated fonts API returns 401', async ({ request }) => {
    const resp = await request.get('/api/sites/fake-id/fonts', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated import API returns 401', async ({ request }) => {
    const resp = await request.post('/api/import', {
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      data: { url: 'https://example.com' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated library sections API returns 401', async ({ request }) => {
    const resp = await request.get('/api/library/sections', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated on-site-edit API returns 401', async ({ request }) => {
    const resp = await request.get('/api/on-site-edit?siteId=fake', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated editor page redirects to sign-in', async ({ page }) => {
    await page.goto('/dashboard/sites/fake-id/edit');
    const url = page.url();
    expect(url).toContain('accounts');
    expect(url).toContain('sign-in');
  });

  test('unauthenticated templates page redirects to sign-in', async ({ page }) => {
    await page.goto('/dashboard/templates');
    const url = page.url();
    expect(url).toContain('accounts');
    expect(url).toContain('sign-in');
  });

  test('unauthenticated addon shop page redirects to sign-in', async ({ page }) => {
    await page.goto('/dashboard/shop');
    const url = page.url();
    expect(url).toContain('accounts');
    expect(url).toContain('sign-in');
  });

  test('unauthenticated addon acquire returns 401', async ({ request }) => {
    const resp = await request.post('/api/addons/fake-addon/acquire', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated site addons API returns 401', async ({ request }) => {
    const resp = await request.get('/api/addons/sites/fake-id', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated addon config PUT returns 401', async ({ request }) => {
    const resp = await request.put('/api/addons/sites/fake-id/fake-addon', {
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      data: {},
    });
    expect(resp.status()).toBe(401);
  });

  test('unauthenticated translate API returns 401', async ({ request }) => {
    const resp = await request.post('/api/sites/fake-id/translate', {
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      data: { targetLocale: 'es' },
    });
    expect(resp.status()).toBe(401);
  });

  test('edit token auth — missing cookie returns 401', async ({ request }) => {
    const resp = await request.get('/__api/canvas/sites/fake-id', {
      headers: { accept: 'application/json' },
    });
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body.error).toBe('unauthorized');
  });
});
