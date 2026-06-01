# ADR 0049 — Rename R2 bucket `rev01-assets` to `opencanvas-assets`

**Status:** Proposed
**Date:** 2026-06-01 (proposed)
**Author:** Aayushman Singh
**Drives:** the 2026-06-01 rebrand sweep landed Tier B (CSS / window globals / data attrs), Tier C (visitor route paths `/__rev01/*` → `/__opencanvas/*`), and the docs rename (Tier A). Tier D — renaming the R2 bucket binding — was deferred because the rename requires out-of-band ops (bucket create + byte copy) that this code pass cannot execute. This ADR names the cutover so the binding flip is a one-line `wrangler.toml` edit on the day the bytes are in place.
**Drove:** to-be-filled-on-acceptance

## Context

Owner Asset bytes live in a Cloudflare R2 bucket bound into the Worker at `env.OWNER_ASSETS`. Today the binding points at `bucket_name = "rev01-assets"` ([`wrangler.toml:78`](../../wrangler.toml)) and the same literal is the only allowed `rev01-` exception in the production codebase ([`src/assets/seed-script.ts:75`](../../src/assets/seed-script.ts)).

The bucket name is not visible to Visitors. The asset URL the Owner sees and that the Worker serves is `https://opencanvas.aayushman.dev/assets/<hash>` — the bucket name only surfaces in:

- The wrangler binding (build-time only).
- The seed script that runs against the Owner's R2 account from the operator's terminal.
- The `host-literal-guard.smoke.ts` exemption list — currently exempts `src/assets/seed-script.ts` so the smoke does not flag the legacy literal.

Three reasons the bucket name *should* change anyway, none of them urgent:

1. **Cognitive consistency.** Every other surface in the deployed system now says `opencanvas` or `Open Canvas`. A grep of the running worker that turned up `rev01-assets` would be a wart for any future operator.
2. **Lock-in for the literal guard.** Tier B added `rev01-` to `FORBIDDEN_LITERALS`. The seed-script exemption is a planned hole — closing it requires either deleting `BUCKET = 'rev01-assets'` or renaming the bucket. The first option needs the second.
3. **No coupling to ADR 0017 / 0013 env-var indirection.** R2 binding names are not configurable per-environment; they are stamped into the deployed Worker bundle. There is no env-var path to migrate through. The change is a literal rename plus a data move.

The cost of *not* renaming: a permanent exemption in the literal guard, a permanent line of `rev01-` in production code, and a permanent footnote in this ADR. Tolerable.

The cost of renaming: one R2 bucket create + one byte copy + one `wrangler.toml` edit + one re-deploy. ~30 minutes of operator time. Asset bytes during the copy window are in-flight; Owner uploads during that window write to the *old* bucket and need to be re-copied (or the copy needs to be tail-followed).

## Decisions

1. **Rename the R2 bucket from `rev01-assets` to `opencanvas-assets` via copy-then-cutover, not in-place rename. The old bucket stays for 30 days as a rollback safety net, then deletes.**

   **Why:** R2 has no atomic rename. The only safe sequence is (a) create the new bucket, (b) copy bytes, (c) flip the binding, (d) re-deploy, (e) verify reads against the new bucket succeed, (f) eventually drop the old bucket. Keeping the old bucket for 30 days lets a botched cutover be reverted with a single `wrangler.toml` edit + re-deploy. After 30 days the cost of carrying duplicate bytes outweighs the rollback value — the bucket is deleted.

   This would be wrong if the asset volume were large enough that 30 days of duplicate R2 storage cost was material. The current Owner Asset corpus is small (the product is launching). Re-evaluate at the first cost review after 1,000+ Owners.

2. **The copy is performed with `rclone` against the R2 S3-compatible endpoint, not a Workers-side script.**

   **Why:** A Worker-script copy runs on Cloudflare's compute and per-call subrequest limits would force pagination across many invocations. `rclone sync` from the operator's machine using R2 access keys is one command, has built-in resumability, and produces a verifiable byte-count diff. Workers-side scripts are appropriate when the copy must run inside the trust boundary; this copy can safely run wherever the operator has R2 keys.

