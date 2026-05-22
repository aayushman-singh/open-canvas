# Custom font upload

**Wishlist #:** 12  **Tier:** A  **Wave:** 5  **Status:** queued
**Depends on:** Phase 0 ✓ (asset pipeline #2), #10 custom theme editor (Wave 2)
**Blocks:** none

## User-visible outcome

An Owner uploads a WOFF2 font file in the Theme panel, gives it a name, and assigns it as the display or body font for their site. The font preview updates on the canvas; Visitors see the same font on the Published Site with no FOUT (flash of unstyled text) — system fallback shows until the WOFF2 finishes.

## Scope in

- WOFF2 upload route reusing asset pipeline (#2): store original in R2 with content-hash key.
- Font metadata row: name, family, weight, style, foundryAttribution.
- Style Kit token override: `customStyleKit.fontFamilyDisplay` and `.fontFamilyBody` can reference `"font:<contentHash>"` instead of a CSS family name.
- Public renderer emits `@font-face { font-family: <name>; src: url(/assets/<contentHash>.woff2) format('woff2'); font-display: swap; }`.
- CSP `font-src 'self'` (Phase 0 sets baseline; this confirms).
- Editor Theme panel gains "Upload font" affordance with file picker.
- Validation: only WOFF2, max 1MB, valid font signature byte check.

## Scope out

- Font subsetting (ship whole file as uploaded).
- Variable-font axis exposure.
- Google Fonts auto-load (separate follow-up).
- Multi-language subsets.

## Schema delta

Phase 0 if `siteFont` table exists; otherwise add here:

```ts
// src/db/schema.ts
siteFont = pgTable('site_font', {
  id, siteId,
  name: text('name').notNull(),
  family: text('family').notNull(),
  weight: integer('weight').notNull().default(400),
  style: text('style').notNull().$type<'normal' | 'italic'>().default('normal'),
  contentHash: text('content_hash').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

## Files owned (write)

- `src/fonts/upload.ts` — validation + R2 store + DB insert.
- `src/fonts/validate.ts` — WOFF2 signature byte check.
- `src/fonts/face-emit.ts` — `@font-face` block generator for snapshot HTML.
- `src/fonts/route.ts` — `POST /api/sites/:id/fonts`, `GET .../fonts`, `DELETE .../fonts/:id`.
- `src/fonts/smoke.ts`.
- `src/themes/panel.tsx` — single additive section for "Custom fonts" (touched only if `src/themes/panel.tsx` exists; if #10 hasn't merged, skip and add via integration step).
- `package.json` — `fonts:smoke` stub.

## Files read-only (must not modify)

- `src/assets/*` (consume only).
- `src/canvas/schema.ts`, `src/db/schema.ts`.

## Contract with neighbors

- Font reference shape: `customStyleKit.fontFamilyDisplay = "font:<contentHash>"`.
- Renderer detects `font:<hash>` prefix → emits @font-face + uses `<name>` as `font-family`.
- Fallback chain appended automatically: `"<name>", system-ui, sans-serif`.

## Smoke test

- `bun run fonts:smoke`:
  - Upload fake WOFF2 (with valid signature bytes) → row + R2 object exist.
  - Bad signature rejected 400.
  - Render fixture with custom font → HTML contains @font-face + matching `font-family`.
  - Delete removes row + R2 object.

## Acceptance criteria

- Owner uploads a real WOFF2, assigns to display, Visitor sees the font.
- `font-display: swap` confirmed (no invisible-text period).
- All smokes green.

## Open questions

- Whether to honour Owner-provided foundry attribution string in a tiny footer credit on Published Site. Recommend yes (legal cleanliness), behind a per-font toggle.
