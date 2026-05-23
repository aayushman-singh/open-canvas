# ADR 0006 — Owner Asset storage backend: R2 originals + Cloudflare image transforms

**Status:** Accepted
**Date:** 2026-05-23
**Author:** Aayushman Singh
**Supersedes:** the "storage backend" deferral in ADR 0004

## Context

ADR 0004 re-rooted assets to the Owner and explicitly deferred the storage backend decision: "today they live inline in Neon as base64; an object-storage move is a separate decision." That deferral is now overdue. The base64-in-Postgres shape blocks every wishlist feature that needs real images at scale — generated OG cards, custom WOFF2 font files, the responsive published render that wants per-viewport image sizes, and the moment a Visitor first opens a real Published Site and waits a noticeable amount of time for a base64-jsonb-blob to round-trip the database.

The user-perceived outcome the storage backend must serve is: a Visitor loading a Published Site on any modern device sees images appear immediately, in the correct format (AVIF / WebP / JPEG fallback), at the dimensions the page actually needs — not the dimensions of the original upload — without the Owner ever having to think about formats, sizes, or CDNs.

Three backend shapes were considered:

1. **Cloudflare R2 + a custom Wasm image pipeline inside the Worker.** R2 stores original bytes; the Worker decodes, resizes, re-encodes per request via a Wasm image library (`photon`, `wasm-image-optimization`, etc.). Full control of the pipeline.
2. **Cloudflare Images, fully managed.** Upload to the Images API; the platform stores originals and serves variants. Zero custom pipeline code.
3. **Hybrid: Cloudflare R2 for originals + Cloudflare image transforms via the `cf.image` fetch subrequest option (also marketed as Cloudflare Image Transformations).** R2 holds bytes addressed by content hash; the Worker fetches them through a subrequest carrying transform parameters (`format`, `width`, `height`, `fit`, `quality`), and Cloudflare's edge handles decode, resize, and re-encode based on the Visitor's `Accept` header.

A custom Wasm pipeline (1) was attractive for the engineering signal but pays for that signal in Worker bundle size (multi-MB Wasm), Worker CPU and memory caps (AVIF encode at scale is hostile to the 30s CPU / 128MB limit), and a meaningful debugging surface (R2 + Wasm + Cache API is three systems to reason about per request). For a POC at this scale the signal is in the wrong place.

Cloudflare Images (2) removes custom code entirely but couples the project to a managed service whose pricing is per-image-fee and whose URL shape and variant model become a hard contract that is awkward to migrate away from.

The hybrid (3) keeps originals under our control — content-addressed dedup, owner-rooted in DB per ADR 0004, no vendor lock on the bytes themselves — while delegating format negotiation and on-the-fly resize to Cloudflare's edge.

## Decisions

1. **Owner Asset originals are stored in Cloudflare R2, content-addressed by SHA-256.**

   **Why:** content-addressed keys (`assets/<sha256[:32]>.<ext>`) make deduplication a property of the data layout rather than a feature requiring its own logic. An Owner re-uploading the same JPEG produces no new bytes and no new R2 object; the new `owner_asset` row simply points at the existing content hash. R2 retention is per-object and survives independent of any single `owner_asset` row, which composes correctly with ADR 0004's rule that an Owner Asset survives the deletion of any single editable site that references it. The decision to keep originals in our bucket — not in a third-party CDN — preserves the option to migrate transforms later without re-uploading anything.

2. **Image transforms are produced on the read path via Cloudflare's `cf.image` fetch subrequest option, not pre-baked into stored variants and not produced by code we run.**

   **Why:** the lived outcome is a Visitor seeing an image in the right format and size for their device. The decision factor is who interprets the `Accept` header and runs the codec: us, by shipping a Wasm pipeline; or Cloudflare's edge, by transforming the R2-served original behind a fetch subrequest. Cloudflare's edge does it at a fraction of our cost in both code and runtime budget, with AVIF and WebP support already production-grade. Pre-baking variants at upload time is rejected because the matrix of `(content-hash × width × height × fit × quality × format)` would either explode storage or under-cover the long tail of valid sizes; on-read transformation matches the actual page-by-page demand the Visitor expresses.

3. **Asset URLs are content-hashed and immutable.**

   **Why:** the public read route serves at `/assets/:contentHash` with `Cache-Control: public, max-age=31536000, immutable`. Because the hash is the address, any change to the bytes is a different address, and there is no cache-invalidation problem at the edge or in the Visitor's browser. The Owner-facing UX of "update an asset" is implemented as "create a new asset and re-point references"; mutating bytes under a stable URL is rejected because it would require a parallel invalidation system and would make the published-snapshot cacheability story incoherent.

4. **Video assets are stored in R2 and served as originals through the same route; `cf.image` does not transform video.**

   **Why:** the POC's video story is a Media Element with an uploaded MP4. The image pipeline does not extend cleanly to multi-bitrate video; the right tool is Cloudflare Stream, which is a separate adapter and a separate decision. For now video originals are served via R2 + Cache, with no transform. The asset row's `kind` discriminator (`'image' | 'video'`) routes the read path.

## Out of scope

This ADR does not decide:

- Video transcoding, multi-bitrate variants, HLS / DASH packaging, or any Cloudflare Stream integration.
- Per-Owner storage quotas or billing of R2 usage.
- An R2 garbage collection / orphan-sweeper job (POC tolerates orphan objects).
- Owner-facing controls over compression quality or hard size limits per upload.
- Migration strategy for any asset that may already exist outside the base64-in-Postgres shape (the POC has only base64 rows in dev databases).
- The shape of WOFF2 font assets relative to image assets — fonts are an Owner Asset of a different `kind` and follow the same R2 + content-hash rules, but font subsetting and `@font-face` emission are decided by their own plan.

## Consequences

**Positive:**

- Dedup is free: the same bytes uploaded twice cost one R2 object.
- The transform pipeline lives at Cloudflare's edge, not in our Worker; bundle size, CPU budget, and codec correctness become someone else's concern.
- Visitors on modern browsers receive AVIF or WebP automatically based on `Accept` headers, with format=auto handled by the `cf.image` subrequest.
- The published-snapshot caching story stays simple: every asset URL is immutable, so HTTP caches and CDN caches can be arbitrarily aggressive.
- Migrating away from `cf.image` later is contained: R2 originals stay where they are; only the read route changes.

**Negative:**

- A dependency on Cloudflare Image Transformations as a billable feature. The free tier covers POC scale; production scale will reach paid usage.
- The migration from base64-in-Postgres to R2 is a one-shot operation that must run before any agent that consumes the new shape lands. Existing dev rows are dropped or rewritten; production rows do not exist yet, but the rule is documented for future migrations.
- Direct R2 access for testing requires a Cloudflare R2 binding in `wrangler dev`, which adds a tiny amount of local setup over the previous pure-Postgres model.
- Video served through the same route does not benefit from on-the-fly transformations; range-request behaviour relies on R2's range support, which is sufficient for POC but limits future video features without a Stream migration.

## Follow-ups

- Plan: `docs/superpowers/plans/2026-05-23-02-asset-pipeline.md` — implementation specification, route shapes, smoke tests, and migration.
- A future ADR for Cloudflare Stream when the video story moves beyond originals.
- A future ADR if storage quota or asset-budget policies become real.
- Cross-reference from ADR 0004 once this ADR is merged.
