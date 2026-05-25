# Addon System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a purchasable addon system (starting with Google Analytics) where Owners acquire addons per-account and configure them per-site, with the addon's effect injected into the Published Site at render time.

**Architecture:** Two-table DB model separates account-scoped entitlements (`addon_entitlement`) from site-scoped configuration (`site_addon`). A hardcoded TypeScript registry defines available addons and their integration logic. A dedicated emitter function queries active site addons and produces HTML script strings that `public.ts` injects once into the visitor `<head>`. A new "Shop" dashboard tab shows the catalog with mock purchase, and per-site addon settings let Owners enable/configure addons.

**Tech Stack:** Hono + Hono JSX (server-rendered), Drizzle ORM on Neon Postgres, Cloudflare Workers, vanilla JS client scripts.

**Key references:**
- ADR: `docs/adr/0009-addon-entitlement-model.md`
- Domain language: `CONTEXT.md` (Addon, Addon Entitlement, Site Addon, Addon Registry, Addon Shop)
- Existing patterns to follow: `src/routes/dashboard/site-settings.tsx` (dashboard page), `src/templates/registry.ts` (hardcoded registry), `src/routes/public.ts:720-752` (visitor HTML assembly)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/addons/registry.ts` | Addon catalog: interface, GA entry, lookup helpers |
| Create | `src/addons/emit.ts` | `emitAddonHeadScripts()` — queries DB, returns HTML string for `<head>` injection |
| Modify | `src/db/schema.ts` | Add `addonEntitlement` and `siteAddon` table definitions |
| Modify | `src/routes/public.ts` | Call `emitAddonHeadScripts()` and inject result into visitor `<head>` |
| Create | `src/routes/dashboard/addon-shop.tsx` | Shop tab — browse catalog, mock purchase |
| Create | `src/routes/api/addons.ts` | API endpoints — grant entitlement, enable/configure site addon |
| Create | `src/routes/dashboard/site-addons.tsx` | Per-site addon settings page |
| Modify | `src/routes/dashboard/shell.tsx` | Add "Shop" to `NAV_ITEMS` |
| Modify | `src/routes/dashboard/index.tsx` | Wire "Analytics" detail row to site-addons page |
| Modify | `src/index.ts` | Mount new routes |

---

## Task 1: Addon Registry

**Files:**
- Create: `src/addons/registry.ts`

- [ ] **Step 1: Create the addon registry module**

```typescript
// src/addons/registry.ts

export interface AddonConfigField {
  key: string;
  label: string;
  placeholder: string;
  pattern?: string;
  patternHint?: string;
}

export interface AddonDefinition {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  configFields: AddonConfigField[];
  emitHeadScripts: (config: Record<string, string>) => string;
}

function emitGoogleAnalytics(config: Record<string, string>): string {
  const mid = config['measurementId'] ?? '';
  if (!mid) return '';
  return [
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${mid}"></script>`,
    '<script>',
    'window.dataLayer=window.dataLayer||[];',
    'function gtag(){dataLayer.push(arguments);}',
    "gtag('js',new Date());",
    `gtag('config','${mid}');`,
    '</script>',
  ].join('\n');
}

const googleAnalytics: AddonDefinition = {
  id: 'addon_google_analytics',
  slug: 'google-analytics',
  name: 'Google Analytics',
  tagline: 'Track visitor traffic and behaviour on your published site.',
  description:
    'Injects the Google Analytics gtag.js script into every page of your published site. ' +
    'You provide your GA4 Measurement ID (starts with G-) and we handle the rest.',
  configFields: [
    {
      key: 'measurementId',
      label: 'Measurement ID',
      placeholder: 'G-XXXXXXXXXX',
      pattern: '^G-[A-Z0-9]+$',
      patternHint: 'Must start with G- followed by letters and numbers',
    },
  ],
  emitHeadScripts: emitGoogleAnalytics,
};

export const allAddons = [googleAnalytics] as const satisfies readonly AddonDefinition[];

