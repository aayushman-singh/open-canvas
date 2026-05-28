# Owner Asset and Image Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move media bytes from per-site `site_asset` to per-owner `owner_asset`, add per-`MediaElement` `slot_history`, change AI generation to return bytes without persisting, and replace the inspector's upload-only media controls with a current/history/gallery picker that updates the canvas in realtime and supports cascade-confirmed delete.

**Architecture:** A new `owner_asset` table becomes the asset root, keyed by `customer_id`. Asset ids are preserved across the migration so all existing canvas JSON keeps resolving. A new `slot_history` table sits beside `owner_asset` and is keyed by `(site_id, element_id, asset_id)` with `last_used_at`; entries are upserted on every applied media change. The Replicate generate endpoint stops inserting rows and returns bytes inline; the browser holds the bytes until the owner applies them, at which point a normal upload-style POST creates the `owner_asset`. The inspector's media controls become a vertical stack: thumbnail of the current image, an MRU history row of the last 4 owner assets ever applied to this element, then the full owner-wide gallery sorted by `last_used_at`. Deletion of an owner asset requires a confirm modal that enumerates affected elements and published addresses; on confirm the rows cascade.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, Drizzle ORM against Neon Postgres, Clerk auth, vanilla DOM in `canvas-client.ts`, Bun for running smoke scripts.

**Verification convention:** This repo verifies behaviour with Bun-run smoke scripts (`bun.cmd run canvas:smoke`, `bun.cmd run review:smoke`), not a unit-test framework. Each phase extends the existing smokes (or adds a new one in the same shape) and runs them to confirm green.

---

## Pre-flight reads (do these before Task 1)

The engineer should skim these so the rest of the plan makes sense:

- [CONTEXT.md](../../../CONTEXT.md) — the glossary. The terms **Owner Asset**, **Slot History**, **Media Element**, **Published Snapshot**, and **Editable Site** are used precisely throughout this plan.
- [docs/adr/0004-owner-asset.md](../../adr/0004-owner-asset.md) — the four decisions this plan implements.
- [src/db/schema.ts](../../../src/db/schema.ts) — current Drizzle schema. `customer`, `site`, `siteAsset`, `page`.
- [src/assets/site-assets.ts](../../../src/assets/site-assets.ts) — pure helpers (`dataUrlToAsset`, `assetResponse`, `collectReferencedAssets`, `findAssetReferenceErrors`). These will be renamed in Phase 7.
- [src/routes/api/canvas.ts](../../../src/routes/api/canvas.ts) — current upload, generate, peek routes (lines 164–415). All move.
- [src/routes/api/sites.ts](../../../src/routes/api/sites.ts) — site creation; seed assets are inserted at lines 269–274 via `prepareSeedAssetsForSite`.
- [src/routes/public.ts](../../../src/routes/public.ts) — visitor-facing `/assets/:assetId` route at lines 267–294.
- [src/routes/api/publish.ts](../../../src/routes/api/publish.ts) — publish guard reads `siteAsset` to validate references.
- [src/routes/api/canvas-agent.ts](../../../src/routes/api/canvas-agent.ts) — agent tools that produce media.
- [src/editor/canvas-client.ts](../../../src/editor/canvas-client.ts) — vanilla-DOM editor; current media controls live at lines 1201–1740 (inspector append, cropper modal, upload POST, generator).
- [src/canvas/seed-assets.ts](../../../src/canvas/seed-assets.ts) — seed registry.
- [src/review-smoke.ts](../../../src/review-smoke.ts) — the project's end-to-end smoke. Pattern to follow for new smokes.

---

## File map

### Created

- `drizzle/0001_owner_asset.sql` — manual SQL migration: create `owner_asset`, copy rows from `site_asset` reparenting via `site.customer_id`, create `slot_history`. Does **not** drop `site_asset` (Phase 7 does that, after all code has switched).
- `drizzle/0002_drop_site_asset.sql` — drop `site_asset` after code switch is verified.
- `src/assets/owner-assets.ts` — replaces `site-assets.ts` once Phase 7 lands. New canonical asset helpers and new domain functions: `findAssetUsage`, `findAffectedPublishedSites`, `upsertSlotHistoryEntry`.
- `src/routes/api/assets.ts` — owner-scoped REST: `POST /me/assets`, `GET /me/assets`, `GET /me/assets/:assetId`, `GET /me/assets/:assetId/usage`, `DELETE /me/assets/:assetId`, `POST /me/assets/generate`. Each handler is short; the helpers live in `src/assets/owner-assets.ts`.
- `src/routes/api/slot-history.ts` — `GET /sites/:siteId/elements/:elementId/history`, `PUT /sites/:siteId/elements/:elementId/history/:assetId` (MRU upsert), `DELETE /sites/:siteId/elements/:elementId/history` (cleanup hook for element delete).
- `src/editor/media-picker.ts` — the new inspector picker module. Exports `mountMediaPicker(host: HTMLElement, ctx: PickerContext)`. Owns the picker DOM, fetches the gallery, renders the current/history/gallery rows, handles clicks, calls into `rebuildElement` + `scheduleSave`, and runs the delete-confirm modal.
- `src/editor/preview-bytes.ts` — tiny module that holds an in-memory map of `previewId → { bytesBase64, mediaType, alt, kind }` during AI generation. Cleared when the editor session ends; used to POST bytes to `/me/assets` on Apply.
- `src/owner-asset-smoke.ts` — new smoke script that exercises: create customer + site, generate (no insert), apply (insert), upload (insert), gallery list, slot-history upsert, usage probe, delete with cascade, publish guard still green.

### Modified

- `src/db/schema.ts` — add `ownerAsset` and `slotHistory` table definitions. Keep `siteAsset` until Phase 7.
- `src/db/client.ts` — no change expected (existing client is generic).
- `src/canvas/seed-assets.ts` — registry stays. Adjacent helper `prepareSeedAssetsForSite` (currently in `routes/api/sites.ts`) is replaced by a new `prepareSeedOwnerAssetsForSite` that produces rows keyed by `customer_id`.
- `src/routes/api/sites.ts` — switch seed insertion from `site_asset` to `owner_asset`; update `prepareSeedAssetsForSite` accordingly (rename to `prepareSeedOwnerAssetsForSite`).
- `src/routes/api/canvas.ts` — remove `/sites/:siteId/assets`, `/sites/:siteId/assets/generate`, `/sites/:siteId/assets/:assetId` (covered now by `src/routes/api/assets.ts`). Leave non-asset canvas routes alone.
- `src/routes/api/publish.ts` — switch the publish guard's reference check to read `ownerAsset` joined to `site.customerId`.
- `src/routes/api/canvas-agent.ts` — agent media tools persist via the new `/me/assets` apply path (or via the shared `owner-assets.ts` helper); discarded agent previews no longer create rows.
- `src/routes/public.ts` — visitor `/assets/:assetId` reads `ownerAsset` and gates on "asset id is in `siteRow.publishedSnapshot.pages` reference set" only.
- `src/assets/site-assets.ts` — kept as a thin re-export shim during Phases 1–6 to avoid mass import churn; deleted in Phase 7 after callers migrate to `owner-assets.ts`.
- `src/editor/canvas-client.ts` — the entire media-element branch in `appendInspector` (around lines 1201–1214) calls `mountMediaPicker(host, …)` from `src/editor/media-picker.ts` instead of `appendMediaUploader`/`appendImageGenerator`. Cropper helpers stay where they are and the picker calls them.
- `src/index.ts` — mount new routers: `app.route('/api', assets)` and `app.route('/api', slotHistory)`. Keep existing mounts.
- `package.json` — add `"asset:smoke": "bun run src/owner-asset-smoke.ts"`.

### Deleted (Phase 7 only)

- `src/assets/site-assets.ts` — fully replaced by `src/assets/owner-assets.ts`.
- `siteAsset` Drizzle table and the `site_asset` SQL table.

---

## Phase 1 — Schema additions and migration (no behavior change yet)

### Task 1: Add `ownerAsset` and `slotHistory` Drizzle table definitions

**Files:**

- Modify: `src/db/schema.ts` — append two tables after line 112.

- [ ] **Step 1: Add the table definitions**

Append the following after the `siteAsset` definitions in `src/db/schema.ts`:

```ts
export const ownerAsset = pgTable(
  'owner_asset',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    mediaType: text('media_type').notNull(),
    bytesBase64: text('bytes_base64').notNull(),
    kind: text('kind').notNull().$type<'image' | 'video'>(),
    alt: text('alt').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerAssetByCustomer: index('owner_asset_by_customer').on(t.customerId, t.lastUsedAt),
  }),
);

export type OwnerAsset = typeof ownerAsset.$inferSelect;
export type NewOwnerAsset = typeof ownerAsset.$inferInsert;

export const slotHistory = pgTable(
  'slot_history',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull(),
    assetId: text('asset_id')
      .notNull()
      .references(() => ownerAsset.id, { onDelete: 'cascade' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.siteId, t.elementId, t.assetId] }),
    bySlot: index('slot_history_by_slot').on(t.siteId, t.elementId, t.lastUsedAt),
  }),
);

export type SlotHistory = typeof slotHistory.$inferSelect;
export type NewSlotHistory = typeof slotHistory.$inferInsert;
```

Also extend the import line at the top to include `index, primaryKey`:

```ts
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: Typecheck**

Run: `bun.cmd run typecheck`
Expected: zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(schema): add owner_asset and slot_history tables"
```

### Task 2: Write the SQL migration

**Files:**

- Create: `drizzle/0001_owner_asset.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- 0001_owner_asset.sql
-- Add owner_asset and slot_history. Copy every site_asset row into owner_asset
-- with the same id, reparented to the site's owning customer. site_asset is
-- left in place; it is dropped in 0002 after the application code is fully
-- switched over.

CREATE TABLE owner_asset (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  media_type text NOT NULL,
  bytes_base64 text NOT NULL,
  kind text NOT NULL,
  alt text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX owner_asset_by_customer
  ON owner_asset (customer_id, last_used_at DESC);

INSERT INTO owner_asset (
  id, customer_id, media_type, bytes_base64, kind, alt, created_at, last_used_at
)
SELECT
  sa.id,
  s.customer_id,
  sa.media_type,
  sa.bytes_base64,
  sa.kind,
  sa.alt,
  sa.created_at,
  sa.created_at
FROM site_asset AS sa
JOIN site AS s ON s.id = sa.site_id;

CREATE TABLE slot_history (
  site_id text NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  element_id text NOT NULL,
  asset_id text NOT NULL REFERENCES owner_asset(id) ON DELETE CASCADE,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, element_id, asset_id)
);

CREATE INDEX slot_history_by_slot
  ON slot_history (site_id, element_id, last_used_at DESC);
```

- [ ] **Step 2: Apply against the dev DB**

Run: `bun.cmd x drizzle-kit push`
Expected: drizzle-kit confirms `owner_asset` and `slot_history` are created with no destructive prompts on existing tables.

If drizzle-kit suggests dropping `site_asset`, abort: answer "No". `site_asset` must survive until Phase 7. If push refuses to add only the two new tables, run the raw SQL via the Neon SQL editor or `psql $DATABASE_URL -f drizzle/0001_owner_asset.sql`.

- [ ] **Step 3: Verify row counts match**

Run:

```bash
psql $DATABASE_URL -c "SELECT (SELECT count(*) FROM site_asset) AS site_asset_rows, (SELECT count(*) FROM owner_asset) AS owner_asset_rows;"
```

Expected: both counts equal. If `owner_asset_rows` < `site_asset_rows`, the join on `site` lost rows because of a `customer_id` mismatch — investigate (orphaned `site_asset.site_id` values).

- [ ] **Step 4: Commit**

```bash
git add drizzle/0001_owner_asset.sql
git commit -m "feat(schema): migrate site_asset rows into owner_asset, add slot_history"
```

### Task 3: Add a Drizzle-level reader so existing code can be exercised against the new table

**Files:**

- Create: `src/assets/owner-assets.ts`

- [ ] **Step 1: Write the initial helper file**

```ts
// src/assets/owner-assets.ts
//
// Owner Asset helpers — the post-rerooting replacement for site-assets.ts.
// During Phases 1–6 this file co-exists with site-assets.ts. site-assets.ts
// stays as a re-export shim so unrelated code does not churn.

import { and, eq } from 'drizzle-orm';
import type { CanvasPage, MediaKind } from '../canvas/schema.js';
import { ownerAsset } from '../db/schema.js';
import type { DrizzleDb } from '../db/client.js';

export interface OwnerAssetBlob {
  kind: MediaKind;
  mediaType: string;
  bytesBase64: string;
  alt: string;
}

/**
 * Parse a base64 data URL into an OwnerAssetBlob. Fails loudly on any
 * unsupported media type or malformed data URL.
 */
export function dataUrlToOwnerAsset(input: string, alt: string): OwnerAssetBlob {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(input);
  if (!match) throw new Error('asset data must be a base64 data URL');
  const mediaType = match[1] ?? '';
  const bytesBase64 = match[2] ?? '';
  if (mediaType.startsWith('image/')) return { kind: 'image', mediaType, bytesBase64, alt };
  if (mediaType.startsWith('video/')) return { kind: 'video', mediaType, bytesBase64, alt };
  throw new Error(`unsupported asset media type: ${mediaType}`);
}

/** Read a single Owner Asset by id and customer. Returns null if not found. */
export async function readOwnerAsset(
  database: DrizzleDb,
  customerId: string,
  assetId: string,
): Promise<{ mediaType: string; bytesBase64: string; kind: MediaKind } | null> {
  const rows = await database
    .select({
      mediaType: ownerAsset.mediaType,
      bytesBase64: ownerAsset.bytesBase64,
      kind: ownerAsset.kind,
    })
    .from(ownerAsset)
    .where(and(eq(ownerAsset.id, assetId), eq(ownerAsset.customerId, customerId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Build a binary Response for asset bytes. Caches aggressively. */
export function assetResponse(mediaType: string, bytesBase64: string): Response {
  const bytes = Uint8Array.from(atob(bytesBase64), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': mediaType,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

// Re-export the reference walkers from site-assets so callers can switch
// imports in one place when Phase 7 lands. The walkers themselves operate on
// CanvasPage shapes and have nothing site-specific in them.
export {
  collectReferencedAssets,
  collectReferencedAssetIds,
  findAssetReferenceErrors,
} from './site-assets.js';
export type { ReferencedAsset, AssetReferenceError, AssetKindRow } from './site-assets.js';
```

If `src/db/client.ts` doesn't export a `DrizzleDb` type, take the inferred type from the existing `db(c.env)` call site (see any existing route) and inline it. If it does export one, import it as above.

- [ ] **Step 2: Typecheck**

Run: `bun.cmd run typecheck`
Expected: zero errors. If `DrizzleDb` is missing, add `export type DrizzleDb = ReturnType<typeof db>;` to `src/db/client.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/assets/owner-assets.ts src/db/client.ts
git commit -m "feat(assets): add owner-assets helpers alongside site-assets"
```

---

## Phase 2 — Backend re-route to Owner Asset

### Task 4: Create the owner-scoped asset router (upload + peek only)

**Files:**

- Create: `src/routes/api/assets.ts`
- Modify: `src/index.ts` — mount the new router.

- [ ] **Step 1: Write the upload + peek router**

```ts
// src/routes/api/assets.ts
import { Hono } from 'hono';
import type { PublicEnv } from '../public.js';
import { requireOwnerContext } from '../../auth/context.js'; // see Task 4 note below
import { db } from '../../db/client.js';
import { ownerAsset } from '../../db/schema.js';
import { assetResponse, dataUrlToOwnerAsset, readOwnerAsset } from '../../assets/owner-assets.js';

const MAX_ASSET_DATA_URL_BYTES = 1_500_000;

export const assets = new Hono<PublicEnv>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface UploadInput {
  dataUrl: string;
  alt: string;
}

function parseUploadInput(body: unknown): UploadInput | { error: string } {
  if (!isRecord(body)) return { error: 'request body must be a JSON object' };
  const { dataUrl, alt } = body;
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
    return { error: 'dataUrl is required (non-empty base64 data URL)' };
  }
  if (typeof alt !== 'string') return { error: 'alt is required (string; "" is acceptable)' };
  return { dataUrl, alt };
}

assets.post('/me/assets', async (c) => {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx.response;

  const body: unknown = await c.req.json();
  const parsed = parseUploadInput(body);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  if (parsed.dataUrl.length > MAX_ASSET_DATA_URL_BYTES) {
    return c.json({ error: 'asset too large' }, 413);
  }
  let blob;
  try {
    blob = dataUrlToOwnerAsset(parsed.dataUrl, parsed.alt);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  const id = `up-${crypto.randomUUID()}`;
  const database = db(c.env);
  await database.insert(ownerAsset).values({
    id,
    customerId: ctx.customer.id,
    mediaType: blob.mediaType,
    bytesBase64: blob.bytesBase64,
    kind: blob.kind,
    alt: blob.alt,
  });
  return c.json({ assetId: id, kind: blob.kind, mediaType: blob.mediaType });
});

assets.get('/me/assets/:assetId', async (c) => {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx.response;
  const row = await readOwnerAsset(db(c.env), ctx.customer.id, c.req.param('assetId'));
  if (!row) return c.json({ error: 'asset not found' }, 404);
  return assetResponse(row.mediaType, row.bytesBase64);
});
```

