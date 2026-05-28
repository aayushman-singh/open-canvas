# Wishlist — Gamma.app feature-parity POC

> 25-item feature wishlist for parallel-agent dispatch. Master index, locked decisions, dependency graph, wave schedule, and dispatch convention.

**Drafted:** 2026-05-23
**Status:** Phase 0 scaffold pending. Waves 1–5 pending.
**Source:** grill-with-docs session 2026-05-23 (Q1–Q13).

---

## Locked decisions

| #     | Decision           | Outcome                                                                                                    |
| ----- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| Q1–Q2 | Wishlist scope     | 25 items accepted, all in                                                                                  |
| Q3    | Schema chokepoint  | Hybrid — Phase 0 scaffold pre-bakes union, then per-feature dirs                                           |
| Q4    | Operation paradigm | Stream-as-truth (Yjs op-log canonical, snapshots = materialized photos)                                    |
| Q5    | CRDT engine        | **Yjs** (revive retired `src/multiplayer/` foundations)                                                    |
| Q6    | Asset storage      | R2 originals (content-hash key) + `cf.image` transform-on-fetch                                            |
| Q7    | Custom domains     | **Cloudflare for SaaS** — Custom Hostnames API, auto-cert                                                  |
| Q8    | Symbol model       | Override-style — master + per-instance partial overrides                                                   |
| Q9    | Forms              | Dedicated `formSubmission` table, Turnstile, DO rate-limit, DB + optional webhook delivery                 |
| Q10   | Version history    | Snapshots **at publish only** — drop per-edit op log persistence                                           |
| Q11   | Plan format        | One md per feature in `docs/superpowers/plans/` + this master index                                        |
| Q12   | Dispatch           | Worktree per agent, 5-wave schedule, 5 concurrent agents per wave                                          |
| Q13   | Phase 0 scaffold   | Schema + registries + DB tables + R2 + asset migration + Yjs projection + per-feature dirs + smoke entries |

Accepted ADRs:

- [ADR 0005 — Custom domains via Cloudflare for SaaS](../../adr/0005-custom-domains.md).
- [ADR 0006 — Owner Asset storage backend: R2 originals + Cloudflare image transforms](../../adr/0006-asset-storage-backend.md) (supersedes the storage deferral in ADR 0004).
- [ADR 0007 — Yjs revival as canonical operation model](../../adr/0007-yjs-revival.md).

---

## Wishlist (25 items)

### Tier S — flagship engineering

| #   | Feature                        | Owns (write)              | Smoke                |
| --- | ------------------------------ | ------------------------- | -------------------- |
| 1   | Responsive canvas render       | `src/canvas/responsive/`  | `responsive:smoke`   |
| 2   | Asset pipeline (R2 + cf.image) | **Phase 0** — main thread | `assets:smoke`       |
| 3   | Version history + restore      | `src/version/`            | `version:smoke`      |
| 4   | Realtime co-editing (Yjs ops)  | `src/live/co-edit/`       | `coedit:smoke`       |
| 5   | Custom domains (CF for SaaS)   | `src/custom-domain/`      | `customdomain:smoke` |
| 6   | OG image generation at edge    | `src/og-image/`           | `og:smoke`           |

### Tier A — meaty subsystems

| #   | Feature                    | Owns (write)    | Smoke            |
| --- | -------------------------- | --------------- | ---------------- |
| 7   | Forms subsystem            | `src/forms/`    | `forms:smoke`    |
| 8   | Embed primitive            | `src/embed/`    | `embed:smoke`    |
| 9   | Password-protected publish | `src/password/` | `password:smoke` |
| 10  | Custom theme editor        | `src/themes/`   | `themes:smoke`   |
| 11  | Charts primitive           | `src/charts/`   | `charts:smoke`   |
| 12  | Custom font upload         | `src/fonts/`    | `fonts:smoke`    |
| 13  | Site search                | `src/search/`   | `search:smoke`   |
| 14  | Reusable cards / symbols   | `src/symbols/`  | `symbols:smoke`  |
| 15  | A11y audit subsystem       | `src/a11y/`     | `a11y:smoke`     |

### Tier B — primitives + UX surfaces