const addonsById = new Map(allAddons.map((a) => [a.id, a]));
const addonsBySlug = new Map(allAddons.map((a) => [a.slug, a]));

export function getAddon(id: string): AddonDefinition | undefined {
  return addonsById.get(id);
}

export function getAddonBySlug(slug: string): AddonDefinition | undefined {
  return addonsBySlug.get(slug);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/addons/registry.ts`

If the project uses a root `tsconfig.json` with strict mode, run the full check instead:

Run: `bun run tsc --noEmit`

Expected: no errors related to `src/addons/registry.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/addons/registry.ts
git commit -m "feat(addons): add addon registry with Google Analytics definition"
```

---

## Task 2: Database Schema — Entitlement and Site Addon Tables

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add `addonEntitlement` table to schema.ts**

Add after the `chatSession` table and its type exports (after line 384), before the `AssetManifestEntry` interface:

```typescript
// -- addonEntitlement (ADR 0009 — addon entitlement model) --------------------
//
// One row per (customer, addon) pair. Represents the fact that an Owner has
// acquired an addon and may enable it on any of their sites. The `addonId`
// matches an entry in the hardcoded addon registry (`src/addons/registry.ts`).
// Rows are never cascade-deleted from site deletion — entitlements are
// account-scoped.
export const addonEntitlement = pgTable(
  'addon_entitlement',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    customerId: text('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    addonId: text('addon_id').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    customerAddonUnique: uniqueIndex('addon_entitlement_customer_addon_unique').on(
      t.customerId,
      t.addonId,
    ),
  }),
);

export type AddonEntitlement = typeof addonEntitlement.$inferSelect;
export type NewAddonEntitlement = typeof addonEntitlement.$inferInsert;
```

- [ ] **Step 2: Add `siteAddon` table to schema.ts**

Add immediately after the `addonEntitlement` type exports:

```typescript
// -- siteAddon (ADR 0009 — addon entitlement model) --------------------------
//
// One row per (site, addon) pair. Stores per-site activation state and
// configuration for an addon the Owner has acquired. The `config` JSONB
// column holds addon-specific key-value pairs (e.g. `{ measurementId: "G-..." }`
// for Google Analytics). Rows are NOT cascade-deleted when an entitlement is
// removed — the config becomes inert until the entitlement is restored.
// Rows ARE cascade-deleted when the site is deleted.
export const siteAddon = pgTable(
  'site_addon',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    addonId: text('addon_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').notNull().$type<Record<string, string>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteAddonUnique: uniqueIndex('site_addon_site_addon_unique').on(t.siteId, t.addonId),
  }),
);

export type SiteAddon = typeof siteAddon.$inferSelect;
export type NewSiteAddon = typeof siteAddon.$inferInsert;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `bun run tsc --noEmit`

Expected: no type errors.

- [ ] **Step 4: Generate the Drizzle migration**

Run: `bun run drizzle-kit generate`

Expected: a new SQL file in `drizzle/` containing `CREATE TABLE addon_entitlement` and `CREATE TABLE site_addon` with the unique indexes.

- [ ] **Step 5: Apply the migration**

Run: `bun run drizzle-kit migrate`

Expected: migration applied successfully.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(addons): add addon_entitlement and site_addon tables"
```

---

## Task 3: Addon Head Script Emitter

**Files:**
- Create: `src/addons/emit.ts`

This function is called once per visitor request in `public.ts`. It queries the `siteAddon` table for enabled addons on this site, cross-checks entitlements, and returns a combined HTML string of all active addon scripts.

- [ ] **Step 1: Create the emitter module**

```typescript
// src/addons/emit.ts

import { and, eq } from 'drizzle-orm';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { addonEntitlement, site, siteAddon } from '../db/schema';
import { getAddon } from './registry';

