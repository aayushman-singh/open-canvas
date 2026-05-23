# Auto-translate batch op

**Wishlist #:** 24 **Tier:** C **Wave:** 5 **Status:** queued
**Depends on:** Phase 0 ✓, #23 chat agent (Wave 5 sibling — strictly sequential or co-wave)
**Blocks:** none

## User-visible outcome

An Owner asks the Agent (via chat #23 or a direct button in page settings): "Translate this site to Spanish". The Agent walks every `InlineRun[]` across every page, requests a batch translation, and produces a single proposed op set: a new page locale + replaced text content. The Owner previews the diff and accepts in one click. Original page kept; translated version becomes a sibling page at `/es/<slug>` (locale routing handled by #25; this feature emits the locale field but doesn't depend on #25 routing being live).

## Scope in

- Batch translation tool callable from chat (and standalone API): `POST /api/sites/:id/translate { from, to }`.
- Walk site state → collect all translatable strings (TextElement runs, ActionElement labels, FormElement labels, Page titles/descriptions, alt text).
- One LLM call returning a parallel-shaped JSON map (deterministic batching, retries on shape mismatch).
- Output as either:
  - **Replace mode** — destructive, replaces strings on existing pages and stamps `page.locale`.
  - **Sibling mode** — non-destructive, duplicates pages with slugs `/<lang>/<slug>` and `locale` set; original kept.
- Owner picks mode at the panel; default = sibling.
- Smoke uses a fake translator returning predictable outputs.

## Scope out

- Per-Element opt-out of translation.
- Translation memory / glossary.
- Image text / OCR.
- Right-to-left layout adjustments (handled by #25).

## Schema delta

None new. Uses existing `CanvasPage.locale?` (added in Phase 0 with #21).

## Files owned (write)

- `src/agent/translate/collect.ts` — walk state, return translatable string table.
- `src/agent/translate/llm.ts` — Gemini batch call with shape contract.
- `src/agent/translate/apply.ts` — build op set (replace or sibling).
- `src/agent/translate/route.ts` — `POST /api/sites/:id/translate`.
- `src/agent/chat/tools.ts` — extend with `translate_site` tool (touch only if #23 merged).
- `src/agent/translate/smoke.ts`.
- `package.json` — `translate:smoke` stub.

## Files read-only (must not modify)

- `src/canvas/schema.ts`, `src/db/schema.ts`.
- `src/agent/canvas-ops.ts` (consume).

## Contract with neighbors

- Replace mode emits one big op patch through existing op apply path (so Yjs / history consistent).
- Sibling mode emits page-create ops + content ops in a single batch.
- LLM call retries up to 2× on shape mismatch; then fails loudly.

## Smoke test

- `bun run translate:smoke`:
  - Site with one page, 3 text elements. Stub translator returns reversed strings.
  - Sibling mode: new page exists at `/es/home` with `locale='es'`; reversed strings in place.
  - Replace mode: original page has reversed strings and `locale='es'`.

## Acceptance criteria

- Owner runs translate; preview shows diff; accept produces translated content.
- Sibling mode keeps original.
- All smokes green.

## Open questions

- Whether to translate Owner-authored CSS or per-element pinned text within `pinnedStyle`. Recommend skip; only translate human-facing strings.
