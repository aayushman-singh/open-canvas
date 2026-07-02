import { expect, test } from '@playwright/test';
import { and, eq, isNull } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../src/db/client';
import { customer, customTemplate, site } from '../src/db/schema';

function envFromDotfile(path: string): Record<string, string> {
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined) continue;
    values[key] = value.replace(/^"(.*)"$/, '$1');
  }
  return values;
}

const localEnv = {
  ...envFromDotfile(resolve(process.cwd(), '.env')),
  ...envFromDotfile(resolve(process.cwd(), '.dev.vars')),
  ...process.env,
};

const databaseUrl = localEnv['DATABASE_URL'];

test.describe('Authenticated owner happy path', () => {
  test.skip(!databaseUrl, 'DATABASE_URL is required for the local authenticated owner flow');

  test('owner creates a site from a template and sees it on the dashboard', async ({ browser }) => {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for the local authenticated owner flow');
    }
    const database = db({ DATABASE_URL: databaseUrl });
    const [owner] = await database.select().from(customer).limit(1);
    expect(owner, 'local database must contain at least one customer').toBeTruthy();

    const [template] = await database
      .select({ id: customTemplate.id })
      .from(customTemplate)
      .where(
        and(
          isNull(customTemplate.customerId),
          eq(customTemplate.visibility, 'global'),
          eq(customTemplate.publicationStatus, 'published'),
        ),
      )
      .limit(1);
    expect(template, 'local database must contain at least one published global template').toBeTruthy();

    const suffix = crypto.randomUUID().slice(0, 8);
    const siteName = `Release happy path ${suffix}`;
    const subdomain = `release-${suffix}`;

    const context = await browser.newContext({
      extraHTTPHeaders: {
        'x-smoke-customer-id': owner.id,
      },
    });
    await context.route(
      /\/(?:api\/custom-templates\/[^/]+\/(?:preview|assets\/)|dashboard\/thumbs\/|api\/canvas\/sites\/[^/]+\/assets\/)/,
      (route) => route.abort('blockedbyclient'),
    );

    try {
      const page = await context.newPage();

      await page.goto('/dashboard/templates', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /pick a starting point/i })).toBeVisible();

      const templateRadio = page.locator(`input[name="templateId"][value="${template.id}"]`);
      await expect(templateRadio).toHaveCount(1);
      await page.locator(`label.tpl:has(input[name="templateId"][value="${template.id}"])`).click();
      await expect(templateRadio).toBeChecked();

      await page.getByLabel(/^Site name$/).fill(siteName);
      await page.getByLabel(/^Subdomain/).fill(subdomain);
      await page.getByRole('button', { name: /^Create site$/ }).click();

      await page.waitForURL(/\/dashboard$/);
      await expect(page.getByRole('heading', { name: /your sites/i })).toBeVisible();
      await expect(page.getByText(siteName)).toBeVisible();

      const [created] = await database
        .select({ id: site.id })
        .from(site)
        .where(eq(site.subdomain, subdomain))
        .limit(1);
      expect(created, 'created site row should be persisted').toBeTruthy();
    } finally {
      await database.delete(site).where(eq(site.subdomain, subdomain));
      await context.close();
    }
  });
});
