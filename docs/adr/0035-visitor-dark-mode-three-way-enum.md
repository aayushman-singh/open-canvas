# ADR 0035 — Visitor dark mode is a three-way enum (`light` / `dark` / `toggleable`)

**Status:** Proposed
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** beat S11.D.1 of [docs/demo/act-1-script.md](../demo/act-1-script.md) (Maya picks a *Light / Dark / Toggleable* mode in Site Settings) against the read-only finding that the editable schema field is `darkModeEnabled: boolean` at [src/canvas/schema.ts:422](../../src/canvas/schema.ts), validated at [src/canvas/validate.ts:1152](../../src/canvas/validate.ts), and rendered as a single checkbox at [src/routes/dashboard/site-settings.tsx:1415](../../src/routes/dashboard/site-settings.tsx). Closes G8 in [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.8.

## Context

The script's S11.D.1 voiceover narrates a three-option control: **Light** (light theme, no toggle), **Dark** (dark theme, no toggle), **Toggleable** (sun/moon button visible, default per visitor's OS preference). The product today exposes only two of those three: `darkModeEnabled === false` is the *Light* case and `darkModeEnabled === true` is the *Toggleable* case. **Dark** — site renders dark to every visitor, no toggle — is not expressible. The boolean shape is load-bearing in three places:

1. [src/canvas/schema.ts:422](../../src/canvas/schema.ts) declares the editable field.
2. [src/canvas/validate.ts:1152](../../src/canvas/validate.ts) gates the boolean at the publish write-gate (per [ADR 0012](0012-validation-write-gate.md)).
3. [src/routes/public.ts:1001-1023](../../src/routes/public.ts) gates two emissions on `darkModeEnabled === true`: the dual-palette CSS block emitted by `emitDualModeCss`, and the inline anti-flash mode-setter script returned by `getModeSetterScript` ([src/themes/visitor-mode/inline-script.ts](../../src/themes/visitor-mode/inline-script.ts)). The mode-setter is the FOUC guard — it stamps `data-mode="light"|"dark"` on `<html>` before first paint by reading the env-prefixed color-scheme cookie ([ADR 0017](0017-cookie-name-prefix-from-env.md)) with `prefers-color-scheme` fallback.

The script wins by default ([handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) framing rule), and the *Dark* row is the only beat S11.D.1 actually requires that the product cannot express. A boolean cannot grow a third state without either an out-of-band sibling field (two booleans for three states — a fake discriminated union, the exact anti-pattern [ADR 0016](0016-fake-discriminated-unions-to-real.md) prohibits) or a widening to an enum. This ADR takes the enum path.

## Decisions