export async function emitAddonHeadScripts(
  database: NeonHttpDatabase,
  siteId: string,
): Promise<string> {
  const rows = await database
    .select({
      addonId: siteAddon.addonId,
      config: siteAddon.config,
      customerId: site.customerId,
    })
    .from(siteAddon)
    .innerJoin(site, eq(siteAddon.siteId, site.id))
    .where(and(eq(siteAddon.siteId, siteId), eq(siteAddon.enabled, true)));

  if (rows.length === 0) return '';

  const customerId = rows[0]!.customerId;

  const entitlements = await database
    .select({ addonId: addonEntitlement.addonId })
    .from(addonEntitlement)
    .where(eq(addonEntitlement.customerId, customerId));

  const entitled = new Set(entitlements.map((e) => e.addonId));

  const parts: string[] = [];
  for (const row of rows) {
    if (!entitled.has(row.addonId)) continue;
    const addon = getAddon(row.addonId);
    if (!addon) continue;
    const html = addon.emitHeadScripts(row.config);
    if (html) parts.push(html);
  }

  return parts.join('\n');
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bun run tsc --noEmit`

Expected: no type errors. If the `NeonHttpDatabase` import path differs in this project, check `src/db/client.ts` for the actual type exported and adjust the import accordingly.

- [ ] **Step 3: Commit**

```bash
git add src/addons/emit.ts
git commit -m "feat(addons): add addon head script emitter"
```

---

## Task 4: Wire Emitter into Public Host Router

**Files:**
- Modify: `src/routes/public.ts`

- [ ] **Step 1: Add the import**

Add after the existing imports at the top of `src/routes/public.ts` (after the `injectInteractiveRuntime` import around line 60):

```typescript
import { emitAddonHeadScripts } from '../addons/emit';
```

- [ ] **Step 2: Call the emitter and inject the result**

In the visitor response function, after the `headMeta` computation (around line 700) and before the `return c.html(...)` block (around line 720), add:

```typescript
  const addonScripts = await emitAddonHeadScripts(database, siteRow.id);
```

Note: `database` is the Drizzle client instance. Check the surrounding code to confirm the variable name — if the function receives `c` (Hono Context) and creates the DB client inline, you may need to use `db(c.env)` instead. Look at how the existing code in this function obtains its database handle and match that.

Then, in the `html` template literal, inject `addonScripts` into the `<head>` after the `<style>` block and before `</head>`:

Find this block (around line 728-733):

```
          <style>
            ${raw(canvasPublishedStyles)}${raw(customKitCss)}${raw(
              fontFaceCss ? `\n${fontFaceCss}` : '',
            )}${darkModeEnabled ? `\n${dualModeCss}` : ''}
          </style>
        </head>
```

Replace with:

```
          <style>
            ${raw(canvasPublishedStyles)}${raw(customKitCss)}${raw(
              fontFaceCss ? `\n${fontFaceCss}` : '',
            )}${darkModeEnabled ? `\n${dualModeCss}` : ''}
          </style>
          ${addonScripts ? raw(addonScripts) : ''}
        </head>
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `bun run tsc --noEmit`

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/public.ts
git commit -m "feat(addons): wire addon script emitter into visitor HTML head"
```

---

## Task 5: API Endpoints — Entitlement Grant + Site Addon Config

**Files:**
- Create: `src/routes/api/addons.ts`

- [ ] **Step 1: Create the API route module**

```typescript
// src/routes/api/addons.ts

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { addonEntitlement, customer, site, siteAddon } from '../../db/schema';
import { getAddon } from '../../addons/registry';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const addonsApi = new Hono<Env>();

addonsApi.use('*', clerkAuth());
addonsApi.use('*', requireAuth());

async function resolveCustomerId(
  env: Bindings,
  clerkUserId: string,
): Promise<string | null> {
  const database = db(env);
  const rows = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0]?.id ?? null;
}