**Auth context note.** The existing codebase uses `clerkAuth` middleware (`src/auth/middleware.ts`) and a site-scoped helper named `loadOwnedSite` (search `src/` to find its exact home — it returns `{ found, site } | { found: false }`). This plan introduces a new `src/auth/context.ts` that wraps the same Clerk gate and exposes two helpers reused by every new route:

```ts
// src/auth/context.ts (new)
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { clerkAuth } from './middleware.js';
import { requireAuth } from './require-auth.js';
import { db } from '../db/client.js';
import { customer, site } from '../db/schema.js';
import type { PublicEnv } from '../routes/public.js';

export type OwnerOk = { ok: true; customer: { id: string } };
export type OwnerFail = { ok: false; response: Response };

export async function requireOwnerContext(c: Context<PublicEnv>): Promise<OwnerOk | OwnerFail> {
  // SMOKE bypass — only honoured when env.SMOKE === '1', set by the smoke runner.
  if (c.env.SMOKE === '1') {
    const id = c.req.header('x-smoke-customer-id');
    if (id) return { ok: true, customer: { id } };
  }
  const auth = await requireAuth(c); // existing helper; returns Response on failure
  if (auth instanceof Response) return { ok: false, response: auth };
  const rows = await db(c.env)
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, response: c.json({ error: 'no customer record' }, 403) };
  return { ok: true, customer: row };
}

export async function requireOwnedSite(c: Context<PublicEnv>, siteId: string) {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx;
  const rows = await db(c.env)
    .select({ id: site.id, customerId: site.customerId })
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1);
  const s = rows[0];
  if (!s || s.customerId !== ctx.customer.id) {
    return { ok: false as const, response: c.json({ error: 'site not found' }, 404) };
  }
  return { ok: true as const, customer: ctx.customer, site: s };
}
```

Adjust signatures if `requireAuth` returns a different shape — read it first. The point of this module is to centralise the auth shape so the new routes do not each reimplement Clerk-to-customer translation.

- [ ] **Step 2: Mount the router**

In `src/index.ts`, find the existing `app.route('/api', …)` mounts and add:

```ts
import { assets } from './routes/api/assets.js';
// …
app.route('/api', assets);
```

- [ ] **Step 3: Typecheck**

Run: `bun.cmd run typecheck`
Expected: zero errors.

- [ ] **Step 4: Smoke-test the upload + peek**

Open `src/owner-asset-smoke.ts` and add the following scenario (the file is created in full in Task 10; for now just write a tiny throwaway script `scratch/smoke-upload.ts` and run it once to confirm):

```ts
// scratch/smoke-upload.ts — discard after this step
import app from '../src/index';
const env = { DATABASE_URL: process.env.DATABASE_URL ?? '' };
const dataUrl = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=`;
const res = await app.request(
  'http://rev01.test/api/me/assets',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: process.env.SMOKE_CLERK_COOKIE ?? '' },
    body: JSON.stringify({ dataUrl, alt: 'smoke' }),
  },
  env,
);
console.log(res.status, await res.json());
```

Run: `bun.cmd run scratch/smoke-upload.ts`
Expected: `201` (or `200`) with `{ assetId: 'up-…', kind: 'image', mediaType: 'image/png' }`.

If auth fails because no smoke cookie exists, defer this manual probe to Task 10 (the proper smoke script seeds a customer directly via Drizzle, bypassing Clerk). Delete `scratch/smoke-upload.ts` either way.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/assets.ts src/index.ts src/auth/context.ts
git commit -m "feat(api): owner-scoped POST /me/assets and GET /me/assets/:assetId"
```

### Task 5: Switch site creation to seed `owner_asset` rows

**Files:**

- Modify: `src/routes/api/sites.ts`
- Modify: `src/canvas/seed-assets.ts` (only if `prepareSeedAssetsForSite` lives there; otherwise it stays in `sites.ts`).

- [ ] **Step 1: Replace `prepareSeedAssetsForSite` with `prepareSeedOwnerAssetsForSite`**

Find the existing `prepareSeedAssetsForSite` (exported from `sites.ts`). Rename to `prepareSeedOwnerAssetsForSite` and change its return shape from `seedRows: NewSiteAsset[]` to `seedRows: NewOwnerAsset[]`. Replace `siteId` with `customerId` in every row it produces.

```ts
// inside src/routes/api/sites.ts

import { ownerAsset, type NewOwnerAsset } from '../../db/schema.js';

export function prepareSeedOwnerAssetsForSite(
  customerId: string,
  state: EditableSite,
):
  | { ok: true; editableState: EditableSite; seedRows: NewOwnerAsset[] }
  | { ok: false; unknownSeedIds: string[]; assetKindErrors: AssetReferenceError[] } {
  // existing body, but every row uses { id, customerId, mediaType, bytesBase64, kind, alt }
  // — drop the per-site asset id remap if it existed.
}
```

If the existing function remaps seed ids per-site (so two sites do not collide on the same `seed-hero-poster-1` id), it must keep doing so — but the remap target is now scoped to `customer_id`. Two sites under the _same_ customer can share a seed asset id because the row already exists; check whether the row exists for this customer first and skip the insert if so.

- [ ] **Step 2: Update the call site**

In `src/routes/api/sites.ts`, around line 235:

```ts
const preparedSeedAssets = prepareSeedOwnerAssetsForSite(customerId, seed.state);
// …
if (seedRows.length === 0) {
  await siteInsert;
} else {
  const assetInsert = database.insert(ownerAsset).values(seedRows).onConflictDoNothing(); // same customer + same seed id is fine
  await database.batch([siteInsert, assetInsert]);
}
```

- [ ] **Step 3: Typecheck**

Run: `bun.cmd run typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/sites.ts src/canvas/seed-assets.ts
git commit -m "feat(sites): seed owner_asset rows on site creation instead of site_asset"
```

### Task 6: Switch the visitor `/assets/:assetId` route to `owner_asset`

**Files:**

- Modify: `src/routes/public.ts:267-295`

- [ ] **Step 1: Replace the read**

```ts
if (path.startsWith('/assets/')) {
  const assetId = path.slice('/assets/'.length);
  if (assetId.length === 0 || assetId.includes('/')) {
    return c.text('asset not found', 404);
  }
  const referenced = collectReferencedAssetIds(siteRow.publishedSnapshot.pages);
  if (!referenced.has(assetId)) {
    return c.text('asset not found', 404);
  }
  const database = db(c.env);
  const rows = await database
    .select({ mediaType: ownerAsset.mediaType, bytesBase64: ownerAsset.bytesBase64 })
    .from(ownerAsset)
    .where(eq(ownerAsset.id, assetId))
    .limit(1);
  const row = rows[0];
  if (!row) return c.text('asset not found', 404);
  return assetResponse(row.mediaType, row.bytesBase64);
}
```

Import `ownerAsset` from `../db/schema.js` and update the `assetResponse` import to `../assets/owner-assets.js`. Note: the route no longer scopes by `siteId` — the published-snapshot reference set is the only authorisation. This is intentional: an Owner Asset is owner-rooted and may be referenced by multiple sites' snapshots.

- [ ] **Step 2: Typecheck and run the existing review smoke**

Run: `bun.cmd run typecheck`
Run: `bun.cmd run review:smoke`
Expected: smoke green. If `review-smoke.ts` inserts into `siteAsset` and then expects to read via `/assets/:assetId`, fix the smoke to insert into `owner_asset` instead.

- [ ] **Step 3: Commit**

```bash
git add src/routes/public.ts src/review-smoke.ts
git commit -m "feat(public): visitor /assets/:assetId reads owner_asset via snapshot refs"
```

### Task 7: Switch the publish guard

**Files:**

- Modify: `src/routes/api/publish.ts`

- [ ] **Step 1: Replace the asset lookup**

Find the publish handler's reference check (it currently selects `siteAsset.id, siteAsset.kind` for ids in the editable state). Replace with `ownerAsset` joined to the site's `customerId`:

```ts
const ids = Array.from(collectReferencedAssetIds(editableState.pages));
const knownAssets =
  ids.length === 0
    ? []
    : await database
        .select({ id: ownerAsset.id, kind: ownerAsset.kind })
        .from(ownerAsset)
        .where(and(eq(ownerAsset.customerId, siteRow.customerId), inArray(ownerAsset.id, ids)));
```