1. **Rename the field to `visitorTheme` and widen its type to `'light' | 'dark' | 'toggleable'`.** The field lives at the same editable level (`SiteEditableState`) as `darkModeEnabled` does today and replaces it outright. No second field, no compatibility alias on the editable shape.

   **Why:** the noun `darkModeEnabled` reads naturally as a boolean ("is dark mode on?") and cannot host a `'light'` value without a category error. `visitorTheme` names the thing the Owner controls (the visitor's rendering theme) and admits three values without strain. `themeMode` was the alternative; rejected because the word *mode* already names the runtime `VisitorMode` (`'light' | 'dark'`) in [src/themes/visitor-mode/resolve.ts:50](../../src/themes/visitor-mode/resolve.ts). Naming the Owner-controlled enum `themeMode` would collide with the runtime resolver's `VisitorMode` and split the same word across two layers — exactly the conceptual-clarity trap CLAUDE.md's Design Stance flags. `visitorTheme` names the Owner-facing knob; `VisitorMode` names the runtime projection; the two stay disjoint.

2. **Hard-migrate at deploy. No deprecation window. Validator rejects the boolean from the deploy that ships this ADR onward.** The migration runs once over every persisted `SiteEditableState` and every persisted snapshot: `darkModeEnabled === true → visitorTheme: 'toggleable'`, `darkModeEnabled === false` or `undefined → visitorTheme: 'light'`. The boolean field is deleted in the same write. After the migration commit lands, `validateSiteShape` rejects any state containing `darkModeEnabled` (treating it as an unknown field) and requires `visitorTheme` to be one of the three enum values when present.

   **Why:** the no-fallback rule (CLAUDE.md "Failure Handling — All-or-Nothing") forbids the "accept both shapes for N days" pattern. A boolean-or-enum field would silently let stale clients write the old shape after the deploy, and the validator would be threading two parallel branches through every read site in [routes/public.ts](../../src/routes/public.ts), [routes/dashboard/site-settings.tsx](../../src/routes/dashboard/site-settings.tsx), [canvas/yjs-projection.ts](../../src/canvas/yjs-projection.ts), and the agent surface — the very fan-out [ADR 0016](0016-fake-discriminated-unions-to-real.md) warns against. The deployment-window argument doesn't apply: the editable state lives in Workers' D1/KV storage that the deploy migrates atomically, not on visitor browsers. There is no client-side cache of `darkModeEnabled` to honour.

3. **The `'toggleable'` runtime keeps existing visitor-side behaviour byte-for-byte.** The visitor's last-toggle choice persists via the env-prefixed color-scheme cookie ([ADR 0017](0017-cookie-name-prefix-from-env.md)). The first-paint default for a cookieless visitor remains the OS-reported `prefers-color-scheme` value, resolved by the inline mode-setter at [src/themes/visitor-mode/inline-script.ts:50](../../src/themes/visitor-mode/inline-script.ts). No change to the toggle Element ([src/themes/visitor-mode/toggle-element.ts](../../src/themes/visitor-mode/toggle-element.ts)), no change to the cookie name, no change to `resolveStyleKitForMode`.

   **Why:** the script's S11.D.1 voiceover ("On = visitors get a moon button + dark theme") describes today's `darkModeEnabled === true` behaviour verbatim. Reusing it for `'toggleable'` keeps the migration's behavioural delta to *exactly one new state* (`'dark'`) instead of accidentally re-litigating cookie semantics, OS-preference fallback, or the sun/moon glyph at the same time. Smaller surface, easier verification.

4. **The `'dark'` runtime emits the dual-palette CSS *and* the inline mode-setter script — same as `'toggleable'` does today — but does NOT emit the toggle Element and pins the resolved `data-mode` to `'dark'` regardless of cookie / OS preference.** The inline mode-setter script gains a second form: when `visitorTheme === 'dark'`, the script unconditionally sets `data-mode="dark"` on `<html>` and reads nothing (no cookie lookup, no media query). The toggle Element's auto-injection sites suppress emission when `visitorTheme !== 'toggleable'`.

   **Why:** the anti-flash guard is load-bearing for *both* the toggleable case and the dark-only case — a dark site that renders light tokens first and dark tokens after JS boot would flash white at the visitor on every navigation, which is the exact FOUC the existing script exists to prevent ([src/themes/visitor-mode/inline-script.ts:1-7](../../src/themes/visitor-mode/inline-script.ts) documents this intent). Removing the script entirely under `'dark'` would re-introduce the flash on the new path. The minimal change is: keep the script always-emitted when *either* the toggleable or dark variant is selected, but branch its body on the Owner's choice. The dark-only form is ~50 characters shorter than the toggleable form (no regex, no `matchMedia`) so the ≤220-character budget at [inline-script.ts:21-22](../../src/themes/visitor-mode/inline-script.ts) stays satisfied.

5. **The Site Settings UI replaces the checkbox at [site-settings.tsx:1415](../../src/routes/dashboard/site-settings.tsx) with a three-way radio group**, labelled *Light* / *Dark* / *Toggleable*, with the same anchor (`#dark-mode`) the script's S11.G.1 deep-link beat depends on. The data-toggle-state copy at [site-settings.tsx:1408](../../src/routes/dashboard/site-settings.tsx) ("Toggleable by visitors." / "Locked to default mode.") expands to three strings: "Light theme, no toggle." / "Dark theme, no toggle." / "Toggleable by visitors, defaults to their OS preference."

   **Why:** S11.D.1 narrates picking from three options. A radio group reads the picked option to a screen reader as a single labelled group with one active value, which matches how the voiceover narrates it. A dropdown would work but reads heavier on camera. The anchor name `#dark-mode` survives the rename so the S11.G.1 deep-link beat continues to land on the right card — renaming the anchor would cascade into the dashboard nav and the i18n mirror for no Owner benefit.

## Out of scope

- **The toggle Element's glyph or stylesheet.** [src/themes/visitor-mode/toggle-element.ts](../../src/themes/visitor-mode/toggle-element.ts) stays as-is. This ADR widens *when* the toggle is emitted (only under `'toggleable'`); it does not redesign the toggle itself.
- **Per-page theme override.** Sites pick one theme stance at the Site Settings level. A per-page `visitorTheme` override is not part of S11.D.1 and is not introduced.
- **A custom-kit "dark-only kit" path.** A kit without a `dark` partial under `visitorTheme === 'dark'` will render its light tokens with `data-mode="dark"` stamped, per the documented `resolveStyleKitForMode` fallback ([resolve.ts:56-62](../../src/themes/visitor-mode/resolve.ts)). Owners who pick *Dark* on a kit with no dark variant get the kit's light tokens; the resolution of that mismatch (validator warning? auto-derive a dark variant? force a kit swap?) is a separate decision that does not block S11.D.1.
- **Migration of the agent-side mentions of `darkModeEnabled`** ([src/agent/canvas-ops.ts](../../src/agent/canvas-ops.ts), [src/agent/canvas-tools.ts](../../src/agent/canvas-tools.ts), [src/agent/tool-parsers.ts](../../src/agent/tool-parsers.ts), [src/agent/chat/orchestrator.ts](../../src/agent/chat/orchestrator.ts)). Those are call-site renames; they ship with the schema migration but their listing here would balloon this ADR into a checklist. Follow-ups section names them.
- **A localStorage compatibility shim for `darkModeEnabled`.** The boolean was never persisted client-side; the cookie is the only client-side state and its name doesn't change.

## Consequences

**Positive:**

- The script records S11.D.1 as written. No producer-side rewrite, no script-fix #14 carve-out.
- Owner can pick *Dark* — a genuinely new product capability the boolean could not express.
- One enum field replaces what would otherwise be one boolean + one second field; the [ADR 0016](0016-fake-discriminated-unions-to-real.md) discipline holds.
- `visitorTheme` reads correctly in three voices: the editable schema, the Site Settings UI, and the public-renderer branch. `darkModeEnabled` only read correctly in the schema; it was awkward in the UI ("Visitor dark mode" labelled a checkbox that controlled a *toggle*, not a mode) and load-bearing in the renderer through a `=== true` check that doesn't generalise.

**Negative:**

- A schema migration. The hard-cutover policy means the deploy that ships this ADR runs a one-shot rewrite of every persisted editable state + snapshot. Failure modes are: storage-write contention (the migration is bounded by D1 throughput, not a concern at current scale) and a partially-migrated state if the migration crashes mid-run (the migration must be idempotent — re-running it on already-migrated rows is a no-op). Both are addressable; both are net new work.
- The inline mode-setter script gains a second form. Two ~one-liner scripts are still less complex than one branching script, but the smoke at [src/themes/visitor-mode/inline-script.smoke.ts](../../src/themes/visitor-mode/inline-script.smoke.ts) (if extant) or its replacement must pin both forms.
- The three call-site rename across the agent surface is mechanical but spans four files. Easy to get wrong if the migration commit isn't reviewed call-site-by-call-site.

## Follow-ups

- Schema: rename `darkModeEnabled?: boolean` to `visitorTheme?: 'light' | 'dark' | 'toggleable'` at [src/canvas/schema.ts:422](../../src/canvas/schema.ts). Update the doc comment to name the three values explicitly.
- Validator: rewrite the boolean check at [src/canvas/validate.ts:1152](../../src/canvas/validate.ts) to `assertOneOf<VisitorTheme>(state.visitorTheme, ['light', 'dark', 'toggleable'], 'visitorTheme', errors)` and ensure the unknown-field guard rejects a literal `darkModeEnabled` key (defence in depth — the migration should have removed every instance before this validator sees it).
- Renderer branch at [src/routes/public.ts:1001-1023](../../src/routes/public.ts): replace the `darkModeEnabled === true` check with a switch on `visitorTheme`. Emit dual CSS + mode-setter under both `'dark'` and `'toggleable'`. Suppress the toggle Element's auto-injection under `'light'` and `'dark'`.
- Anti-flash script at [src/themes/visitor-mode/inline-script.ts](../../src/themes/visitor-mode/inline-script.ts): export a second form for `'dark'` that stamps `data-mode="dark"` unconditionally. Pin both forms with smokes under the same character budget.
- Site Settings UI at [src/routes/dashboard/site-settings.tsx:1400-1430](../../src/routes/dashboard/site-settings.tsx): swap the checkbox for a three-way radio group under the same `#dark-mode` anchor.
- Agent surface: rename `darkModeEnabled` references in [src/agent/canvas-ops.ts](../../src/agent/canvas-ops.ts), [src/agent/canvas-tools.ts](../../src/agent/canvas-tools.ts), [src/agent/tool-parsers.ts](../../src/agent/tool-parsers.ts), [src/agent/chat/orchestrator.ts](../../src/agent/chat/orchestrator.ts) and any tool descriptions exposed to the LLM (the tool now sets a string enum, not a boolean).
- Fixture: update [src/canvas/fixtures/apogee-showcase.json](../../src/canvas/fixtures/apogee-showcase.json) to carry `visitorTheme: 'toggleable'` so the showcase keeps rendering with the sun/moon button the demo recording expects.
- Migration: one-shot idempotent rewrite over `SiteEditableState` + every persisted snapshot. Add a smoke that fails on any persisted row containing `darkModeEnabled`.
- Update [handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.8 to mark G8 closed by this ADR.