// POST /api/addons/:addonId/acquire — mock purchase, grants entitlement
addonsApi.post('/:addonId/acquire', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) return c.json({ error: 'unauthorized' }, 401);

  const addonId = c.req.param('addonId');
  const addon = getAddon(addonId);
  if (!addon) return c.json({ error: 'addon not found' }, 404);

  const customerId = await resolveCustomerId(c.env, auth.userId);
  if (!customerId) return c.json({ error: 'customer not found' }, 404);

  const database = db(c.env);

  const existing = await database
    .select({ id: addonEntitlement.id })
    .from(addonEntitlement)
    .where(
      and(
        eq(addonEntitlement.customerId, customerId),
        eq(addonEntitlement.addonId, addonId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return c.json({ ok: true, alreadyOwned: true });
  }

  await database.insert(addonEntitlement).values({
    customerId,
    addonId,
  });

  return c.json({ ok: true });
});

// DELETE /api/addons/:addonId/acquire — revoke entitlement
addonsApi.delete('/:addonId/acquire', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) return c.json({ error: 'unauthorized' }, 401);

  const addonId = c.req.param('addonId');
  const customerId = await resolveCustomerId(c.env, auth.userId);
  if (!customerId) return c.json({ error: 'customer not found' }, 404);

  const database = db(c.env);
  await database
    .delete(addonEntitlement)
    .where(
      and(
        eq(addonEntitlement.customerId, customerId),
        eq(addonEntitlement.addonId, addonId),
      ),
    );

  return c.json({ ok: true });
});

// PUT /api/addons/sites/:siteId/:addonId — enable + configure site addon
addonsApi.put('/sites/:siteId/:addonId', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) return c.json({ error: 'unauthorized' }, 401);

  const { siteId, addonId } = c.req.param();
  const addon = getAddon(addonId);
  if (!addon) return c.json({ error: 'addon not found' }, 404);

  const customerId = await resolveCustomerId(c.env, auth.userId);
  if (!customerId) return c.json({ error: 'customer not found' }, 404);

  const database = db(c.env);

  // Verify ownership
  const siteRow = await database
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  if (siteRow.length === 0) return c.json({ error: 'site not found' }, 404);

  // Verify entitlement
  const ent = await database
    .select({ id: addonEntitlement.id })
    .from(addonEntitlement)
    .where(
      and(
        eq(addonEntitlement.customerId, customerId),
        eq(addonEntitlement.addonId, addonId),
      ),
    )
    .limit(1);
  if (ent.length === 0) {
    return c.json({ error: 'addon not purchased' }, 403);
  }

  const body = await c.req.json<{ enabled: boolean; config: Record<string, string> }>();

  // Validate config against addon's declared fields
  for (const field of addon.configFields) {
    const value = body.config[field.key];
    if (body.enabled && field.pattern && value) {
      const re = new RegExp(field.pattern);
      if (!re.test(value)) {
        return c.json(
          { error: `Invalid ${field.label}: ${field.patternHint ?? 'invalid format'}` },
          400,
        );
      }
    }
  }

  // Upsert site addon
  await database
    .insert(siteAddon)
    .values({
      siteId,
      addonId,
      enabled: body.enabled,
      config: body.config,
    })
    .onConflictDoUpdate({
      target: [siteAddon.siteId, siteAddon.addonId],
      set: {
        enabled: body.enabled,
        config: body.config,
        updatedAt: new Date(),
      },
    });

  return c.json({ ok: true });
});

// GET /api/addons/sites/:siteId — list site addon states
addonsApi.get('/sites/:siteId', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) return c.json({ error: 'unauthorized' }, 401);

  const siteId = c.req.param('siteId');
  const customerId = await resolveCustomerId(c.env, auth.userId);
  if (!customerId) return c.json({ error: 'customer not found' }, 404);

  const database = db(c.env);

  // Verify ownership
  const siteRow = await database
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  if (siteRow.length === 0) return c.json({ error: 'site not found' }, 404);

  const rows = await database
    .select()
    .from(siteAddon)
    .where(eq(siteAddon.siteId, siteId));

  return c.json({ addons: rows });
});

export default addonsApi;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bun run tsc --noEmit`

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/addons.ts
git commit -m "feat(addons): add API endpoints for entitlement grant and site addon config"
```

---

