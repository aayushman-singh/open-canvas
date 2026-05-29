# ADR 0038 — Snapshot preview is a server-rendered sandboxed iframe via srcdoc

**Status:** Accepted
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** Owner-facing version history needs an "informed Restore." Closes the gap named in [handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.11 and the demo recording beat in [act-1-script.md](../demo/act-1-script.md) Session 12.F. Anchors the shape of the snapshot-preview pipeline already wired into [src/version/preview-render.ts](../../src/version/preview-render.ts), [src/version/route.ts](../../src/version/route.ts), and [src/routes/dashboard/version-timeline.tsx](../../src/routes/dashboard/version-timeline.tsx).

## Context

The Versions timeline at `/dashboard/sites/:siteId/snapshots` lists snapshots newest-first. Each row is either the live publish, a past publish, or an Owner-saved manual capture. Until this ADR, the only action available was **Restore** — a destructive overwrite of the live editable state. An Owner clicking Restore on a 14-day-old snapshot had no way to verify "is this the version with the broken hero image, or the one before?" The lived outcome the script names is *scrubbing the timeline like a film reel*: hover/click a row, see that snapshot rendered, decide, then Restore.

The snapshot rows hold `yjsSnapshotBytes` (per [ADR 0007](0007-yjs-revival.md) — `Y.encodeStateAsUpdate` bytes in a Postgres `bytea` column). The renderer that produces visitor HTML, `renderCanvasSnapshot`, takes a `PublishedSnapshot` JSON shape, not Yjs bytes. The bridge between them is the projection module from [ADR 0027](0027-yjs-projection-central-placement.md) (`decodeYDoc` in `src/canvas/yjs-projection.ts`).

Four tensions had to resolve before the preview could ship:

1. **Where does decode-and-render happen — server or client?** Server-side reuses the production renderer that visitors already hit; client-side would force the dashboard bundle to carry Yjs + the full canvas renderer.
2. **What is the URL shape, and who can call it?** The iframe needs the Owner's session; visitors must never be able to reach the snapshot bytes; the published-site cache must not learn the snapshot URL exists.
3. **How tight is the iframe sandbox?** The snapshot is *Owner-authored* HTML, but it is read-only at preview time. Any script execution would have to be justified.
4. **How is the HTML delivered into the iframe?** A snapshot-URL the iframe loads vs. inline `srcdoc` injection of the rendered HTML.

## Decisions

1. **Snapshot preview rendering runs server-side, reusing `renderCanvasSnapshot` against a decoded `EditableSite`. The route is `GET /api/sites/:siteId/snapshots/:snapshotId/preview` and it returns JSON `{ ok, html, capturedAt, reason, label, publishedVersion }` — not an HTML document.**

   **Why:** the renderer is the single source of truth for "what a visitor sees" and the preview's lived outcome is *visitor-equivalent fidelity at a past moment*. Re-implementing render in the client would create a second renderer that drifts from the first one — exactly the failure mode [ADR 0025](0025-renderer-is-only-throw-site.md) refuses by making the renderer the only throw site. Decoding Yjs in the client would also force every dashboard page to carry the Yjs runtime so that one button works; the server already has Yjs in scope for restore and capture. Returning JSON (not `text/html`) keeps the route's response shape consistent with the rest of `/api/sites/:siteId/snapshots/*` and gives the client room to attach the Owner-facing metadata (label, capturedAt) without parsing it out of the HTML head.

2. **The preview URL lives under `/api/sites/:siteId/snapshots/:snapshotId/preview` — the same Owner-scoped, Clerk-authenticated tree as list / capture / restore. It is never reachable on the published apex, the custom domain, or any visitor-facing path.**

   **Why:** snapshots may contain unpublished edits, deleted pages, or content the Owner has since redacted. Putting the preview anywhere a visitor could reach (e.g. on the site's apex with a query string) would leak the entire revision history to anyone who guessed a snapshot id. Keeping it on `/api/` means it inherits the same `clerkAuth` + `requireAuth` + `resolveOwnedSiteId` triple that protects restore — the same ownership check that gates *overwriting* the site also gates *reading* the bytes. Cookies the iframe needs are already on the dashboard's origin; no separate auth dance.

3. **The iframe consumes the HTML via `srcdoc`, not by setting `src` to the preview URL. The preview JSON ships the rendered markup once; the client wraps it in `<!doctype html><html><body>…</body></html>` and assigns it to `srcdoc`.**

   **Why:** `srcdoc` gives the iframe an opaque origin (a "null" origin) by default. That means the snapshot HTML cannot read dashboard cookies, cannot reach `parent.*` for cross-frame messaging, and cannot pollute any HTTP cache anywhere — the bytes never traverse a URL the browser caches under. The alternative — `src="…/preview"` — would mean the iframe inherits the dashboard's origin (since the URL is same-origin), which would *re-grant* exactly the privileges the sandbox is trying to take away. `srcdoc` also makes the snapshot-preview round-trip independent of any future edge-cache rules on `/api/*`; if a CDN ever caches `/api/sites/*/preview` responses incorrectly, the iframe is still rendering from the fetched JSON, not from a separately-cached HTML doc.

4. **The iframe is created with `sandbox=""` — the empty attribute, which drops *all* sandbox grants including `allow-same-origin` and `allow-scripts`.**

   **Why:** the preview is a *visual diff aid before a destructive choice*. It is not a working copy of the site and never will be. Granting `allow-scripts` would let snapshot JS run inside the dashboard's tab — even with `srcdoc`'s null origin, a script could exfiltrate the snapshot's DOM, attempt parent-frame attacks, or simply hit unbounded CPU and freeze the Owner's tab mid-scrub. The cost of denying scripts is that snapshot-time JS (analytics, animations driven by JS) does not run. That cost is correct: the Owner is comparing *structure and content*, not behaviour. Forms inside the preview are inert by side effect — without scripts they can render, but without same-origin they cannot POST anywhere meaningful even if a user clicked Submit. This matches the read-only contract advertised by the timeline UI.

5. **Each preview render is computed on demand. There is no pre-render of all snapshots and no server-side cache. The browser caches nothing (`srcdoc` is non-cacheable by construction and the JSON response carries no caching headers).**

   **Why:** snapshots are immutable once captured, so a cache would be safe in principle — but the access pattern is "Owner scrubs three rows, picks one, walks away." Pre-rendering every snapshot at publish time would pay rendering cost for snapshots no one ever previews; building a snapshot-id-keyed cache would add a Postgres lookup, a cache-coherency story for the (very rare) snapshot deletion path, and a new failure mode at the cache layer. The render itself is the same Yjs-decode-plus-renderer the publish path already runs; if it ever becomes too slow for an Owner-facing single-snapshot request, the right answer is to profile the renderer (which benefits the publish path too), not to add a cache. Per the failure-handling stance, "make it more robust with a cache" is exactly the kind of paper-over this project refuses.

6. **CSS variables, fonts, asset references inside the preview resolve against the same `/assets` base path the live site uses. The route passes `'/assets'` explicitly to `renderSnapshotPreview`; there is no auto-default.**

   **Why:** the preview is supposed to *look like* the visitor's site at that moment. The Owner Asset path ([ADR 0004](0004-owner-asset.md)) is the single place owner-uploaded bytes resolve from; pointing the iframe at the same path means historical asset references render through the live Owner Asset store. If a referenced asset has since been deleted, the preview shows a broken image — that's an accurate rendering of "what would have happened if a visitor loaded this snapshot today," and it is information the Owner needs before restoring. Passing the base path explicitly rather than defaulting matches the no-fallback rule: a future custom-domain or CDN front never silently falls through to `/assets` because no one wrote a default.

## Out of scope

- **Side-by-side diff of two snapshots.** The preview shows one snapshot at a time. A diff view is a different lived outcome (comparing two specific moments) and a different render pipeline (two iframes, scroll-sync). Future ADR if pursued.
- **Restoring a single page from a snapshot rather than the whole site.** Restore stays all-or-nothing per [ADR 0007](0007-yjs-revival.md)'s snapshot model.
- **Awareness / co-edit presence overlays in the preview.** The preview is a frozen past state; awareness is a live concept. They do not mix.
- **Mobile / tablet device-frame previews.** The iframe defaults to its CSS width (the preview card width). Responsive testing is a separate concern.
- **Cache invalidation when snapshots are deleted.** Snapshot retention is a plan-layer concern per [ADR 0007](0007-yjs-revival.md) consequences; decision 5 above makes this moot for the preview specifically.
- **Letting visitors share a "preview link" to a past version.** Snapshots are Owner-private. A future ADR could add a signed shareable URL; this ADR does not.

## Consequences

**Positive:**
- An Owner scrubs the timeline and sees each snapshot inline. Restore stops being a leap of faith.
- One renderer ([ADR 0025](0025-renderer-is-only-throw-site.md)) serves visitors and the preview; no second render path to keep in sync.
- The sandbox + `srcdoc` combination means a hostile snapshot (Owner pastes something nasty, exports/imports across sites, etc.) cannot reach the dashboard's cookies, the parent frame, or any HTTP cache.
- The preview URL lives under the same Owner-scoped auth gate as restore; the access boundary is identical to the *write* path that already exists. No new auth surface.

**Negative:**
- JS-driven behaviour (analytics, animation libraries, third-party widgets) does not run in the preview. Owners who rely on JS-rendered content will see the pre-script DOM. This is a deliberate read-only stance, not a bug.
- The Yjs decode + render runs synchronously per click. For sites with many pages this could take a few hundred ms; the preview card shows "Loading…" during the round-trip and the cost is paid once per scrubbed snapshot.
- No cache means a second click on the same snapshot pays the render cost again. Acceptable until profiling says otherwise.
- A deleted-asset reference inside the snapshot renders as a broken image. This is correct behaviour (it surfaces a real consequence of restoring) but it can confuse Owners who don't realise an asset was removed since the snapshot.

## Follow-ups

- Add a smoke that POSTs a manual snapshot, GETs `/preview`, and asserts the response includes `ok: true` and an `html` field starting with the renderer's expected document prefix.
- Add a smoke that hits `/preview` as a non-owner and asserts 404 (not 401 / 403 — the ownership leak rule from [ADR 0010](0010-invite-link-bearer-auth.md) applies here too).
- Add a Playwright test under the demo verification suite for Session 12.F: navigate to Versions, click Preview on a non-live row, assert an iframe appears inside `[data-timeline-preview]` and that `setActive` decorates the clicked row.
- If preview latency becomes a complaint, profile `decodeYDoc` + `renderCanvasSnapshot` rather than adding a cache layer.
- Consider whether the demo recording wants a small "Snapshot from {capturedAt}" caption above the iframe, surfaced from the JSON metadata that the route already returns.