The rest of the reference-error machinery (`findAssetReferenceErrors`) consumes `AssetKindRow[]` and does not change.

- [ ] **Step 2: Typecheck and re-run review smoke**

Run: `bun.cmd run typecheck`
Run: `bun.cmd run review:smoke`
Expected: green. If the publish step of the smoke fails with "missing assets," it means the smoke setup is still inserting into `siteAsset` instead of `owner_asset` — fix the setup, not the guard.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/publish.ts
git commit -m "feat(publish): guard references against owner_asset for the site's customer"
```

### Task 8: Retire the old upload, generate, and peek routes on `canvas.ts`

**Files:**

- Modify: `src/routes/api/canvas.ts` — delete the three handlers at lines 164–415.

- [ ] **Step 1: Delete the handlers**

Remove the three routes from `src/routes/api/canvas.ts`:

```
POST /sites/:siteId/assets
POST /sites/:siteId/assets/generate
GET  /sites/:siteId/assets/:assetId
```

Also remove imports that become unused (`siteAsset`, `dataUrlToAsset`, `MAX_ASSET_DATA_URL_BYTES` if it was defined locally, `parseUploadInput` if it only served those routes). Leave non-asset routes alone.

- [ ] **Step 2: Update editor client call sites**

In `src/editor/canvas-client.ts`, `postAssetUpload` (~line 1525) calls `POST /api/canvas/sites/:siteId/assets`. Replace with a call to `POST /api/me/assets`. The response shape is identical: `{ assetId, kind, mediaType }`. Similarly any direct `/api/canvas/sites/:siteId/assets/:assetId` reads on the owner side (peek) become `/api/me/assets/:assetId`.

The generator call (`appendImageGenerator`) is rewritten in Phase 3; leave it for now even though its current target is now 404 — Phase 3 ships in the next commit.

- [ ] **Step 3: Typecheck**

Run: `bun.cmd run typecheck`
Expected: zero errors. Any remaining references to `siteAsset` outside `db/schema.ts`, `assets/site-assets.ts`, and `review-smoke.ts` indicate a missed call site.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/canvas.ts src/editor/canvas-client.ts
git commit -m "refactor(api): remove per-site asset routes; clients hit /me/assets"
```

---

## Phase 3 — AI generate returns bytes only

### Task 9: Rewrite generate to return bytes without persisting

**Files:**

- Modify: `src/routes/api/assets.ts` — add the generate handler here (the previous home is gone).
- Modify: `src/editor/canvas-client.ts` — `appendImageGenerator` now applies via `POST /me/assets`.

- [ ] **Step 1: Add the generate handler**

Append to `src/routes/api/assets.ts`:

```ts
import {
  generateImageViaReplicate,
  snapToFluxAspectRatio,
  MAX_ASSET_DATA_URL_BYTES,
} from '../../assets/owner-assets.js';

interface GenerateInput {
  prompt: string;
  alt: string;
  boxW: number;
  boxH: number;
}

function parseGenerateInput(body: unknown): GenerateInput | { error: string } {
  if (!isRecord(body)) return { error: 'request body must be a JSON object' };
  const { prompt, alt, boxW, boxH } = body;
  if (typeof prompt !== 'string' || prompt.trim().length === 0)
    return { error: 'prompt is required (non-empty string)' };
  if (typeof alt !== 'string') return { error: 'alt is required (string; "" is acceptable)' };
  if (typeof boxW !== 'number' || !Number.isFinite(boxW) || boxW <= 0)
    return { error: 'boxW is required (positive finite number)' };
  if (typeof boxH !== 'number' || !Number.isFinite(boxH) || boxH <= 0)
    return { error: 'boxH is required (positive finite number)' };
  return { prompt, alt, boxW, boxH };
}

assets.post('/me/assets/generate', async (c) => {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx.response;
  const body: unknown = await c.req.json();
  const parsed = parseGenerateInput(body);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  const token = c.env.REPLICATE_API_TOKEN;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('REPLICATE_API_TOKEN binding is missing');
  }

  const aspectRatio = snapToFluxAspectRatio(parsed.boxW, parsed.boxH);
  const image = await generateImageViaReplicate(token, parsed.prompt, aspectRatio);

  const dataUrlLength = `data:${image.mediaType};base64,`.length + image.bytesBase64.length;
  if (dataUrlLength > MAX_ASSET_DATA_URL_BYTES) {
    return c.json({ error: 'generated asset too large' }, 413);
  }

  // KEY DIFFERENCE FROM THE OLD ROUTE: no insert. Bytes return to the client.
  return c.json({
    kind: 'image' as const,
    mediaType: image.mediaType,
    bytesBase64: image.bytesBase64,
    alt: parsed.alt,
  });
});
```

Move `generateImageViaReplicate`, `snapToFluxAspectRatio`, `FLUX_ASPECT_PRESETS`, and `MAX_ASSET_DATA_URL_BYTES` from `canvas.ts` into `src/assets/owner-assets.ts` and export them. They were private to `canvas.ts`; they are now shared infra.

- [ ] **Step 2: Update `appendImageGenerator` in the editor**

In `src/editor/canvas-client.ts`, find `appendImageGenerator` (~line 1711). The new flow:

1. POST `/api/me/assets/generate` with `{ prompt, alt, boxW, boxH }`.
2. Receive `{ kind, mediaType, bytesBase64, alt }`.
3. Render a preview `<img>` from `data:${mediaType};base64,${bytesBase64}` and an "Apply" button (and a "Discard" button if convenient).
4. On Apply: POST `/api/me/assets` with `{ dataUrl: 'data:${mediaType};base64,${bytesBase64}', alt }`. Receive `{ assetId }`. Then update the media element via the existing apply path (`element.assetId = assetId; rebuildElement(id); scheduleSave();`).
5. On Discard: throw the bytes away (close the preview UI).

Pseudo-skeleton:

```ts
async function generatePreview(prompt: string, alt: string, boxW: number, boxH: number) {
  const res = await fetch('/api/me/assets/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, alt, boxW, boxH }),
  });
  if (!res.ok) throw new Error(`generate failed: ${res.status}`);
  return (await res.json()) as {
    kind: 'image';
    mediaType: string;
    bytesBase64: string;
    alt: string;
  };
}

async function applyPreviewToElement(
  elementId: string,
  preview: { mediaType: string; bytesBase64: string; alt: string },
) {
  const dataUrl = `data:${preview.mediaType};base64,${preview.bytesBase64}`;
  const up = await fetch('/api/me/assets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dataUrl, alt: preview.alt }),
  });
  if (!up.ok) throw new Error(`upload failed: ${up.status}`);
  const { assetId } = (await up.json()) as { assetId: string };
  applyAssetIdToElement(elementId, assetId);
}
```

`applyAssetIdToElement` is defined fully in Task 13 — for now it can be a local helper that mutates `element.assetId`, calls `rebuildElement(id)`, calls `scheduleSave()`, and PUTs the slot-history MRU entry (added in Task 12).

- [ ] **Step 3: Typecheck**

Run: `bun.cmd run typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/assets.ts src/assets/owner-assets.ts src/routes/api/canvas.ts src/editor/canvas-client.ts
git commit -m "feat(api): /me/assets/generate returns bytes; client applies via /me/assets"
```

### Task 9b: Switch agent media-producing flow off `site_asset`

**Files:**

- Modify: `src/routes/api/canvas-agent.ts`
- Modify: `src/agent/canvas-tools.ts` (if it persists bytes directly; today it only references existing asset ids per the investigator scan, so changes here are limited to imports)

- [ ] **Step 1: Switch reference walkers**

In `src/routes/api/canvas-agent.ts`, change the import line:

```ts
import { collectReferencedAssetIds, findAssetReferenceErrors } from '../../assets/owner-assets.js';
```

The functions themselves are pure walkers over `CanvasPage[]` and do not change shape.

- [ ] **Step 2: Switch agent asset-ownership probe**

Find any `inArray(siteAsset.id, ids)` or `eq(siteAsset.siteId, …)` query in `canvas-agent.ts`. Replace with the owner-scoped equivalent:

```ts
const knownAssets =
  ids.length === 0
    ? []
    : await database
        .select({ id: ownerAsset.id, kind: ownerAsset.kind })
        .from(ownerAsset)
        .where(and(eq(ownerAsset.customerId, ctx.customer.id), inArray(ownerAsset.id, ids)));
```

Use the `requireOwnedSite` helper from `src/auth/context.ts` (Task 4) to get `ctx.customer.id`.

- [ ] **Step 3: Confirm no media-producing agent op persists bytes during preview**