## Task 6: Addon Shop Dashboard Page

**Files:**
- Create: `src/routes/dashboard/addon-shop.tsx`
- Modify: `src/routes/dashboard/shell.tsx`

- [ ] **Step 1: Add "Shop" to the dashboard nav**

In `src/routes/dashboard/shell.tsx`, find the `NAV_ITEMS` array (line 112-115):

```typescript
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Sites' },
  { href: '/dashboard/templates', label: 'Templates' },
];
```

Replace with:

```typescript
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Sites' },
  { href: '/dashboard/templates', label: 'Templates' },
  { href: '/dashboard/shop', label: 'Shop' },
];
```

- [ ] **Step 2: Create the Shop page**

```typescript
// src/routes/dashboard/addon-shop.tsx

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { customer, addonEntitlement } from '../../db/schema';
import { DashboardShell } from './shell';
import { Button, Badge } from '../../ui';
import { allAddons } from '../../addons/registry';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const addonShopRoute = new Hono<Env>();

addonShopRoute.use('*', clerkAuth());
addonShopRoute.use('*', requireAuth());

const pageStyles = `
  .shop-lede {
    margin: 4px 0 28px;
    color: var(--muted);
    max-width: 560px;
    line-height: 1.55;
    font-size: 14px;
  }
  .addon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 20px;
  }
  .addon-card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .addon-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .addon-card-header h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }
  .addon-card-tagline {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.5;
    margin: 0;
  }
  .addon-card-desc {
    color: var(--faint);
    font-size: 12px;
    line-height: 1.55;
    margin: 0;
  }
  .addon-card-footer {
    margin-top: auto;
    padding-top: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .addon-price {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .btn-acquire {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    font-family: inherit;
    background: var(--accent);
    color: var(--bg);
    transition: filter 0.12s;
  }
  .btn-acquire:hover { filter: brightness(0.88); }
  .btn-acquire:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: none;
  }
  .btn-owned {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    font-family: inherit;
    background: rgba(74,222,128,0.12);
    color: #4ade80;
    cursor: default;
  }
`;

function clientScript(): string {
  return String.raw`
(function() {
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-acquire]');
    if (!btn) return;
    var addonId = btn.getAttribute('data-acquire');
    btn.disabled = true;
    btn.textContent = 'Acquiring...';
    fetch('/api/addons/' + addonId + '/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(result) {
      if (!result.ok) throw new Error(result.data.error || 'Failed');
      location.reload();
    })
    .catch(function(err) {
      btn.textContent = 'Failed — retry';
      btn.disabled = false;
    });
  });
})();
`;
}

addonShopRoute.get('/shop', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('shop reached without authenticated user');

  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;

  let ownedAddonIds = new Set<string>();
  if (customerId) {
    const rows = await database
      .select({ addonId: addonEntitlement.addonId })
      .from(addonEntitlement)
      .where(eq(addonEntitlement.customerId, customerId));
    ownedAddonIds = new Set(rows.map((r) => r.addonId));
  }

  return c.html(
    <DashboardShell
      title="rev01 — addon shop"
      crumbs={[{ href: '/dashboard', label: 'Dashboard' }, { label: 'Shop' }]}
      activePath="/dashboard/shop"
      pageStyles={pageStyles}
    >
      <h1>Addon Shop</h1>
      <p class="shop-lede">
        Extend your sites with powerful integrations. Purchase once, enable on any of your sites.
      </p>

      <div class="addon-grid">
        {allAddons.map((addon) => {
          const owned = ownedAddonIds.has(addon.id);
          return (
            <div class="addon-card">
              <div class="addon-card-header">
                <h3>{addon.name}</h3>
                {owned && <Badge variant="success">Owned</Badge>}
              </div>
              <p class="addon-card-tagline">{addon.tagline}</p>
              <p class="addon-card-desc">{addon.description}</p>
              <div class="addon-card-footer">
                <span class="addon-price">Free</span>
                {owned ? (
                  <span class="btn-owned">Acquired</span>
                ) : (
                  <button type="button" class="btn-acquire" data-acquire={addon.id}>
                    Get addon
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <script>{raw(clientScript())}</script>
    </DashboardShell>,
  );
});

export default addonShopRoute;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `bun run tsc --noEmit`

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/dashboard/addon-shop.tsx src/routes/dashboard/shell.tsx
git commit -m "feat(addons): add Addon Shop dashboard page with mock purchase UI"
```