| #   | Feature                                    | Owns (write)                                  | Smoke                |
| --- | ------------------------------------------ | --------------------------------------------- | -------------------- |
| 16  | Multi-page nav (uses #14)                  | `src/canvas/elements/nav.ts` + editor surface | `nav:smoke`          |
| 17  | Accordion + carousel + interactive runtime | `src/interactive/`                            | `interactive:smoke`  |
| 18  | Table primitive                            | `src/canvas/elements/table.ts`                | `table:smoke`        |
| 19  | Code snippet (Shiki)                       | `src/canvas/elements/code.ts`                 | `code:smoke`         |
| 20  | Light/dark visitor toggle                  | `src/themes/visitor-mode/`                    | `visitor-mode:smoke` |
| 21  | SEO meta + page metadata                   | `src/seo/`                                    | `seo:smoke`          |
| 22  | Sitemap + robots generation                | `src/seo/sitemap/` (sibling under #21)        | `sitemap:smoke`      |

### Tier C — agent-side + i18n

| #   | Feature                            | Owns (write)           | Smoke             |
| --- | ---------------------------------- | ---------------------- | ----------------- |
| 23  | AI chat multi-turn command surface | `src/agent/chat/`      | `chat:smoke`      |
| 24  | Auto-translate batch op            | `src/agent/translate/` | `translate:smoke` |
| 25  | RTL + per-page locale routing      | `src/i18n/`            | `i18n:smoke`      |

---

## Dependency graph

```
Phase 0 (scaffold)
  ├── schema scaffold ────────────────────► ALL Tier A/B/C
  ├── R2 + cf.image + asset migration (#2) ► #6, #12, every recipe loading media
  ├── Yjs projection module                ► #3, #4
  └── per-feature dirs + smoke entries     ► every wave

Wave 1 (Tier S)
  #1 responsive     — independent
  #3 version hist   — needs Yjs projection (Phase 0)
  #4 co-edit        — needs Yjs projection (Phase 0)
  #5 custom domains — independent (infra)
  #6 OG image       — needs #2 (Phase 0 ✓)

Wave 2 (Tier A — set 1)
  #7 forms          — independent (new table + new element)
  #8 embed          — independent (new element)
  #9 password       — independent (publish-path tap)
  #10 custom theme  — touches StyleKit registry (reads only)
  #11 charts        — independent (new element)

Wave 3 (Tier A — set 2)
  #13 search        — reads Published Snapshot; independent
  #14 symbols       — new element + new master table; FROZEN by Phase 0
  #15 a11y audit    — read-only over snapshot; runs late
  #20 light/dark    — touches StyleKit token contract (additive only)
  #21 SEO meta      — adds fields to CanvasPage (Phase 0 ✓)

Wave 4 (Tier B + bridge)
  #17 accordion/carousel + interactive runtime
  #18 table
  #19 code snippet
  #22 sitemap/robots — reads #21 fields (Wave 3 done)
  #16 nav            — NEEDS #14 done (Wave 3)

Wave 5 (Tier C + tail)
  #12 fonts          — NEEDS #2 (Phase 0 ✓)
  #23 chat agent
  #24 translate
  #25 RTL / locale routing
```

Cross-wave ordering constraints:

- Wave 4 #16 must come after Wave 3 #14.
- Wave 4 #22 must come after Wave 3 #21 (reads SEO fields).
- All Tier-B/C waves wait on Phase 0.

---

## Wave schedule

5 waves, each = up to 5 concurrent agents dispatched in one tool message.

| Wave  | Items                                      | Notes                                   |
| ----- | ------------------------------------------ | --------------------------------------- |
| **0** | Phase 0 scaffold (main thread, sequential) | See checklist below.                    |
| **1** | #1, #3, #4, #5, #6                         | Tier S parallel.                        |
| **2** | #7, #8, #9, #10, #11                       | Tier A first batch.                     |
| **3** | #13, #14, #15, #20, #21                    | Tier A second batch.                    |
| **4** | #16, #17, #18, #19, #22                    | Tier B. #16 depends on #14 from Wave 3. |
| **5** | #12, #23, #24, #25                         | Tier C + Wave-2-dep tail.               |

Between waves: main thread merges worktree branches to `wishlist-integration`, runs `bun run wishlist:smoke`, resolves any cross-cutting drift.

---

## Phase 0 scaffold checklist

Sequential, main thread, ~1–2 days. Lands on `main` directly via single PR before any wave fires.

### 0.1 Schema scaffold (`src/canvas/schema.ts`)

- [ ] Expand `ELEMENT_TYPES` to include `'symbol-instance' | 'form' | 'embed' | 'chart' | 'accordion' | 'carousel' | 'table' | 'code' | 'nav'`.
- [ ] Expand `SECTION_RECIPE_IDS` w/ recipe names per new element (factories live in each feature dir).
- [ ] Add `CanvasPage` SEO fields: `title?`, `description?`, `ogImageAssetId?`, `canonical?`, `noIndex?`, `locale?`.
- [ ] Add `CanvasSiteState.symbols: SymbolMaster[]`.
- [ ] Add `BaseElement.responsive?: ResponsiveOverrides` placeholder.
- [ ] `CanvasElement` union imports new types from `src/canvas/elements/*` placeholder files.

### 0.2 Element registry (`src/canvas/elements/`)

- [ ] One stub file per new ElementType. Each exports interface + recipe id constant + render fn signature (body = `throw new Error('TODO')`).
- [ ] `src/canvas/elements/index.ts` aggregator — frozen contract.
- [ ] Convert `src/canvas/render.ts` to dispatch table `RENDER_DISPATCH[type](element, ctx)`. Agents add their entry, never edit `render.ts`.

### 0.3 DB schema additions (`src/db/schema.ts`)

- [ ] `customDomain` table (hostname, cfHostnameId, status, verificationRecord, certIssuedAt).
- [ ] `formSubmission` table (siteId, formElementId, pageSlug, payload jsonb, ipHash, userAgent, submittedAt).
- [ ] `siteSnapshot` table (siteId, yjsSnapshotBytes bytea, capturedAt, reason, label, publishedVersion).
- [ ] `siteSymbol` table (siteId, name, section jsonb).
- [ ] `siteAsset` migration: drop `bytesBase64`, add `contentHash`, `width`, `height`, `byteSize`, `r2Key`. Backfill or drop dev rows.
- [ ] `themePreset` table (siteId, name, tokens jsonb) — optional, defer if owner-themes stay in `editableState`.

### 0.4 Bindings + env (`wrangler.toml`)

- [ ] R2 bucket binding `ASSETS_BUCKET`.
- [ ] DO bindings: `SiteRoom` (exists), `FormRateLimiter` (new stub).
- [ ] Env vars declared: `CF_API_TOKEN`, `CF_ZONE_ID`, `TURNSTILE_SECRET`, `TURNSTILE_SITE_KEY`.

### 0.5 Yjs projection (`src/canvas/yjs-projection.ts`)

- [ ] Re-add `yjs`, `y-protocols` to `package.json`.
- [ ] Export `encodeYDoc(state: CanvasSiteState): Y.Doc`.
- [ ] Export `decodeYDoc(doc: Y.Doc): CanvasSiteState`.
- [ ] Export `attachAutosave(doc, debounceMs, onPersist)`.
- [ ] Frozen contract — co-edit (#4) and version history (#3) both consume.

### 0.6 Asset pipeline migration (#2 pulled into Phase 0)

- [ ] `src/assets/r2-client.ts` — R2 SDK wrapper.
- [ ] `POST /api/sites/:id/assets` — multipart upload → SHA256 → R2 put → DB insert.
- [ ] `GET /assets/:contentHash` — fetch via `cf.image` Transform-from-URL.
- [ ] Migration script: existing base64 rows → R2 + drop column.
- [ ] `assets:smoke` script.

### 0.7 Per-feature dirs created empty

For each Tier-A/B/C feature: `mkdir src/<feature>/` + `SUBSYSTEM.md` stub naming owner agent + wave.

### 0.8 Smoke scaffold (`package.json`)

- [ ] One entry per feature smoke (no-op stub returning 0 until agent fills).
- [ ] Master `wishlist:smoke` runs every per-feature smoke serially.

---

## Dispatch convention

### Per-agent brief template

```
You are implementing wishlist item #<n> for the rev01 repo.

Read `docs/superpowers/plans/2026-05-23-<slug>.md` end-to-end. That file is your full brief.

Rules:
- Touch ONLY files listed under "Files owned" in the plan.
- Files under "Files read-only" must not be modified.
- Schema in `src/canvas/schema.ts` is frozen — additions live in your feature dir.
- Run `bun run typecheck`, `bun run lint`, and the smoke listed in the plan. All must pass.
- When done, report: branch name, files changed, smoke output.

Do not invent features beyond the plan. If something is unclear, fail loudly with a question.
```

### Tool-call shape

```
Agent({
  description: "Wishlist #<n> — <feature>",
  subagent_type: "general-purpose",
  isolation: "worktree",
  prompt: <brief template above, filled in>,
})
```

Wave dispatches as one tool message containing 5 parallel `Agent` calls.

### Integration branch

- Phase 0 lands on `main`.
- Each wave's 5 worktree branches merge into `wishlist-integration` between waves.
- `wishlist-integration` rebases on `main` only when all 5 waves complete and full `wishlist:smoke` passes.
- Final merge `wishlist-integration` → `main` after manual review of integrated diff.

---

## Plan-file template

Each per-feature plan file follows this shape. See individual plans for filled-in values.

```markdown
# <feature-name>

**Wishlist #:** <n> **Tier:** <S|A|B|C> **Wave:** <1-5> **Status:** queued

**Depends on:** Phase 0 ✓, [#X if any]
**Blocks:** [#Y if any]

## User-visible outcome

<one paragraph, no tech words>

## Scope in

- ...

## Scope out

- ...

## Schema delta

<exact TS interfaces / DB tables — Phase 0 must have already scaffolded these>

## Files owned (write)

- src/<feature>/...

## Files read-only (must not modify)

- src/canvas/schema.ts
- src/canvas/render.ts (dispatch table — register your entry via `src/canvas/elements/<your>.ts`)
- src/db/schema.ts
- ...

## Contract with neighbors

<exports / route shapes / how data flows in and out>

## Smoke test

- `bun run <feature>:smoke`
- specific assertions

## Acceptance criteria

- bulleted, demoable

## Open questions

<flag here, don't ship with unknowns>
```
