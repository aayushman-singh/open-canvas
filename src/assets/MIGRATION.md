# Asset pipeline migration — Phase 0 plan #2

This document describes the migration from the pre-ADR-0004 `site_asset`
table (base64-in-Postgres, site-rooted) to the `owner_asset` + `slot_history`
shape (R2-keyed bytes, Owner-rooted) per ADRs 0004 and 0006.

## Migration strategy: preserve UUID semantics

Of the two strategies surfaced by Phase 0 Agent 2:

- **(a) Preserve id semantics** — the `ownerAsset.id` column keeps existing
  UUID values from the old `siteAsset` rows.
- **(b) Reset ids to content hash** — cleaner long-term but destructive across
  every snapshot, published_snapshot, and editable_state JSON.

We picked **strategy (a)**.

### Why

The opaque-id round-trip in `src/canvas/yjs-projection.ts` means any change
to asset id format would force a coordinated rewrite of every Yjs snapshot
(`siteSnapshot.yjs_snapshot_bytes`) AND every JSON snapshot
(`site.published_snapshot`, `site.editable_state`). Strategy (a) leaves all
of those untouched: a snapshot captured before this migration round-trips
to the same UUIDs after the migration, and those UUIDs still resolve to
`ownerAsset` rows.

### Implications

1. The `ownerAsset.id` column is a UUID. The R2 object key is content-hash
   keyed (`assets/<sha256[:32]>.<ext>`) per ADR 0006. The mapping
   `ownerAsset.id (UUID) → ownerAsset.contentHash (sha256) → ownerAsset.r2Key`
   is the cross-walk every render path performs.

2. `MediaElement.assetId` in canvas JSON continues to be a UUID. The
   renderer (`src/canvas/render.ts`, frozen) emits `<img src="/assets/<UUID>">`;
   the public route's `/assets/:addr` handler resolves either a UUID or a
   64-hex contentHash via a single indexed query (`WHERE id = :addr OR
content_hash = :addr`).

3. The new `POST /api/owner/assets` upload route, the seed materialiser,
   and the section-import path all generate fresh UUIDs for the `id`
   column. Two Owners uploading identical bytes get different UUIDs but
   share an R2 object (deduplication by `contentHash`).

4. The dev database is reset as part of this migration: every existing
   `site_asset` row is dropped by `drizzle/0001_owner_asset_pipeline.sql`.
   No reparenting / backfill is run; the POC has not been provisioned to
   production. **A re-run of the migration against any deployment that
   actually has rows in `site_asset` would silently lose all asset bytes.**

## DB reset workflow (Windows + Bun + Git Bash)

```sh
# 1. apply the new migration (assumes DATABASE_URL points at the dev DB):
bun.cmd x drizzle-kit push

# 2. drop any orphaned site rows whose snapshot references no-longer-extant
#    asset ids (only matters for dev DBs created before this migration):
#    (intentionally not automated — run by hand per developer)

# 3. re-seed Owner Assets for the dev customer:
#    (the seed:assets script is added to package.json alongside this work)
bun.cmd run seed:assets
```

## Seed source storage

Per ADR 0006, R2 originals are the canonical home for asset bytes. Seed
assets ship as a base64 file under `src/assets/seed-source/` per the brief
("Move the inline-bytes-as-strings from seed-assets.ts into
src/assets/seed-source/<name>.<ext>.b64 files"). The path is
`transparent.png.b64`; both `seed-hero-poster-1` and `seed-feature-canvas-1`
in the registry decode the same 68-byte transparent PNG (they share an R2
key by virtue of the content hash being the same).

The seed registry's `contentHash` and `r2Key` fields are hand-baked from
that source file. If the source bytes change, the registry must be updated
in lockstep — the `seed:assets` smoke verifies the hashes match at upload
time, so a drift between source and registry is caught immediately.