---

## Task 7: Per-Site Addon Settings Page

**Files:**
- Create: `src/routes/dashboard/site-addons.tsx`

- [ ] **Step 1: Create the per-site addon settings page**

```typescript
// src/routes/dashboard/site-addons.tsx

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { addonEntitlement, customer, site, siteAddon } from '../../db/schema';
import { DashboardShell } from './shell';
import { Button, Badge, Card, Pill } from '../../ui';
import { allAddons } from '../../addons/registry';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const siteAddonsRoute = new Hono<Env>();

siteAddonsRoute.use('*', clerkAuth());
siteAddonsRoute.use('*', requireAuth());

const pageStyles = `
  .lede {
    margin: 8px 0 24px;
    color: var(--muted);
    max-width: 640px;
    line-height: 1.55;
  }
  .addon-section {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 20px;
  }
  .addon-section-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
  }
  .addon-section-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .addon-section-desc {
    color: var(--muted);
    font-size: 13px;
    margin: 0 0 20px;
  }
  .not-purchased {
    color: var(--faint);
    font-size: 13px;
  }
  .not-purchased a {
    color: var(--accent);
  }
  .field-group {
    margin-bottom: 16px;
  }
  .field-group label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--muted);
    margin-bottom: 5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .field-group input {
    width: 100%;
    max-width: 360px;
    padding: 9px 12px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    outline: none;
    box-sizing: border-box;
  }
  .field-group input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(125,211,252,0.15);
  }
  .field-hint {
    font-size: 11px;
    color: var(--faint);
    margin-top: 4px;
  }
  .toggle-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .toggle-label {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
  }
  .addon-actions {
    display: flex;
    gap: 8px;
    margin-top: 20px;
  }
  .msg {
    font-size: 13px;
    margin-top: 12px;
  }
  .msg-ok { color: #4ade80; }
  .msg-err { color: #ef4444; }
`;

function clientScript(siteId: string): string {
  const sid = JSON.stringify(siteId);
  return String.raw`
(function() {
  var SITE_ID = ${sid};

  document.querySelectorAll('[data-addon-form]').forEach(function(form) {
    var addonId = form.getAttribute('data-addon-form');
    var msgEl = form.querySelector('.addon-msg');
    var saveBtn = form.querySelector('[data-save]');

    saveBtn.addEventListener('click', function() {
      var enabledEl = form.querySelector('[name="enabled"]');
      var enabled = enabledEl ? enabledEl.checked : false;
      var config = {};
      form.querySelectorAll('[data-config-key]').forEach(function(input) {
        config[input.getAttribute('data-config-key')] = input.value.trim();
      });

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      if (msgEl) { msgEl.textContent = ''; msgEl.className = 'addon-msg msg'; }

      fetch('/api/addons/sites/' + SITE_ID + '/' + addonId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabled, config: config }),
      })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(result) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        if (!result.ok) throw new Error(result.data.error || 'Save failed');
        if (msgEl) { msgEl.textContent = 'Saved. Publish your site to apply changes.'; msgEl.className = 'addon-msg msg msg-ok'; }
      })
      .catch(function(err) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        if (msgEl) { msgEl.textContent = err.message; msgEl.className = 'addon-msg msg msg-err'; }
      });
    });
  });
})();
`;
}

siteAddonsRoute.get('/sites/:siteId/addons', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('addons page reached without authenticated user');

  const siteId = c.req.param('siteId');
  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return c.text('not found', 404);

  const siteRow = await database
    .select({ id: site.id, name: site.name })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  if (siteRow.length === 0) return c.text('site not found', 404);
  const owned = siteRow[0]!;

  // Fetch entitlements
  const entRows = await database
    .select({ addonId: addonEntitlement.addonId })
    .from(addonEntitlement)
    .where(eq(addonEntitlement.customerId, customerId));
  const entitled = new Set(entRows.map((r) => r.addonId));

  // Fetch existing site addon configs
  const saRows = await database
    .select()
    .from(siteAddon)
    .where(eq(siteAddon.siteId, siteId));
  const siteAddonMap = new Map(saRows.map((r) => [r.addonId, r]));

  return c.html(
    <DashboardShell
      title={`${owned.name} — addons`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${siteId}/edit`, label: owned.name },
        { label: 'Addons' },
      ]}
      pageStyles={pageStyles}
    >
      <h1>Addons</h1>
      <p class="lede">
        Enable and configure addons for this site. Changes take effect on the next publish.
      </p>

      {allAddons.map((addon) => {
        const hasEntitlement = entitled.has(addon.id);
        const sa = siteAddonMap.get(addon.id);
        const isEnabled = sa?.enabled ?? false;
        const config = (sa?.config ?? {}) as Record<string, string>;

        return (
          <div class="addon-section" data-addon-form={addon.id}>
            <div class="addon-section-header">
              <h2>{addon.name}</h2>
              {hasEntitlement && <Badge variant="success">Owned</Badge>}
              {hasEntitlement && (
                <Pill variant={isEnabled ? 'on' : 'off'}>
                  {isEnabled ? 'Enabled' : 'Disabled'}
                </Pill>
              )}
            </div>
            <p class="addon-section-desc">{addon.tagline}</p>

            {!hasEntitlement ? (
              <p class="not-purchased">
                You haven't acquired this addon yet.{' '}
                <a href="/dashboard/shop">Visit the Shop</a> to get it.
              </p>
            ) : (
              <>
                <div class="toggle-row">
                  <input
                    type="checkbox"
                    name="enabled"
                    id={`toggle-${addon.id}`}
                    checked={isEnabled}
                  />
                  <label class="toggle-label" for={`toggle-${addon.id}`}>
                    Enable on this site
                  </label>
                </div>

                {addon.configFields.map((field) => (
                  <div class="field-group">
                    <label for={`field-${addon.id}-${field.key}`}>{field.label}</label>
                    <input
                      type="text"
                      id={`field-${addon.id}-${field.key}`}
                      data-config-key={field.key}
                      value={config[field.key] ?? ''}
                      placeholder={field.placeholder}
                      pattern={field.pattern}
                    />
                    {field.patternHint && <p class="field-hint">{field.patternHint}</p>}
                  </div>
                ))}

                <div class="addon-actions">
                  <Button variant="primary" size="sm" data-save="true">
                    Save
                  </Button>
                </div>
                <p class="addon-msg msg"></p>
              </>
            )}
          </div>
        );
      })}

      <script>{raw(clientScript(siteId))}</script>
    </DashboardShell>,
  );
});

