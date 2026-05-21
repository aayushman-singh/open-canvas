# landing

## Definition

The first-impression surface of rev01. Renders a single server-side page that telegraphs the product story — multiplayer site builder with an agent at the cursor — in the locked Post-Aero design language. Owns its visual language end-to-end: tokens, type loading, motion, and the three-panel hero composition. Static at request time, no per-request state.

## Inputs

- **HTTP client** → an inbound `GET /` request asks for the landing document. No headers, query, or session input is read.

## Outputs

- **HTTP client** → the rendered HTML document (status bar, three-panel hero, tagline, feature grid, terminal stat line, footer), inlined CSS, and a single inlined live-counter script. Two outbound font requests to `fonts.googleapis.com` / `fonts.gstatic.com`.
- **Reviewer / preview script** → a checked-in `PREVIEW.html` produced by `bun run landing:preview` (or `bun run src/landing/build-preview.ts`), holding the same byte-for-byte rendering used at request time so the page can be inspected without booting Wrangler.
