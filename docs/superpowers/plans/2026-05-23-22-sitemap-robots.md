# Sitemap + robots generation

**Wishlist #:** 22 **Tier:** B **Wave:** 4 **Status:** queued
**Depends on:** Phase 0 ✓, **#21 SEO meta merged (Wave 3)**
**Blocks:** none

## User-visible outcome

Every Published Site exposes a valid `sitemap.xml` and `robots.txt` at its root. Owners with `noIndex` flagged pages see those omitted from the sitemap. Search engines crawling the Published Address find a correct list of pages, last-modified timestamps, and a `Sitemap:` line in `robots.txt`.

## Scope in

- `GET /sitemap.xml` on public host: enumerate Published Snapshot pages, emit `<urlset>` with `<loc>`, `<lastmod>` (publish timestamp), `<changefreq>`.
- `GET /robots.txt` on public host: `User-agent: *` + `Allow: /` + `Sitemap: <published-address>/sitemap.xml`. If site `noIndex` is set at the site level, emit `Disallow: /`.
- Pages with `page.noIndex: true` omitted from sitemap and listed in `Disallow:` of robots.
- Site-level `noIndex` toggle (Owner setting): when true, robots disallows everything regardless of page-level.
- Cache-Control: 1 hour public; regenerated on each publish (cache busted by snapshot version).

## Scope out

- Image sitemap (image listings inside sitemap.xml).
- News sitemap.
- Multi-site index for organizations.
- Owner override of `changefreq` / `priority` per page.

## Schema delta

Phase 0 (with #21):

```ts
// CanvasSiteState gets:
export interface CanvasSiteState {
  // ... existing
  siteNoIndex?: boolean;
}
```

## Files owned (write)

- `src/seo/sitemap/build.ts` — emit `<urlset>` from snapshot + pages.
- `src/seo/sitemap/robots.ts` — emit robots.txt.
- `src/seo/sitemap/route.ts` — `GET /sitemap.xml`, `GET /robots.txt` mounted on public host.
- `src/seo/sitemap/smoke.ts`.
- `src/routes/public.ts` — mount the two routes (Phase 0 slot).
- `package.json` — `sitemap:smoke` stub.

## Files read-only (must not modify)

- `src/canvas/schema.ts`, `src/db/schema.ts`.

## Contract with neighbors

- Reads `PublishedSnapshot.pages[*].noIndex`, `publishedAt`, and `CanvasSiteState.siteNoIndex`.
- Published Address composition matches the resolved host used by the request.

## Smoke test

- `bun run sitemap:smoke`:
  - Snapshot with 3 pages, 1 marked `noIndex` → sitemap lists 2 `<loc>` entries; robots lists `Disallow: /the-noindex-slug`.
  - `siteNoIndex: true` → robots disallows everything.
  - XML well-formed; `Content-Type: application/xml`.

## Acceptance criteria

- `sitemap.xml` validates against sitemap.org schema.
- `robots.txt` parses cleanly with standard parsers.
- All smokes green.

## Open questions

- Whether to gzip the sitemap response. Recommend yes if Worker supports easy gzip; otherwise plain.