export default siteAddonsRoute;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bun run tsc --noEmit`

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/dashboard/site-addons.tsx
git commit -m "feat(addons): add per-site addon settings dashboard page"
```

---

## Task 8: Wire Routes into Main App + Update Dashboard Details Panel

**Files:**
- Modify: `src/index.ts`
- Modify: `src/routes/dashboard/index.tsx`

- [ ] **Step 1: Add imports and mount routes in `src/index.ts`**

Add imports after the existing dashboard route imports (around line 42, after the `chatPanelRoute` import):

```typescript
import addonShopRoute from './routes/dashboard/addon-shop';
import siteAddonsRoute from './routes/dashboard/site-addons';
import addonsApi from './routes/api/addons';
```

Add route mounts after the existing Wave 5 mounts (around line 217, after the `chatPanelRoute` mount):

```typescript
// Addon system (ADR 0009)
app.route('/dashboard', addonShopRoute);
app.route('/dashboard', siteAddonsRoute);
app.route('/api/addons', addonsApi);
```

- [ ] **Step 2: Update the Analytics detail row in the dashboard index**

In `src/routes/dashboard/index.tsx`, find the `DetailsPanel` component's Analytics row (around line 852):

```typescript
          <DetailRow label="Analytics">
            <Pill variant="off">Not connected</Pill>
          </DetailRow>
```

