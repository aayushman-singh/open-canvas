# `src/assets/seed-source/` — bundled seed asset bytes

Original bytes for the Owner Assets that materialise when an Owner creates
a site from a Template Seed. Each file is a base64-encoded payload of the
real bytes (PNG / JPEG / WebP / MP4); the `seed:assets` script decodes,
uploads to local R2, and inserts the `ownerAsset` rows for the dev Owner.

Storage strategy: **base64 text files**, one per asset. Chosen over checking
in binary blobs because:

- The repo stays plain-text reviewable on `git diff`.
- The base64 encoding is a stable on-disk representation regardless of OS
  line-ending policy (no `core.autocrlf` surprises).
- The decode-on-script-run cost is paid once per seed deploy, never in the
  hot Worker path.

If a future seed contains bytes large enough that the `.b64` shape becomes
unwieldy (say, a >1MB hero video), the strategy should flip to actual
binary blobs and a `.gitattributes` entry pinning the encoding — but until
then, base64 wins on simplicity.

## Files

| File                  | Bytes                    | Used by                                       |
| --------------------- | ------------------------ | --------------------------------------------- |
| `transparent.png.b64` | 68 (1x1 transparent PNG) | `seed-hero-poster-1`, `seed-feature-canvas-1` |

When a new seed file is added:

1. Drop the `.b64` file here.
2. Add a registry entry in `src/canvas/seed-assets.ts` with the matching
   `contentHash`, `r2Key`, `mediaType`, `kind`, `width`, `height`,
   `byteSize`, and `sourcePath`.
3. Run `bun run seed:assets` to verify the script picks it up.
