// scripts/seed-apogee-demo.ts
//
// Backfills runtime data that the Apogee Showcase template cannot express
// in the JSON fixture — form submissions, addon entitlements + per-site
// activation, and named version snapshots — so every dashboard panel has
// something to show during a demo.
//
// Usage:
//   bun run scripts/seed-apogee-demo.ts <subdomain>
//
// Example:
//   bun run scripts/seed-apogee-demo.ts apogee
//
// Requires DATABASE_URL in the environment (.dev.vars works).
//
// The script is idempotent for addons (uniqueIndex on (customer, addon) /
// (site, addon)) and best-effort for submissions/snapshots — re-running
// stacks more rows rather than dedup'ing. Per the project's all-or-nothing
// posture, every DB error throws with the SQL message intact.

import { eq } from 'drizzle-orm';

import { db, type Db } from '../src/db/client.js';
import {
  addonEntitlement,
  formSubmission,
  site,
  siteAddon,
} from '../src/db/schema.js';
import { captureManual } from '../src/version/capture.js';

const APOGEE_FORM_ELEMENT_ID = 'wf-form-element';
const ENTERPRISE_PAGE_SLUG = 'enterprise';

const GA_ADDON_ID = 'addon_google_analytics';
const CUSTOM_SCRIPTS_ADDON_ID = 'addon_custom_scripts';

const DEMO_SUBMISSIONS: ReadonlyArray<{
  ipHash: string;
  userAgent: string;
  submittedAtIso: string;
  payload: Record<string, unknown>;
}> = [
  {
    ipHash: 'b7c2d8a4f1e0936c5a8b1d2f4e6c7a90',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15',
    submittedAtIso: '2026-05-26T14:22:31.000Z',
    payload: {
      name: 'Priya Shah',
      email: 'priya.shah@northwindtrading.com',
      company: 'Northwind Trading Co.',
      size: '201-1000',
      message:
        'Looking to migrate 14 marketing microsites onto a single platform with shared design tokens and AEO. Need a sandbox by end of June.',
      consent: true,
    },
  },
  {
    ipHash: 'a93e1f508c2d4b67e8a90b1c2d3e4f56',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0',
    submittedAtIso: '2026-05-26T17:08:14.000Z',
    payload: {
      name: 'Dimitri Kowalski',
      email: 'd.kowalski@altusbrands.eu',
      company: 'Altus Brands GmbH',
      size: '51-200',
      message:
        'We run 6 country sites in 4 languages. RTL support and per-locale SEO are deal-breakers. Anyone we can pilot with this quarter?',
      consent: true,
    },
  },
  {
    ipHash: '4f1a0b2c3d4e5f60718293a4b5c6d7e8',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
    submittedAtIso: '2026-05-27T09:41:55.000Z',
    payload: {
      name: 'Marcus Lin',
      email: 'marcus@kinetic.studio',
      company: 'Kinetic Studio',
      size: '11-50',
      message:
        "Design studio — we'd hand-off to clients via Apogee instead of a legacy site builder if collaborator roles and version history hold up.",
      consent: false,
    },
  },
  {
    ipHash: 'cafe0011223344556677889900112233',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0',
    submittedAtIso: '2026-05-27T22:03:09.000Z',
    payload: {
      name: 'Aiko Tanaka',
      email: 'aiko.tanaka@osc-robotics.jp',
      company: 'OSC Robotics',
      size: '1000+',
      message:
        'Investor relations + careers site rebuild, ~40 pages, 3 locales (ja/en/zh). Need SOC 2 evidence and SSO before procurement.',
      consent: true,
    },
  },
  {
    ipHash: 'beef1234567890abcdef1234567890ab',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) Safari/605.1.15',
    submittedAtIso: '2026-05-28T11:17:42.000Z',
    payload: {
      name: 'Helen Okoro',
      email: 'helen.okoro@adunni-financial.ng',
      company: 'Adunni Financial',
      size: '201-1000',
      message:
        'How does Apogee handle press releases via the CMS Collection? Need an editorial workflow with scheduled publish.',
      consent: true,
    },
  },
];

const DEMO_SNAPSHOT_LABELS = [
  'Pre-launch — copy lockdown',
  'Pricing v2 with enterprise tier',
  'Add Apogee AEO callout',
];

interface SeedCtx {
  database: Db;
  siteRow: { id: string; customerId: string };
  pruneEnv: unknown;
}

async function seedFormSubmissions(ctx: SeedCtx): Promise<number> {
  const rows = DEMO_SUBMISSIONS.map((demo) => ({
    siteId: ctx.siteRow.id,
    formElementId: APOGEE_FORM_ELEMENT_ID,
    pageSlug: ENTERPRISE_PAGE_SLUG,
    payload: demo.payload,
    ipHash: demo.ipHash,
    userAgent: demo.userAgent,
    submittedAt: new Date(demo.submittedAtIso),
  }));
  await ctx.database.insert(formSubmission).values(rows);
  return rows.length;
}