Replace with:

```typescript
          <DetailRow label="Analytics" href={`${editBase}/addons`}>
            <Pill variant="off">Not connected</Pill>
          </DetailRow>
```

This makes the "Analytics" row clickable, linking to the per-site addons page.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `bun run tsc --noEmit`

Expected: no type errors.

- [ ] **Step 4: Run the dev server and verify**

Run: `bun run dev`

Verify:
1. Navigate to `/dashboard` — "Shop" tab appears in the header nav.
2. Click "Shop" — shows the Google Analytics addon card with "Get addon" button.
3. Click "Get addon" — page reloads, card now shows "Owned" badge and "Acquired" button.
4. Navigate to any site's dashboard card, expand details — "Analytics" row is now a link.
5. Click the Analytics row — navigates to `/dashboard/sites/:siteId/addons`.
6. Addons page shows GA section with "Owned" badge and enable toggle + Measurement ID field.
7. Enable toggle, enter a Measurement ID (e.g. `G-TEST12345`), click Save — "Saved" message appears.
8. Publish the site, then visit the published address and view page source — the gtag.js script block is present in the `<head>` with the configured Measurement ID.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/routes/dashboard/index.tsx
git commit -m "feat(addons): wire addon routes into main app and link dashboard analytics row"
```

---

## Task 9: Verify the DB Client Type in the Emitter

**Files:**
- Possibly modify: `src/addons/emit.ts`

The emitter (`src/addons/emit.ts`) imports `NeonHttpDatabase` from `drizzle-orm/neon-http`. This must match the actual type returned by `db()` in `src/db/client.ts`.

- [ ] **Step 1: Check the DB client type**

Read `src/db/client.ts` and check what type the `db()` function returns. If it returns a different type (e.g., `NeonDatabase` or uses a different driver), update the import in `src/addons/emit.ts` to match.

If the `db()` function returns the database instance directly without a wrapper type (common pattern: `export function db(env: Bindings) { return drizzle(neon(env.DATABASE_URL)); }`), then the parameter type in `emitAddonHeadScripts` should match whatever `drizzle()` returns.

The simplest fix if types don't align: change the parameter type to accept the return type of `db()`, or use a generic type like `Parameters<typeof db> extends [infer E] ? ReturnType<typeof db> : never` — but in practice, just match the import to what `src/db/client.ts` actually exports.

- [ ] **Step 2: Fix if needed and verify**

Run: `bun run tsc --noEmit`

Expected: no type errors.

- [ ] **Step 3: Commit if changes were needed**

```bash
git add src/addons/emit.ts
git commit -m "fix(addons): align emitter DB client type with project db client"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** ADR 0009 decisions 1-4 all have corresponding tasks. Two tables (Task 2), registry (Task 1), emitter (Task 3), soft-disable (Decision 4 is enforced by the emitter's entitlement check — no cascade delete in schema).
- [x] **Placeholder scan:** All steps have complete code. No TBD/TODO. Every file path is exact.
- [x] **Type consistency:** `addonId` is consistently `text` (DB) / `string` (TS). `config` is consistently `Record<string, string>`. `AddonDefinition.id` matches `addonEntitlement.addonId` matches `siteAddon.addonId`. `emitHeadScripts` signature matches usage in `emit.ts`. `getAddon()` is used in both `emit.ts` and `addons.ts` with the same return type.
- [x] **Dashboard index "Analytics" row:** Updated to link to the addons page (Task 8 Step 2). The `Pill variant` stays "off" for now — a future enhancement could make this dynamic by querying `siteAddon` in the dashboard index, but that's out of scope for this plan.
