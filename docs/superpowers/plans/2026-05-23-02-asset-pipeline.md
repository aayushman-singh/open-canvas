# Asset pipeline (R2 + cf.image)

**Wishlist #:** 2  **Tier:** S  **Phase:** 0 (main thread, sequential)
**Status:** queued for Phase 0

> This plan documents the asset-pipeline work that is **pulled forward into Phase 0** rather than dispatched to a wave-1 agent. Reason: it unblocks #6 OG image and #12 custom fonts, and it changes the `ownerAsset` shape that every existing seed-asset code path depends on. Doing it sequentially on `main` keeps every downstream agent's contract stable.

**Depends on:** none
**Blocks:** #6 OG image, #12 custom fonts, and any agent that uploads media

## User-visible outcome

An Owner uploads images and videos in the editor. Uploads complete in under a second for typical sizes. Visitors loading a Published Site see images served via Cloudflare's edge network in the right format and size for their device — AVIF or WebP on modern browsers, JPEG / PNG fallback elsewhere — at the dimensions the page actually needs, not the original size.

## Scope in

- R2 bucket `ASSETS_BUCKET` storing original bytes keyed by content hash (`assets/<sha256[:32]>.<ext>`).
- New `ownerAsset` schema: drop `bytesBase64`, add `contentHash`, `r2Key`, `width`, `height`, `byteSize`.
- Upload route: `POST /api/owner/assets` — Owner-rooted per ADR 0004; multipart parsed, SHA256 computed, R2 put-if-missing (dedup), DB row inserted referencing the hash.
- Public read route: `GET /assets/:contentHash` — fetches the R2 object via `fetch(r2Url, { cf: { image: { format: 'auto', ...transforms } } })` and streams response.
- Transform query params: `?w=<n>&h=<n>&fit=cover|contain&q=<1-100>`.
- Cache-Control: 1 year immutable (content-hash keyed).
- Migration script: existing base64 rows → upload to R2 → fill `contentHash`/`r2Key` → drop `bytesBase64` column.
- Seed assets (`src/canvas/seed-assets.ts`) migrated to live in R2 with deterministic content hashes; codebase references hashes instead of inline data.

## Scope out

- Video transcoding / multi-bitrate variants (R2 stores originals; visitor pipeline serves whatever was uploaded for video).
- Per-Owner asset quota enforcement.
- Trash / recycle bin for deleted assets.

## Schema delta

Per ADR 0004, assets re-root from `site` to `customer` (Owner). Table renamed `site_asset` → `owner_asset`. Migration includes the re-root and the storage move in one step (existing dev rows are dropped; no production rows exist).

```ts
// src/db/schema.ts
ownerAsset = pgTable('owner_asset', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  customerId: text('customer_id').notNull().references(() => customer.id, { onDelete: 'cascade' }),
  contentHash: text('content_hash').notNull(),
  r2Key: text('r2_key').notNull(),
  mediaType: text('media_type').notNull(),
  kind: text('kind').notNull().$type<'image' | 'video'>(),
  alt: text('alt').notNull().default(''),
  width: integer('width'),
  height: integer('height'),
  byteSize: integer('byte_size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
// drop legacy `site_asset` table; drop `bytes_base64` column path no longer exists.
```

`slot_history` (ADR 0004 follow-up) — if not already in schema, scaffolded here keyed by `(siteId, elementId)` referencing `ownerAsset.id`.

`wrangler.toml`:
```toml
[[r2_buckets]]
binding = "ASSETS_BUCKET"
bucket_name = "rev01-assets"
```

## Files owned (write — Phase 0, main thread)

- `src/assets/r2-client.ts` — typed R2 SDK wrapper (put-if-missing, get, head, delete).
- `src/assets/upload.ts` — upload handler (parse multipart, hash, R2 put, DB insert).
- `src/assets/read.ts` — read handler (R2 → `cf.image` fetch → response).
- `src/assets/hash.ts` — streaming SHA256 helper.
- `src/assets/migrate.ts` — one-shot migration script for existing base64 rows.
- `src/assets/seed-migrate.ts` — repopulate seed assets in R2 with deterministic hashes.
- `src/routes/api/assets.ts` — `POST /api/owner/assets`, `DELETE /api/owner/assets/:id` (Owner-rooted per ADR 0004).
- `src/routes/public.ts` — add `/assets/:contentHash` arm; transform query params.
- `src/index.ts` — mount asset routes (replaces base64-serving paths).
- `src/canvas/seed-assets.ts` — reference content hashes instead of base64.
- `src/db/schema.ts` — schema change above + drizzle migration generated.
- `package.json` — `assets:smoke` entry.
- `wrangler.toml` — R2 binding.

## Files frozen for agents after this Phase 0 work

- `src/db/schema.ts` `ownerAsset` shape.
- `src/assets/*` (consumed by agents, not modified).
- `/assets/:contentHash` URL contract.

## Contract with neighbors

- All other features that reference assets must consume via `contentHash` (no base64 in canvas state).
- `MediaElement.assetId` semantics unchanged — points at `ownerAsset.id`, which resolves to `contentHash`.
- `cf.image` transforms applied per-fetch, not stored. R2 holds originals only.

## Smoke test

- `bun run assets:smoke`:
  - Upload a small PNG → R2 object exists at expected key, DB row present with correct hash + dimensions.
  - Re-upload same bytes → no new R2 object (put-if-missing), new DB row references same hash.
  - GET `/assets/<hash>?w=200` → response has correct width via `cf.image`.
  - DELETE removes DB row; R2 object retained if other rows still reference (refcount or skip — document choice).

## Acceptance criteria

- Existing seed assets render through new pipeline with no visible change.
- Owner uploads → asset appears in editor + Published Site within seconds.
- Browser DevTools Network panel shows `image/avif` or `image/webp` Content-Type for modern browsers.
- `bun run assets:smoke`, `canvas:smoke`, `canvas-agent:smoke`, `review:smoke`, `typecheck`, `lint`, `build` all green.

## Open questions

- R2 object reference counting. Recommend: skip refcount for POC; orphan R2 objects acceptable. Add a sweeper script later.
- Whether to charge `cf.image` transformations on the free tier; verify with current Cloudflare pricing during implementation.