async function ensureAddonEntitlement(
  ctx: SeedCtx,
  addonId: string,
): Promise<void> {
  await ctx.database
    .insert(addonEntitlement)
    .values({ customerId: ctx.siteRow.customerId, addonId })
    .onConflictDoNothing();
}

async function ensureSiteAddon(
  ctx: SeedCtx,
  addonId: string,
  config: Record<string, string>,
): Promise<void> {
  await ctx.database
    .insert(siteAddon)
    .values({
      siteId: ctx.siteRow.id,
      addonId,
      enabled: true,
      config,
    })
    .onConflictDoUpdate({
      target: [siteAddon.siteId, siteAddon.addonId],
      set: { enabled: true, config, updatedAt: new Date() },
    });
}

async function seedAddons(ctx: SeedCtx): Promise<void> {
  await ensureAddonEntitlement(ctx, GA_ADDON_ID);
  await ensureSiteAddon(ctx, GA_ADDON_ID, { measurementId: 'G-DEMO123APOGEE' });

  await ensureAddonEntitlement(ctx, CUSTOM_SCRIPTS_ADDON_ID);
  await ensureSiteAddon(ctx, CUSTOM_SCRIPTS_ADDON_ID, {
    headScripts:
      "<script>window.__apogeeDemo=true;console.log('Apogee custom scripts loaded')</script>",
    bodyScripts: '',
  });
}

async function seedSnapshots(ctx: SeedCtx): Promise<number> {
  for (const label of DEMO_SNAPSHOT_LABELS) {
    await captureManual(ctx.siteRow.id, label, ctx.database, ctx.pruneEnv);
  }
  return DEMO_SNAPSHOT_LABELS.length;
}

async function main(): Promise<void> {
  const subdomain = process.argv[2];
  if (!subdomain || subdomain.length === 0) {
    throw new Error(
      'Usage: bun run scripts/seed-apogee-demo.ts <subdomain>\n' +
        '  e.g. bun run scripts/seed-apogee-demo.ts apogee',
    );
  }

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required in the environment.');
  }

  const database = db({ DATABASE_URL: databaseUrl });

  const rows = await database
    .select({ id: site.id, customerId: site.customerId, name: site.name })
    .from(site)
    .where(eq(site.subdomain, subdomain))
    .limit(1);

  const siteRow = rows[0];
  if (!siteRow) {
    throw new Error(
      `No site with subdomain "${subdomain}". Create one from the Apogee Showcase template first.`,
    );
  }

  console.log(`[seed-apogee-demo] target site: ${siteRow.name} (${siteRow.id})`);

  const ctx: SeedCtx = { database, siteRow, pruneEnv: {} };

  const submissionCount = await seedFormSubmissions(ctx);
  console.log(`[seed-apogee-demo] inserted ${String(submissionCount)} form submissions`);

  await seedAddons(ctx);
  console.log('[seed-apogee-demo] enabled Google Analytics + Custom Scripts addons');

  const snapshotCount = await seedSnapshots(ctx);
  console.log(`[seed-apogee-demo] captured ${String(snapshotCount)} named snapshots`);

  console.log('');
  console.log('[seed-apogee-demo] DONE. Demo-only TODOs left for you (require real bytes):');
  console.log('  1. Upload a real favicon via /dashboard/sites/' + siteRow.id + '/settings');
  console.log('     (current: placeholder transparent PNG from seed-feature-canvas-1).');
  console.log('  2. Upload a real OG card image and point each page\'s ogImageAssetId at it');
  console.log('     via /dashboard/sites/' + siteRow.id + '/pages/<pageId>/seo');
  console.log('  3. Upload a real hero background image and re-bind it on the hero panel\'s');
  console.log('     elementStyle.backgroundImageAssetId in the editor.');
  console.log('  4. Upload a short looping mp4 in the editor, then set a section\'s');
  console.log('     backgroundVideo to that asset id (showcases section background video).');
  console.log('  5. Upload a WOFF2 custom font via Site Settings > Fonts (shows the custom');
  console.log('     fonts surface in the dashboard).');
  console.log('  6. Invite a collaborator via Site Settings > Collaborators to show the');
  console.log('     invitation email + access control flow.');
  console.log('  7. Add a custom domain via Site Settings > Domains to show DNS + cert');
  console.log('     verification (skip if there is no spare hostname).');
  console.log('  8. Hit Publish to trigger OG image pre-render, search index rebuild,');
  console.log('     accessibility audit, and a fresh "publish" snapshot.');
}

await main();
