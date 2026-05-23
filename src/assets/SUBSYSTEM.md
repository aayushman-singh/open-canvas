# `src/assets/` — Owner Asset pipeline

**Plan:** `docs/superpowers/plans/2026-05-23-02-asset-pipeline.md`
**ADRs:** [0004](../../docs/adr/0004-owner-asset.md) (Owner-rooted assets),
[0006](../../docs/adr/0006-asset-storage-backend.md) (R2 + cf.image transforms)
**Phase 0 owner:** main thread (Phase 0 Agent 3)

The asset pipeline owns the Owner-rooted media surface: upload, list, read,
delete. Bytes live in Cloudflare R2 keyed by content hash; the `ownerAsset`
DB row carries the UUID-shaped id that canvas state JSON references.

## Files

| File             | Role                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `r2-client.ts`   | Typed wrapper around the `ASSETS_BUCKET` binding. Surface is `put` (put-if-missing), `get`, `head`, `delete`. The wrapper accepts an `R2BucketLike` interface so the smoke can pass an in-memory mock.     |
| `hash.ts`        | `sha256Hex(bytes)` via `crypto.subtle.digest`, plus `contentHashToR2Key`.                                                                                                                                  |
| `image-probe.ts` | Magic-byte sniffer for PNG / JPEG / GIF / WebP dimensions. Returns `{ width: null, height: null }` for video and unrecognised payloads.                                                                    |
| `upload.ts`      | `uploadOwnerAsset(deps, input)` — the core upload logic. Dedupes per `(customerId, contentHash)`; inserts a fresh `ownerAsset` row; appends a `slot_history` row when `siteId` + `elementId` came in.      |
| `read.ts`        | `readOwnerAsset(deps, req)` — resolves a UUID or contentHash addr to a row, fetches R2 bytes, optionally routes through `cf.image` when transform params are present.                                      |
| `delete.ts`      | `deleteOwnerAsset(deps, input)` — confirm-cascade flow per ADR 0004 decision 3. Returns a reference report when `confirm` is false; performs the delete (and R2 delete when no siblings remain) when true. |
| `list.ts`        | `listOwnerAssets(db, customerId)` — gallery with MRU ordering via the `slot_history` join.                                                                                                                 |
| `route.ts`       | Hono router mounted at `/api/owner/assets`. Wraps the four primitives with Clerk auth + customer-row resolution.                                                                                           |
| `site-assets.ts` | Pure helpers used by the publish guard and the canvas-agent pipeline to walk `MediaElement` references in a Canvas state.                                                                                  |
| `smoke.ts`       | `assets:smoke` — exercises upload (insert + dedup), read (original + cf.image transform), delete (412 + cascade) against in-memory R2 + DB stubs.                                                          |
| `seed-source/`   | Raw bytes for the bundled seed assets, stored as base64-text files. Read by the `seed:assets` script that uploads them to local R2 and inserts the corresponding `ownerAsset` rows for the dev customer.   |
| `MIGRATION.md`   | The id-preservation migration strategy and dev-DB reset workflow.                                                                                                                                          |

## Public contract (frozen for downstream waves)

- `POST /api/owner/assets` — multipart upload. Returns
  `{ id, contentHash, r2Key, mediaType, kind, alt, width, height, byteSize,
inserted, r2Uploaded }`.
- `GET /api/owner/assets` — gallery listing, MRU ordered.
- `DELETE /api/owner/assets/:id?confirm=1` — confirm-cascade delete.
- `GET /assets/:addr` (public, served via `routes/public.ts`) — content-hash
  OR UUID lookup, optional `?w=&h=&fit=&q=` transforms via cf.image.

`ownerAsset.id` is a UUID. Canvas JSON references it via
`MediaElement.assetId`. Two Owners can hold distinct rows for the same
bytes — they share the R2 object but never share the DB row.
