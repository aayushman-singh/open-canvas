# ADR 0008 — Site import via external Playwright scraper with position baking

**Status:** Accepted
**Date:** 2026-05-24
**Author:** Aayushman Singh

## Context

Owners want to create an Editable Site by importing an existing website — paste a URL, get an editable site. The import must work for any public URL, not only sites produced by one builder. The imported site must preserve the source's layout structure accurately: spatial relationships between elements must be correct, though pixel-perfect reproduction is not required.

Three subproblems drive the architecture:

1. **Rendering the source page.** Arbitrary websites use JavaScript, lazy loading, and dynamic layout. The scraper must see the fully rendered page, not just raw HTML.
2. **Extracting positions.** The canvas document model uses absolute positioning (`box: { x, y, w, h }`). Source websites use flow layout (flexbox, grid, block). These must be reconciled.
3. **Running a headless browser.** Cloudflare Workers cannot run a browser natively; Browser Rendering API exists but has limits.

## Decision

### External Playwright service on a VPS

The scraper runs as a standalone HTTP service on a VPS, using Playwright with Chromium. The Worker calls it synchronously with a shared-secret API key. Playwright was chosen over Puppeteer for its richer API surface (network interception, `waitForLoadState('networkidle')`, multi-context support).

### Computed position baking at 1440px

The scraper opens the page at a 1440px viewport (matching the editor's default page width), calls `getBoundingClientRect()` on every meaningful element, and uses the computed pixel coordinates as the `box` values in the EditableSite. This produces a flat list of absolutely positioned elements per section — faithful to where elements actually rendered, not an inference of layout intent.

### Section detection via semantic landmarks

`<header>`, `<main>`, `<section>`, `<footer>`, `<article>`, and top-level `<body>` children become Canvas Section boundaries. Element positions are computed relative to their section's top edge.

### Custom Style Kit derivation

The scraper extracts computed colors from all visible elements, clusters by hue, selects the largest non-neutral cluster's centroid as the seed color, and feeds it through the existing OKLCH theme algebra. Fonts are ranked by frequency and mapped to the kit's display/body/mono slots.

### Asset download at scrape time

All detected images, videos, and accessible WOFF2 `@font-face` files are downloaded during the scrape and returned alongside the EditableSite. The Worker uploads media to Owner Assets, uploads imported WOFF2 files to the site-font store, and rewrites canvas media references plus custom Style Kit font tokens. No imported media URL survives as an external runtime dependency.

## Alternatives considered

**Cloudflare Browser Rendering API.** Keeps infrastructure unified but has a 2-minute execution limit, limited Puppeteer API surface, and per-session billing. Rejected because the owner already has VPS credits and wants no platform constraints.

**Client-side scraping via iframe.** Zero infrastructure — the Worker proxies the HTML, the owner's browser renders it in a hidden iframe, and JavaScript extracts positions. Rejected because stripping `<script>` tags (necessary for security) kills JS-rendered sites, which is a large fraction of the modern web. Silent failure is unacceptable.

**Layout intent inference.** Instead of baking computed positions, reverse-engineer the source CSS to detect flexbox/grid patterns and map them to canvas layout concepts. Rejected because inferring layout intent from arbitrary CSS is unreliable and would produce worse results than reading the actual computed positions. The canvas model is already absolutely positioned, so baked coordinates are a natural fit.

## Consequences

- The scraper is a separate deployment target — the VPS must be provisioned and maintained independently from Cloudflare.
- Imported sites are frozen at 1440px layout — no responsive reflow. This matches the POC constraint (desktop-only editing and viewing).
- A synchronous HTTP call to the scraper means the owner waits 10-30 seconds during import. If this proves too slow, the architecture can be extended to async polling without changing the scraper itself.
- The scraper must be protected by a shared secret; without it, the VPS becomes an open proxy for scraping arbitrary URLs.