Read `src/agent/canvas-ops.ts` and `src/agent/canvas-tools.ts`. If a tool exists that takes raw image bytes and persists them as a side effect of the **preview** route, change it: the preview route returns the bytes inside the op payload; the **apply** route is the only place an Owner Asset is created from those bytes (call the same helper that `POST /me/assets` uses — extract it into `owner-assets.ts` as `insertOwnerAssetFromBlob(database, customerId, blob)`).

If no such tool exists today (the existing `replaceMedia` only references existing asset ids), this step is a no-op — note that in the commit message.

- [ ] **Step 4: Typecheck and re-run review smoke**

Run: `bun.cmd run typecheck`
Run: `bun.cmd run review:smoke`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/canvas-agent.ts src/agent/canvas-ops.ts src/agent/canvas-tools.ts src/assets/owner-assets.ts
git commit -m "feat(agent): canvas-agent reference checks and asset creation use owner_asset"
```

### Task 10: Add the owner-asset smoke script

**Files:**

- Create: `src/owner-asset-smoke.ts`
- Modify: `package.json` — add `asset:smoke` script.

- [ ] **Step 1: Write the smoke**

The smoke should:

1. Pick or insert a customer row directly via Drizzle.
2. POST `/api/me/assets` with a tiny PNG; assert `200` and a row appears in `owner_asset` with matching `customer_id`.
3. POST `/api/me/assets/generate` against a stub Replicate token if available; if not, skip (mark `[skip]`) and continue.
4. GET `/api/me/assets/{id}` and assert bytes match.

Pattern follows `src/review-smoke.ts`: build an `env` object, call `app.request(...)`, assert via the small `assert` helper. Stamp every step with a printed line so a green run is obvious.

Bypass Clerk by stubbing the customer-lookup via a header the smoke sets and `requireOwnerContext` honours when `process.env.SMOKE === '1'`. Add the gate explicitly so production paths cannot be tricked.

```ts
// src/auth/context.ts — augment
if (c.env.SMOKE === '1') {
  const id = c.req.header('x-smoke-customer-id');
  if (id) return { ok: true, customer: { id } };
}
```

- [ ] **Step 2: Add the npm script**

In `package.json`:

```json
"asset:smoke": "bun run src/owner-asset-smoke.ts"
```

- [ ] **Step 3: Run the smoke**

Run: `bun.cmd run asset:smoke`
Expected: every step prints `ok`. If a step fails, the assert prints the failure and exits non-zero.

- [ ] **Step 4: Commit**

```bash
git add src/owner-asset-smoke.ts src/auth/context.ts package.json
git commit -m "test(smoke): owner_asset upload + generate + read smoke"
```

---

## Phase 4 — Slot History

### Task 11: Slot-history router

**Files:**

- Create: `src/routes/api/slot-history.ts`
- Modify: `src/index.ts` — mount.

- [ ] **Step 1: Write the router**

```ts
// src/routes/api/slot-history.ts
import { Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PublicEnv } from '../public.js';
import { requireOwnedSite } from '../../auth/context.js';
import { db } from '../../db/client.js';
import { ownerAsset, slotHistory } from '../../db/schema.js';

export const slotHistoryRouter = new Hono<PublicEnv>();

// List the last N (default 4) owner assets ever applied to this slot, newest first.
slotHistoryRouter.get('/sites/:siteId/elements/:elementId/history', async (c) => {
  const ctx = await requireOwnedSite(c, c.req.param('siteId'));
  if (!ctx.ok) return ctx.response;

  const limit = Math.max(1, Math.min(20, Number(c.req.query('limit') ?? '4')));
  const rows = await db(c.env)
    .select({
      assetId: slotHistory.assetId,
      lastUsedAt: slotHistory.lastUsedAt,
      kind: ownerAsset.kind,
      mediaType: ownerAsset.mediaType,
      alt: ownerAsset.alt,
    })
    .from(slotHistory)
    .innerJoin(ownerAsset, eq(ownerAsset.id, slotHistory.assetId))
    .where(
      and(eq(slotHistory.siteId, ctx.site.id), eq(slotHistory.elementId, c.req.param('elementId'))),
    )
    .orderBy(desc(slotHistory.lastUsedAt))
    .limit(limit);
  return c.json({ entries: rows });
});

// MRU upsert: writing (siteId, elementId, assetId) either inserts a new row
// or refreshes last_used_at on the existing one. Same call also bumps
// owner_asset.last_used_at — gallery sort is "most recently used anywhere".
slotHistoryRouter.put('/sites/:siteId/elements/:elementId/history/:assetId', async (c) => {
  const ctx = await requireOwnedSite(c, c.req.param('siteId'));
  if (!ctx.ok) return ctx.response;
  const assetId = c.req.param('assetId');
  const elementId = c.req.param('elementId');

  // Fail loudly if the asset is not owned by this customer.
  const owns = await db(c.env)
    .select({ id: ownerAsset.id })
    .from(ownerAsset)
    .where(and(eq(ownerAsset.id, assetId), eq(ownerAsset.customerId, ctx.customer.id)))
    .limit(1);
  if (owns.length === 0) return c.json({ error: 'asset not owned' }, 403);

  const now = new Date();
  await db(c.env).transaction(async (tx) => {
    await tx
      .insert(slotHistory)
      .values({ siteId: ctx.site.id, elementId, assetId, lastUsedAt: now })
      .onConflictDoUpdate({
        target: [slotHistory.siteId, slotHistory.elementId, slotHistory.assetId],
        set: { lastUsedAt: now },
      });
    await tx.update(ownerAsset).set({ lastUsedAt: now }).where(eq(ownerAsset.id, assetId));
  });
  return c.json({ ok: true });
});

// Cleanup hook: when a media element is deleted from the editable state, the
// editor calls this to purge that element's history.
slotHistoryRouter.delete('/sites/:siteId/elements/:elementId/history', async (c) => {
  const ctx = await requireOwnedSite(c, c.req.param('siteId'));
  if (!ctx.ok) return ctx.response;
  await db(c.env)
    .delete(slotHistory)
    .where(
      and(eq(slotHistory.siteId, ctx.site.id), eq(slotHistory.elementId, c.req.param('elementId'))),
    );
  return c.json({ ok: true });
});
```

`requireOwnedSite` is the existing site-scoped variant of `requireOwnerContext` (today implemented as `loadOwnedSite` in the canvas route helpers). Expose it from `src/auth/context.ts` and reuse.

- [ ] **Step 2: Mount the router**

```ts
import { slotHistoryRouter } from './routes/api/slot-history.js';
app.route('/api', slotHistoryRouter);
```

- [ ] **Step 3: Typecheck**

Run: `bun.cmd run typecheck`
Expected: zero errors.

- [ ] **Step 4: Smoke**

Extend `src/owner-asset-smoke.ts`:

1. Insert a site for the smoke customer.
2. PUT `/api/sites/:siteId/elements/test-element/history/:assetId` — assert 200.
3. GET `/api/sites/:siteId/elements/test-element/history` — assert one entry with the right asset id.
4. PUT the same again — assert the row count is still 1 (MRU dedup) and `last_used_at` advanced.
5. DELETE the history — assert empty.

Run: `bun.cmd run asset:smoke`
Expected: every step `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/slot-history.ts src/index.ts src/auth/context.ts src/owner-asset-smoke.ts
git commit -m "feat(api): slot_history list, MRU upsert, and per-element purge"
```

### Task 12: Element-deletion cleanup hook

**Files:**

- Modify: `src/editor/canvas-client.ts` — wherever a media element is removed (search for the delete-element handler), call the slot-history DELETE endpoint.

- [ ] **Step 1: Find the deletion path**

Search:

```bash
grep -n "delete" src/editor/canvas-client.ts | head -40
```

Identify the function that removes an element from the editable state. There should be one canonical "delete element" path used by both the inspector delete button and keyboard delete.

- [ ] **Step 2: Add the cleanup call**

When the element being deleted has `type === 'media'`:

```ts
if (element.type === 'media') {
  // Fire-and-forget cleanup. If it fails, the worst that happens is the
  // history row becomes orphaned in DB — but it's keyed by element id which
  // is now unreachable, so it has no user-visible effect. We still log the
  // failure for debugging per the no-silent-failure rule.
  fetch(`/api/sites/${siteId}/elements/${element.id}/history`, { method: 'DELETE' })
    .then((r) => {
      if (!r.ok) console.error('slot-history cleanup failed', r.status);
    })
    .catch((err) => console.error('slot-history cleanup failed', err));
}
```

- [ ] **Step 3: Commit**

```bash
git add src/editor/canvas-client.ts
git commit -m "feat(editor): purge slot_history when its media element is deleted"
```

---

## Phase 5 — Gallery, asset usage, and delete cascade

### Task 13: List gallery and probe asset usage

**Files:**

- Modify: `src/routes/api/assets.ts` — add GET `/me/assets` and GET `/me/assets/:assetId/usage`.
- Modify: `src/assets/owner-assets.ts` — add `findAssetUsage` and `findAffectedPublishedSites`.

- [ ] **Step 1: Add the gallery list**

```ts
assets.get('/me/assets', async (c) => {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx.response;
  const kindFilter = c.req.query('kind'); // 'image' | 'video' | undefined
  const limit = Math.max(1, Math.min(500, Number(c.req.query('limit') ?? '200')));

  const whereClause =
    kindFilter === 'image' || kindFilter === 'video'
      ? and(eq(ownerAsset.customerId, ctx.customer.id), eq(ownerAsset.kind, kindFilter))
      : eq(ownerAsset.customerId, ctx.customer.id);

  const entries = await db(c.env)
    .select({
      assetId: ownerAsset.id,
      kind: ownerAsset.kind,
      mediaType: ownerAsset.mediaType,
      alt: ownerAsset.alt,
      lastUsedAt: ownerAsset.lastUsedAt,
      createdAt: ownerAsset.createdAt,
    })
    .from(ownerAsset)
    .where(whereClause)
    .orderBy(desc(ownerAsset.lastUsedAt))
    .limit(limit);
  return c.json({ entries });
});
```

- [ ] **Step 2: Add the usage probe**

In `src/assets/owner-assets.ts`:

```ts
import { site } from '../db/schema.js';

