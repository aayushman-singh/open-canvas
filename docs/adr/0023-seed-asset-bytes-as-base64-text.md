# ADR 0023 — Seed asset bytes are stored as base64 text files in-repo

**Status:** Accepted
**Date:** 2026-05-29 (proposed); 2026-06-01 (accepted)
**Author:** Aayushman Singh
**Drives:** lifts the storage strategy from `src/assets/seed-source/SUBSYSTEM.md` into canon. Per the 2026-05-29 SUBSYSTEM audit, the rationale is a real "why" choice that should survive in canon.
**Accepted-context:** verified 2026-06-01 — `src/assets/seed-source/` ships only `.b64` text files and `src/assets/seed-script.ts:29-30` decodes them via `atob`. The originating `src/assets/seed-source/SUBSYSTEM.md` was deleted in an earlier pass; the rationale now lives only here.

## Context

When an Owner creates a site from a Template Seed, the resulting site needs to ship with real asset bytes — placeholder hero images, video posters, etc. — so the new site looks complete on first open. Those bytes are bundled in-repo at `src/assets/seed-source/` and uploaded to the Owner's R2 storage by the `bun run seed:assets` script when the dev environment is provisioned.

The shape of those bundled bytes is a choice. Two reasonable options exist:

- **Raw binary blobs** (`.png`, `.mp4`, etc.) committed directly to the repo, ignored by line-ending normalisation via `.gitattributes`.
- **Base64-encoded text files** (`.b64`) committed as plain text, decoded by the seed script at upload time.

Today the codebase uses base64. The decision has implications for repo size, diff reviewability, cross-platform safety, and the seed-script's runtime shape. It deserves to be canonical so a future contributor adding a new seed asset does not silently regress to raw blobs (or vice versa).

## Decisions

1. **Bundled seed asset bytes are stored as base64-encoded text files (one `.b64` per asset) under `src/assets/seed-source/`.** The `bun run seed:assets` script decodes each file, uploads the bytes to local R2, and inserts the matching `ownerAsset` rows.

   **Why:**
   - **Diff reviewability.** A base64 text file produces a meaningful `git diff` when the underlying bytes change — the diff is huge but a reviewer can see "this file changed" and confirm the SHA / `contentHash`. A raw binary blob produces "Binary files differ" and the reviewer has no way to verify what changed without an external tool.
   - **Cross-platform safety.** Base64 is plain text with a fixed alphabet; no line-ending normaliser touches it (no `core.autocrlf` surprises on Windows). Raw binaries need a `.gitattributes` entry per extension to pin them, and the entry is easy to forget when adding a new file type.
   - **Decode cost is paid once per seed deploy, never on the hot Worker path.** The Worker never sees `.b64` files; only the dev-machine seed script does. Decode is sub-millisecond per file.

   This would be wrong if a single seed file became large enough that the base64 inflation (~33% over raw) made the repo unwieldy — but the current set is small (kilobytes per file) and the threshold for flipping (~1 MB raw) is far away.

2. **The flip-criterion to raw binaries is a single asset exceeding ~1 MB raw.** Above that, the base64 file becomes hard to view (browsers/editors choke on multi-MB text), and the 33% overhead becomes a real cost. At that point, a `.gitattributes` entry pins the binary format per extension and the seed script reads raw bytes instead of decoding.

   **Why:** the threshold is the size at which the base64 advantages stop applying. Below it, base64 wins on simplicity and reviewability; above it, raw bytes win on storage and editor sanity. Choosing one rule (always base64, or always raw) loses on whichever side of the threshold the file lands. Naming the threshold makes the flip a deliberate, predictable event.

   The first file that crosses the threshold is the trigger to write the `.gitattributes` entry and migrate that one file (not all files — base64 files below the threshold stay base64). A second ADR ratifies the mixed state if it becomes a steady-state pattern.

## Out of scope

- The R2 upload mechanism (`scripts/seed-apogee-demo.ts`, `src/assets/seed-script.ts`) — implementation, not policy.
- The Owner-asset model itself — [ADR 0004](0004-owner-asset.md) owns that.
- The R2 storage backend — [ADR 0006](0006-asset-storage-backend.md) owns that.
- Production seed asset provisioning — handled out-of-band by the operator running the seed script against the prod R2 bucket; no canonical script flow today.
- Compression of seed bytes before base64 (gzip + base64) — would add complexity for marginal savings; not adopted.

## Consequences

**Positive:**
- A new seed asset is one file drop into `src/assets/seed-source/` plus a registry entry in `src/canvas/seed-assets.ts`. The shape is uniform across all current seed files.
- Diff review of seed changes is text-based; reviewers see meaningful diffs rather than "Binary files differ."
- No platform-specific Git config is required; the repo behaves the same on Windows, Mac, and Linux.

**Negative:**
- The 33% base64 overhead is paid for every seed file regardless of size. Below the 1 MB threshold this is small absolute cost; above it, the flip-criterion in decision 2 mitigates.
- Adding a new seed file requires explicit base64 encoding (e.g. `base64 -i hero.jpg > hero.jpg.b64`). Not onerous, but a step a contributor unfamiliar with the convention might skip and instead commit raw bytes — which the seed script would then fail on (loud failure, not silent — the script expects `.b64` extension).
- The 1 MB threshold is named here but not enforced anywhere. A future contributor could check in a 5 MB `.b64` file and the build would silently accept it. A linting smoke (or pre-commit hook) is the natural enforcement.

## Follow-ups

- Delete `src/assets/seed-source/SUBSYSTEM.md` (its content is now in this ADR).
- When the first seed file crosses the 1 MB raw threshold, write the `.gitattributes` entry, migrate that one file to raw bytes, and add an amendment-or-superseding ADR noting the mixed state.
- Consider a pre-commit (or smoke) check that fails when any `.b64` file under `src/assets/seed-source/` decodes to more than 1 MB raw — enforces decision 2 mechanically instead of relying on contributor discipline.