3. **Owner uploads during the cutover window go to the OLD bucket. After the cutover, the operator runs the copy a second time to catch any new bytes written between first-copy and binding-flip, then verifies counts match.**

   **Why:** Going read-only during the copy window blocks Owner work for the duration. Letting uploads continue and then running a delta-copy is cheap (rclone only copies new keys) and bounded — the second pass is over a small key set. The product accepts a small risk that an upload arrives between second-copy and binding-flip; that single asset will 404 until the operator runs a third delta. The realistic frequency: zero, given the product is pre-launch.

4. **Worker name (`name = "rev01"` at [`wrangler.toml:1`](../../wrangler.toml)) is NOT renamed.**

   **Why:** The Worker `name` field controls the workers.dev fallback URL (`rev01.<account>.workers.dev`) and the slug under which the Worker appears in the Cloudflare dashboard. Production traffic flows through the route `opencanvas.aayushman.dev` regardless of the Worker name. Renaming the Worker creates a *new* Worker (Cloudflare treats it as a separate resource); the old one must be deleted manually and the Durable Object class names migrate without help. Keeping `name = "rev01"` is a one-line legacy that nobody sees, with zero functional cost. The cognitive-consistency argument from decision 1 does not apply: the Worker name is operator-facing only and rarely surfaced.

   This would be wrong if the Cloudflare dashboard listing became confusing across many Workers (e.g., we add `opencanvas-staging`, `opencanvas-preview`) and the legacy `rev01` slug stood out. Revisit if and when a second Worker ships.

## Cutover commands (executable when Decision 1 is accepted)

Prerequisites: R2 API token with read on `rev01-assets` and read/write on `opencanvas-assets`. Stored as the operator's `rclone` remote `r2` (S3-compatible profile pointing at `<account-id>.r2.cloudflarestorage.com`).

```sh
# 1. Create the new bucket.
wrangler r2 bucket create opencanvas-assets

# 2. First copy. Run from the operator's machine.
rclone sync r2:rev01-assets r2:opencanvas-assets --progress --transfers 8 --checksum

# 3. Verify counts match.
rclone size r2:rev01-assets
rclone size r2:opencanvas-assets
# Sizes should be identical. Any delta is uploads-since-step-2.

# 4. Edit wrangler.toml: change bucket_name = "rev01-assets" → "opencanvas-assets".
#    Edit src/assets/seed-script.ts:75: change BUCKET = 'rev01-assets' → 'opencanvas-assets'.
#    Remove src/assets/seed-script.ts from EXEMPT_FILES in src/host-literal-guard.smoke.ts.

# 5. Re-deploy.
wrangler deploy

# 6. Smoke from the worker URL — upload an asset, list, fetch. Confirms the
#    binding points at the new bucket and reads/writes go through.

# 7. Delta copy to catch any uploads written between step 2 and step 5.
rclone sync r2:rev01-assets r2:opencanvas-assets --progress --transfers 8 --checksum

# 8. Mark ADR 0049 Accepted. Add a "Drove:" line linking the deploy commit.

# 9. After 30 days with no rollback: drop the old bucket.
#    (Inside the Cloudflare dashboard so the destructive action is intentional.)
```

## Out of scope

- **DNS, Clerk, or Resend changes.** Those were handled by ADR 0013 and ADR 0018; the apex move is already complete.
- **Asset URL format.** Visitor-facing asset URLs (`/assets/<hash>`) are unaffected by the bucket rename. The bucket name does not appear in the URL.
- **Migration of existing PublishedSnapshots.** Snapshots store `EditableSite` state (not pre-rendered HTML), so the asset references inside them are by hash — unchanged across the bucket rename. No snapshot data needs rewriting.

## Follow-ups

- After Accepted: remove `'src/assets/seed-script.ts'` from `EXEMPT_FILES` in [`src/host-literal-guard.smoke.ts`](../../src/host-literal-guard.smoke.ts) so the smoke locks the literal out for good.
- Re-evaluate Decision 4 (Worker name) if a second Worker ships and the dashboard listing becomes ambiguous.