export interface AssetUsageElement {
  siteId: string;
  siteName: string;
  publishedAddress: string | null; // visitor-facing host if site is published, else null
  elementId: string;
  source: 'editable' | 'published';
}

/**
 * Find every editable state and every published snapshot owned by this
 * customer that references the asset id. Used by the delete-confirm modal.
 */
export async function findAssetUsage(
  database: DrizzleDb,
  customerId: string,
  assetId: string,
): Promise<AssetUsageElement[]> {
  const sites = await database
    .select({
      id: site.id,
      name: site.name,
      subdomain: site.subdomain,
      editableState: site.editableState,
      publishedSnapshot: site.publishedSnapshot,
      publishedVersion: site.publishedVersion,
    })
    .from(site)
    .where(eq(site.customerId, customerId));

  const out: AssetUsageElement[] = [];
  for (const s of sites) {
    for (const ref of collectReferencedAssets(s.editableState.pages)) {
      if (ref.assetId !== assetId) continue;
      out.push({
        siteId: s.id,
        siteName: s.name,
        publishedAddress: s.publishedVersion > 0 ? s.subdomain : null,
        elementId: ref.mediaElementId,
        source: 'editable',
      });
    }
    if (s.publishedSnapshot) {
      for (const ref of collectReferencedAssets(s.publishedSnapshot.pages)) {
        if (ref.assetId !== assetId) continue;
        out.push({
          siteId: s.id,
          siteName: s.name,
          publishedAddress: s.subdomain,
          elementId: ref.mediaElementId,
          source: 'published',
        });
      }
    }
  }
  return out;
}
```

Then in the router:

```ts
assets.get('/me/assets/:assetId/usage', async (c) => {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx.response;
  const usage = await findAssetUsage(db(c.env), ctx.customer.id, c.req.param('assetId'));
  return c.json({ usage });
});
```

- [ ] **Step 3: Smoke + commit**

Extend `owner-asset-smoke.ts` to cover both routes. Run `bun.cmd run asset:smoke`. Commit:

```bash
git add src/routes/api/assets.ts src/assets/owner-assets.ts src/owner-asset-smoke.ts
git commit -m "feat(api): GET /me/assets gallery and /me/assets/:assetId/usage probe"
```

### Task 14: Delete with cascade

**Files:**

- Modify: `src/routes/api/assets.ts` — add DELETE `/me/assets/:assetId`.

- [ ] **Step 1: Add the handler**

```ts
assets.delete('/me/assets/:assetId', async (c) => {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx.response;
  const assetId = c.req.param('assetId');

  // Verify the asset belongs to this customer before doing anything.
  const owned = await db(c.env)
    .select({ id: ownerAsset.id })
    .from(ownerAsset)
    .where(and(eq(ownerAsset.id, assetId), eq(ownerAsset.customerId, ctx.customer.id)))
    .limit(1);
  if (owned.length === 0) return c.json({ error: 'asset not found' }, 404);

  // Cascade-confirm is a *client* responsibility. The server requires the
  // client to acknowledge it has shown the user the impact list. We pass a
  // signed-ish marker as a query param: "?confirm=cascade". Anything else is
  // 400. This is a deliberate handshake, not a real signature — the UI is
  // trusted to have rendered the modal; the server's job is only to reject
  // accidental DELETEs.
  if (c.req.query('confirm') !== 'cascade') {
    return c.json({ error: 'cascade confirmation required' }, 400);
  }

  await db(c.env).transaction(async (tx) => {
    // For each affected editable state, null out the element's assetId so the
    // editor shows an empty slot, not a dangling reference. The published
    // snapshot is left intact — visitors will get 404 from /assets/:assetId
    // because the row will be gone, which is the loud failure mode the ADR
    // names. Owner must re-publish to clear the broken slot for visitors.
    const usage = await findAssetUsage(tx, ctx.customer.id, assetId);
    const editableTouchedSites = new Set(
      usage.filter((u) => u.source === 'editable').map((u) => u.siteId),
    );
    for (const siteId of editableTouchedSites) {
      const siteRow = await tx
        .select({ id: site.id, editableState: site.editableState })
        .from(site)
        .where(eq(site.id, siteId))
        .limit(1);
      const row = siteRow[0];
      if (!row) continue;
      const cleared = clearAssetReferences(row.editableState, assetId);
      await tx.update(site).set({ editableState: cleared }).where(eq(site.id, siteId));
    }
    // slot_history rows cascade via FK ON DELETE CASCADE on asset_id.
    await tx.delete(ownerAsset).where(eq(ownerAsset.id, assetId));
  });
  return c.json({ ok: true });
});
```

Add a helper next to `findAssetUsage`:

```ts
export function clearAssetReferences(state: EditableSite, assetId: string): EditableSite {
  // Walk pages → sections → elements. For every media element where
  // assetId or posterAssetId equals the doomed id, replace with an empty
  // string. Return a new state — do not mutate.
  return {
    ...state,
    pages: state.pages.map((page) => ({
      ...page,
      sections: page.sections.map((section) => ({
        ...section,
        elements: section.elements.map((element) => {
          if (element.type !== 'media') return element;
          const cleared = { ...element };
          if (element.assetId === assetId) cleared.assetId = '';
          if (element.posterAssetId === assetId) cleared.posterAssetId = '';
          return cleared;
        }),
      })),
    })),
  };
}
```

- [ ] **Step 2: Smoke + commit**

Extend `owner-asset-smoke.ts` with a delete scenario:

1. Create asset, attach to an element in a site's editable state.
2. Probe usage — expect 1 entry.
3. DELETE without `confirm=cascade` — expect 400.
4. DELETE with `?confirm=cascade` — expect 200; row gone; editable state's element `assetId` now `""`.

```bash
git add src/routes/api/assets.ts src/assets/owner-assets.ts src/owner-asset-smoke.ts
git commit -m "feat(api): DELETE /me/assets/:assetId with cascade-confirm handshake"
```

---

## Phase 6 — Editor picker UI

### Task 15: Picker module skeleton

**Files:**

- Create: `src/editor/media-picker.ts`

- [ ] **Step 1: Define the contract**

```ts
// src/editor/media-picker.ts
//
// Inline media picker for the inspector. Renders three rows:
//   1. Current image (with Replace, Crop, Generate, Upload affordances)
//   2. Slot History — last 4 owner assets ever applied to this element
//   3. Gallery — every owner asset for this customer, filtered to the slot's kind
//
// Picking a thumbnail (history or gallery) instantly updates the canvas via
// rebuildElement + scheduleSave, and PUTs an MRU entry into slot_history.

import type { MediaElement, MediaKind } from '../canvas/schema.js';

export interface PickerContext {
  siteId: string;
  element: MediaElement;
  /** Replace the element's assetId in the local editable state. */
  setAssetId: (next: string) => void;
  /** Force the canvas to re-render this element from the latest state. */
  rebuildElement: () => void;
  /** Queue the editable state for save. */
  scheduleSave: () => void;
}

export function mountMediaPicker(host: HTMLElement, ctx: PickerContext): () => void {
  host.replaceChildren();
  const root = document.createElement('div');
  root.className = 'media-picker';
  host.appendChild(root);

  const currentRow = renderCurrent(root, ctx);
  const historyRow = renderHistoryRow(root, ctx);
  const galleryRow = renderGalleryRow(root, ctx);

  void refreshAll(ctx, currentRow, historyRow, galleryRow);

  // Returned disposer is called by the inspector when the selected element
  // changes — picker unmounts itself cleanly so listeners do not leak.
  return () => host.replaceChildren();
}
```

`renderCurrent`, `renderHistoryRow`, `renderGalleryRow`, and `refreshAll` are implemented in Tasks 16–18.

- [ ] **Step 2: Wire it into the inspector**

In `src/editor/canvas-client.ts`, around line 1201–1214 (the media-element branch of `appendInspector`), replace the existing `appendMediaUploader(host, …)` + `appendImageGenerator(host, …)` calls with:

```ts
import { mountMediaPicker } from './media-picker.js';
// …
if (element.type === 'media') {
  const disposer = mountMediaPicker(host, {
    siteId,
    element,
    setAssetId(next) {
      element.assetId = next;
    },
    rebuildElement() {
      rebuildElement(element.id);
    },
    scheduleSave,
  });
  inspectorTeardowns.push(disposer); // existing teardown registry, or add one if missing
}
```

- [ ] **Step 3: Commit**

```bash
git add src/editor/media-picker.ts src/editor/canvas-client.ts
git commit -m "feat(editor): scaffold media-picker module mounted by inspector"
```

### Task 16: Current row (with replace/upload/generate buttons)

**Files:**

- Modify: `src/editor/media-picker.ts`

- [ ] **Step 1: Implement `renderCurrent`**

```ts
function renderCurrent(root: HTMLElement, ctx: PickerContext) {
  const row = document.createElement('div');
  row.className = 'picker-current';

  const thumb = document.createElement('img');
  thumb.className = 'picker-thumb-current';
  refreshCurrentThumb(thumb, ctx.element.assetId);

  const altInput = document.createElement('input');
  altInput.type = 'text';
  altInput.placeholder = 'alt text';
  altInput.value = ctx.element.alt ?? '';
  altInput.addEventListener('input', () => {
    ctx.element.alt = altInput.value;
    ctx.scheduleSave();
  });

  const uploadBtn = document.createElement('button');
  uploadBtn.textContent = 'Upload';
  uploadBtn.addEventListener('click', () => openUploadDialog(ctx, thumb));

  const generateBtn = document.createElement('button');
  generateBtn.textContent = 'AI generate';
  generateBtn.addEventListener('click', () => openGenerateDialog(ctx, thumb));

  row.append(thumb, altInput, uploadBtn, generateBtn);
  root.appendChild(row);
  return { thumb, altInput };
}

function refreshCurrentThumb(thumb: HTMLImageElement, assetId: string) {
  if (!assetId) {
    thumb.removeAttribute('src');
    thumb.classList.add('empty');
    return;
  }
  thumb.classList.remove('empty');
  thumb.src = `/api/me/assets/${assetId}`;
}
```

`openUploadDialog` reuses the existing cropper modal path from `canvas-client.ts` but ends in a POST to `/api/me/assets` instead of `/api/canvas/sites/:siteId/assets`. Factor the cropper modal calls into helpers (`runCropperModal`, `loadCropper`) exported from `canvas-client.ts` so `media-picker.ts` can call them without duplicating code.

`openGenerateDialog` re-uses the preview/apply path from Task 9.

- [ ] **Step 2: Commit**

```bash
git add src/editor/media-picker.ts src/editor/canvas-client.ts
git commit -m "feat(editor): media-picker current row with upload + generate"
```

### Task 17: History row

**Files:**

- Modify: `src/editor/media-picker.ts`

- [ ] **Step 1: Implement `renderHistoryRow`**

```ts
function renderHistoryRow(root: HTMLElement, ctx: PickerContext) {
  const row = document.createElement('div');
  row.className = 'picker-history-row';
  const label = document.createElement('span');
  label.textContent = 'Recent in this slot';
  label.className = 'picker-row-label';
  const thumbs = document.createElement('div');
  thumbs.className = 'picker-thumbs';
  row.append(label, thumbs);
  root.appendChild(row);
  return { thumbs };
}

async function loadHistory(ctx: PickerContext): Promise<HistoryEntry[]> {
  const res = await fetch(`/api/sites/${ctx.siteId}/elements/${ctx.element.id}/history?limit=4`);
  if (!res.ok) throw new Error(`history fetch failed: ${res.status}`);
  const body = (await res.json()) as { entries: HistoryEntry[] };
  return body.entries;
}

interface HistoryEntry {
  assetId: string;
  kind: MediaKind;
  mediaType: string;
  alt: string;
  lastUsedAt: string;
}

function paintThumbs(
  container: HTMLElement,
  entries: HistoryEntry[],
  ctx: PickerContext,
  currentThumb: HTMLImageElement,
): void {
  container.replaceChildren();
  for (const entry of entries) {
    const img = document.createElement('img');
    img.className = 'picker-thumb';
    img.src = `/api/me/assets/${entry.assetId}`;
    img.alt = entry.alt;
    if (entry.assetId === ctx.element.assetId) img.classList.add('selected');
    img.addEventListener('click', () => {
      applyAssetIdToElement(entry.assetId, ctx, currentThumb);
      void paintAllSelectedState(container, currentThumb, ctx);
    });
    container.appendChild(img);
  }
}
```

The shared apply function — used by current/history/gallery and AI Apply — is:

```ts
async function applyAssetIdToElement(
  assetId: string,
  ctx: PickerContext,
  currentThumb: HTMLImageElement,
): Promise<void> {
  ctx.setAssetId(assetId);
  ctx.rebuildElement();
  refreshCurrentThumb(currentThumb, assetId);
  ctx.scheduleSave();
  // MRU upsert — fire-and-forget, but log failures.
  fetch(`/api/sites/${ctx.siteId}/elements/${ctx.element.id}/history/${assetId}`, { method: 'PUT' })
    .then((r) => {
      if (!r.ok) console.error('slot-history upsert failed', r.status);
    })
    .catch((err) => console.error('slot-history upsert failed', err));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/editor/media-picker.ts
git commit -m "feat(editor): media-picker history row with MRU apply"
```

### Task 18: Gallery row with delete-cascade confirm

**Files:**

- Modify: `src/editor/media-picker.ts`

- [ ] **Step 1: Implement `renderGalleryRow`**

```ts
function renderGalleryRow(root: HTMLElement, ctx: PickerContext) {
  const row = document.createElement('div');
  row.className = 'picker-gallery';
  const label = document.createElement('span');
  label.textContent = 'Your gallery';
  label.className = 'picker-row-label';
  const grid = document.createElement('div');
  grid.className = 'picker-gallery-grid';
  row.append(label, grid);
  root.appendChild(row);
  return { grid };
}

async function loadGallery(kind: MediaKind): Promise<GalleryEntry[]> {
  const res = await fetch(`/api/me/assets?kind=${encodeURIComponent(kind)}`);
  if (!res.ok) throw new Error(`gallery fetch failed: ${res.status}`);
  const body = (await res.json()) as { entries: GalleryEntry[] };
  return body.entries;
}

interface GalleryEntry {
  assetId: string;
  kind: MediaKind;
  mediaType: string;
  alt: string;
  lastUsedAt: string;
}

function paintGallery(
  grid: HTMLElement,
  entries: GalleryEntry[],
  ctx: PickerContext,
  currentThumb: HTMLImageElement,
): void {
  grid.replaceChildren();
  for (const entry of entries) {
    const cell = document.createElement('div');
    cell.className = 'picker-gallery-cell';

    const img = document.createElement('img');
    img.className = 'picker-thumb';
    img.src = `/api/me/assets/${entry.assetId}`;
    img.alt = entry.alt;
    if (entry.assetId === ctx.element.assetId) img.classList.add('selected');
    img.addEventListener('click', () => {
      void applyAssetIdToElement(entry.assetId, ctx, currentThumb);
    });

    const del = document.createElement('button');
    del.className = 'picker-delete';
    del.textContent = '×';
    del.title = 'Delete from gallery';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      void runDeleteCascadeConfirm(entry.assetId, ctx, currentThumb);
    });

    cell.append(img, del);
    grid.appendChild(cell);
  }
}

async function runDeleteCascadeConfirm(
  assetId: string,
  ctx: PickerContext,
  currentThumb: HTMLImageElement,
): Promise<void> {
  const probe = await fetch(`/api/me/assets/${assetId}/usage`);
  if (!probe.ok) {
    alert(`Could not check usage: ${probe.status}`);
    return;
  }
  const { usage } = (await probe.json()) as { usage: AssetUsageElement[] };

  const editableCount = usage.filter((u) => u.source === 'editable').length;
  const publishedAddresses = new Set(
    usage
      .filter((u) => u.source === 'published' && u.publishedAddress)
      .map((u) => u.publishedAddress as string),
  );

  const lines = [
    `Delete this image?`,
    ``,
    `Used in ${editableCount} element${editableCount === 1 ? '' : 's'} across your editable sites.`,
    publishedAddresses.size > 0
      ? `Live published sites that will show a missing image until you re-publish:`
      : `No live published sites are affected.`,
    ...Array.from(publishedAddresses).map((a) => `  • ${a}`),
    ``,
    `This cannot be undone.`,
  ];
  const ok = confirm(lines.join('\n'));
  if (!ok) return;

  const res = await fetch(`/api/me/assets/${assetId}?confirm=cascade`, { method: 'DELETE' });
  if (!res.ok) {
    alert(`Delete failed: ${res.status}`);
    return;
  }
  // If the deleted asset was the slot's current, our local state now points at
  // an empty string — server cleared it too. Refresh the current thumb.
  if (ctx.element.assetId === assetId) {
    ctx.setAssetId('');
    ctx.rebuildElement();
    refreshCurrentThumb(currentThumb, '');
  }
}
```

Use a real modal in place of `confirm()` if the rest of the editor already has a modal helper; the inline `confirm()` is acceptable for the first pass because (a) it is loud and blocking which is exactly what the no-fallback rule asks for, and (b) the modal helper does not exist yet in this repo. Note in the file's comment header that swapping to a styled modal is a separate task.

- [ ] **Step 2: Commit**

```bash
git add src/editor/media-picker.ts
git commit -m "feat(editor): gallery row with cascade-confirm delete"
```

### Task 19: Glue — `refreshAll` and selection highlight sync

**Files:**

- Modify: `src/editor/media-picker.ts`

- [ ] **Step 1: Implement `refreshAll`**

```ts
async function refreshAll(
  ctx: PickerContext,
  currentRow: { thumb: HTMLImageElement; altInput: HTMLInputElement },
  historyRow: { thumbs: HTMLElement },
  galleryRow: { grid: HTMLElement },
): Promise<void> {
  const [history, gallery] = await Promise.all([
    loadHistory(ctx),
    loadGallery(ctx.element.mediaKind),
  ]);
  paintThumbs(historyRow.thumbs, history, ctx, currentRow.thumb);
  paintGallery(galleryRow.grid, gallery, ctx, currentRow.thumb);
}
```

After any successful apply, refresh both rows so MRU ordering is reflected immediately:

```ts
async function applyAssetIdToElement(/* … */) {
  // …after the PUT…
  await refreshAll(ctx, currentRow, historyRow, galleryRow);
}
```

Pass `currentRow`, `historyRow`, `galleryRow` into `applyAssetIdToElement` via closure (rebind in `mountMediaPicker`).

- [ ] **Step 2: Style pass**

Add minimal CSS for `.media-picker`, `.picker-thumb`, `.picker-thumb.selected`, `.picker-thumb.empty`, `.picker-history-row`, `.picker-gallery-grid`, `.picker-gallery-cell`, `.picker-delete`. Inline style block in `canvas-client.ts` already injects editor CSS — append the new rules there.

- [ ] **Step 3: Manual sanity check in dev**

Run: `bun.cmd run dev`

1. Open the editor.
2. Select a media element on the canvas.
3. Confirm three rows render: current image, history (may be empty), gallery (seed image plus any uploads).
4. Click a gallery thumbnail — canvas updates immediately, thumbnail highlights, history row gains the previous image.
5. Repeat with a video element — gallery filters to videos.
6. Click "×" on a gallery entry — confirm modal lists the right counts and addresses.

- [ ] **Step 4: Commit**

```bash
git add src/editor/media-picker.ts src/editor/canvas-client.ts
git commit -m "feat(editor): picker refreshes selection highlight and MRU on apply"
```

---

## Phase 7 — Drop `site_asset`

### Task 20: Migrate remaining call sites and delete `site_asset`

**Files:**

- Modify: `src/assets/site-assets.ts` → delete after every import has moved to `owner-assets.ts`.
- Modify: `src/db/schema.ts` — remove `siteAsset` definition.
- Create: `drizzle/0002_drop_site_asset.sql`

- [ ] **Step 1: Confirm no live code reads `siteAsset`**

Run:

```bash
grep -rn "siteAsset\b\|site_asset\b" src/ --include="*.ts"
```

Expected: only references inside `src/db/schema.ts` (definition) and `src/review-smoke.ts` (legacy comments). If any route or helper still reads it, that is a bug from earlier phases — fix it before continuing.

- [ ] **Step 2: Move every import**

`grep -n "from .*site-assets" src/` and replace `'../assets/site-assets'` → `'../assets/owner-assets'`. Delete `src/assets/site-assets.ts`.

- [ ] **Step 3: Drop the Drizzle table**

Remove the `siteAsset`, `SiteAsset`, `NewSiteAsset` exports from `src/db/schema.ts`.

- [ ] **Step 4: Write and apply the SQL drop**

```sql
-- 0002_drop_site_asset.sql
DROP TABLE site_asset;
```

Run: `psql $DATABASE_URL -f drizzle/0002_drop_site_asset.sql`
Expected: clean drop.

- [ ] **Step 5: Run all smokes**

Run: `bun.cmd run typecheck`
Run: `bun.cmd run canvas:smoke`
Run: `bun.cmd run review:smoke`
Run: `bun.cmd run asset:smoke`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0002_drop_site_asset.sql src/db/schema.ts src/assets/site-assets.ts src/
git commit -m "refactor(schema): drop site_asset; owner_asset is the only asset root"
```

### Task 21: Update RECON.md and the architecture doc

**Files:**

- Modify: `RECON.md`
- Modify: `docs/architecture/0001-architecture.md`

- [ ] **Step 1: Edit the docs**

Find every mention of "site asset", "siteAsset", or "Site Asset" in those two files and update to "Owner Asset" with appropriate wording. Cross-reference ADR 0004.

- [ ] **Step 2: Commit**

```bash
git add RECON.md docs/architecture/0001-architecture.md
git commit -m "docs: replace Site Asset references with Owner Asset (ADR 0004)"
```

---

## Verification matrix

After all 21 tasks, confirm each of these by running the listed command and observing the listed result.

| What                      | How                                                                  | Expected                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Type safety               | `bun.cmd run typecheck`                                              | zero errors                                                                                                                 |
| Render fixture            | `bun.cmd run canvas:smoke`                                           | green                                                                                                                       |
| End-to-end fictional run  | `bun.cmd run review:smoke`                                           | green                                                                                                                       |
| Asset lifecycle           | `bun.cmd run asset:smoke`                                            | green                                                                                                                       |
| Editor visual             | `bun.cmd run dev`, open editor, swap an image                        | canvas updates immediately, history row populates, gallery shows all owner assets                                           |
| Delete cascade            | In the editor, click "×" on a gallery image used in a published site | modal names the affected published address, owner confirms, delete proceeds, slot in editor goes empty                      |
| AI generate is transient  | In the editor, generate but discard                                  | no new row in `owner_asset` (check via `psql -c "select count(*) from owner_asset where customer_id = …"` before and after) |
| Visitor route still works | Visit a published address that has images                            | images load                                                                                                                 |

---

## Out of scope (do NOT do these in this plan)

- Object storage for asset bytes. Bytes remain inline in Postgres for the POC. The columns are large but the size cap (1.5 MB per data URL) holds row sizes within Neon's comfort zone.
- A styled modal component to replace `window.confirm()` for the delete cascade. The plan uses `confirm()` deliberately because it is loud and blocking and the styled-modal infrastructure does not exist yet.
- Pagination, search, or folder organisation on the gallery. The `limit=200` cap is enough for the POC.
- Server-side image resize variants or `srcset`. The renderer keeps emitting `<img src="/assets/:assetId">`.
- Owner Asset sharing across customers, or a marketplace. The customer is the asset root and stays that way.
- A versioned history beyond MRU. Cycling A → B → A still results in one row per (slot, asset) with the latest timestamp.
- Multiplayer collision handling on concurrent edits to the same slot. The MRU upsert is idempotent on `(siteId, elementId, assetId)`, but two editors racing to apply different assets to the same slot will end with the last-writer-wins — this matches every other editor mutation in the codebase today and is not the place to introduce conflict resolution.
