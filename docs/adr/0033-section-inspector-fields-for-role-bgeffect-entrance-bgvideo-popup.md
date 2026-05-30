# ADR 0033 — Section inspector surfaces role, background effect, entrance, background video and popup trigger

**Status:** Accepted
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** beats S5.P.1 / S5.Q.1 / S5.R.1 of [docs/demo/act-1-script.md](../demo/act-1-script.md) (Maya cycles section background effects, exposes role on header/footer, picks a popup trigger), against gap **G6** in [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.6: five `CanvasSection` fields are persisted, validated and rendered but have no editor inspector control.

## Context

`CanvasSection` at [src/canvas/schema.ts:332-353](../../src/canvas/schema.ts) carries five fields with no editor surface today:

- `role?: SectionRole` — `'header' | 'footer' | 'body'`; drives `isPinnedSection` at [canvas-client.ts:2348](../../src/editor/canvas-client.ts) and the `data-section-role` attribute the published renderer reads to pin position.
- `backgroundEffect?: BackgroundEffect` — one of six (`none / grain / grid / soft-light / paper / glass`), painted via `data-bg-effect` at [canvas-client.ts:2402](../../src/editor/canvas-client.ts).
- `entrance?: MotionPreset` — section-level entrance from the 17-value `MOTION_PRESETS` union, painted via `data-entrance`.
- `backgroundVideoAssetId?: string` — owner-asset id of an MP4/webm clip; same `*AssetId` shape as `posterAssetId` on `VideoMediaElement` ([src/canvas/elements/media.ts:28](../../src/canvas/elements/media.ts)).
- `trigger?: { type: 'exit-intent' } | { type: 'delay'; value: number } | { type: 'scroll'; value: number }` — popup discriminated union; presence transforms the section's render behaviour into a popup.

`renderSectionInspector` at [canvas-client.ts:3929](../../src/editor/canvas-client.ts) renders only action buttons (duplicate / move up / move down / save to library / delete / generate with AI). No field group. The demo script's Session 5 closing beats (S5.P / Q / R) currently sit at voiceover-only because of this absence, with S5.R explicitly noting "_Future product: surface popupTrigger in a section inspector._" The framing rule from [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) is *script wins by default* — and the script wants the camera to show Maya editing these on-canvas, not voicing them over the AI Chat.

The reference pattern is `textInspectorSpec` at [src/canvas/elements/text.ts:54](../../src/canvas/elements/text.ts) (rendered by `renderInspectorSpec` at [canvas-client.ts:2940](../../src/editor/canvas-client.ts) per ADR 0011 Step 1). It declares fields by `kind` (`select`, `select-mapped`, `number`, `button-action`) and the interpreter walks the spec to build the DOM. That dispatch is **element-typed** — `INSPECTOR_DISPATCH` is `Record<Exclude<ElementType, 'collection'>, InspectorSpec>` — and sections are not elements, so the spec interpreter does not directly cover them. The section inspector is its own renderer.

Three tensions need naming:

- **Schema-driven generation vs. hand-rolled rows.** A second `renderInspectorSpec`-style dispatch keyed by *section* would generalise but adds infrastructure for a single consumer. `backgroundVideoAssetId` needs an asset picker (upload button, thumbnail, clear) which is not in any existing spec `kind`. Generalising would require either widening the spec or letting the asset row fall through to hand-rolled DOM anyway.
- **`role` field coexisting with the film reel.** Pinned sections already surface their role to the canvas via `data-section-role` and via the reel's hover affordances; `isPinnedSection` guards block users from duplicating, moving or AI-generating header/footer sections. Adding role to the inspector creates two edit surfaces for the same field — and worse, the inspector itself is rendered with the pinned-section guards in place (no Duplicate / Move buttons when `pinned`), so toggling `role` from the inspector would change which other buttons are visible mid-render.
- **`trigger` semantics — structural, not stylistic.** Setting `trigger` is not a cosmetic change — it makes the section render as a popup at visitor-time. Mixing it with `entrance` and `backgroundEffect` in one flat group invites users to "decorate" a section and then accidentally turn it into a popup. The discriminated-union shape (`exit-intent` has no `value`; `delay` and `scroll` require one with different units — ms vs. percentage) also means the control is conditional, not a flat select.

## Decisions

1. **Hand-roll the section inspector fields in `renderSectionInspector`. Do not generalise the spec-driven `INSPECTOR_DISPATCH` interpreter to sections.**

   **Why:** the spec interpreter exists to keep the element dispatch table the single source of truth for *which fields each element type exposes* — a non-trivial cross-cut covered by [ADR 0011](0011-canvas-element-registry.md). Sections have exactly one inspector consumer and one schema shape; there is no second consumer that benefits from a section-spec abstraction. Three of the five new controls (`role`, `backgroundEffect`, `entrance`) are plain `select`s that hand-roll in three lines each via the existing `selectInput` + `field` helpers already in canvas-client. The asset picker for `backgroundVideoAssetId` and the conditional trigger control don't fit any existing `kind`, so generalising would still leave them hand-rolled. Adding spec infrastructure for a one-time benefit is the kind of incidental complexity the design stance rejects.

2. **Group the five fields into three labelled sub-groups inside the inspector, in this order: "Section" (role only), "Background" (backgroundEffect, backgroundVideoAssetId), "Motion & behaviour" (entrance, trigger). Action buttons stay where they are at the bottom of the inspector.**

   **Why:** the three groups reflect three distinct concerns the Owner reasons about. Role is *structural* — it changes pinning, blocks Duplicate / Move and is normally set once per section. Background and motion are *presentation*. Trigger is *behaviour* — it changes what the section does, not what it looks like. Co-locating `entrance` with `trigger` keeps both motion-adjacent edits in one place without putting trigger next to the purely-decorative bgEffect select, which is what would invite the "I was changing styles and turned my hero into a popup" mistake. The Owner reads top-to-bottom; placing role first matches the existing inspector header / meta order and makes the role's structural weight visible before any presentation choice.

3. **`role` is an editable `select` in the inspector. The film-reel keeps surfacing role as a read-only visual signal (existing hover tooltips, the existing `data-section-role` attribute the published renderer reads). The inspector becomes the canonical edit point; the reel does not get an in-place editor.**

   **Why:** the script's S5.Q.1 beat already treats the film reel as a *read* surface ("Hover the first section thumbnail (the nav) — tooltip / outline shows role=header"). There is no script beat that has the Owner editing role from the reel. Two read surfaces for the same field is fine and matches existing patterns (the canvas surface shows the section's role through pinning behaviour; the inspector shows it in a field). Two *edit* surfaces is what creates ergonomics-divergence drift. The inspector is also the right place because of decision 4 — when `role` changes, the inspector itself re-renders with different action buttons available, and that re-render is local to the inspector, not the reel.

4. **Changing `role` triggers an immediate re-render of the section inspector. The action-buttons group at the bottom updates in place to reflect the new pinned state.**

   **Why:** `isPinnedSection` already gates Duplicate / Move up / Move down (lines 3955-3958 of canvas-client). If role is editable, those buttons must come and go with the field. The cheapest correct behaviour is for the role-change handler to call `renderSectionInspector` again — the inspector is small, the rebuild is O(constant), and re-rendering keeps the gating logic in exactly one place (`isPinnedSection` ∘ `defs.push` already in renderSectionInspector). Any other approach (toggling button `disabled` from the role handler, hoisting the guards) splits the gating across the file.

5. **`backgroundVideoAssetId` uses an upload-button + thumbnail + clear-button row, mirroring the `backgroundImageAssetId` row at [canvas-client.ts:4448-4503](../../src/editor/canvas-client.ts) (element-style background image). The hidden `input[type=file]` is appended to the row (Chromium gesture rule) and its `accept` attribute is `video/*`. Upload calls the existing `postAssetUpload` helper at [canvas-client.ts:5004](../../src/editor/canvas-client.ts).**

   **Why:** the element-style background-image row already solves every problem this row has — gesture-attached file input, thumbnail-or-"none" display, separate clear button, `postAssetUpload` integration, optimistic UI with status messages. The shape transfers verbatim with `accept="video/*"` and a thumbnail strategy of a still `<video>` element (no autoplay, no poster) rather than `<img>`. Introducing a new picker abstraction for one section field would split the asset-upload story; reusing the row pattern keeps it unified. Per [ADR 0015](0015-editor-client-asset-pipeline.md) `postAssetUpload` is the editor's single asset-upload entry point and this row is a new consumer of that entry point, not a new pipeline.

6. **`trigger` is a two-control conditional: a `<select>` with values `none / exit-intent / delay / scroll`, and a `<number>` input that appears only when the select is `delay` or `scroll`. The number input's label and unit hint change with the trigger type: "Delay (ms)" for `delay`, "Scroll depth (%)" for `scroll`. Selecting `none` deletes `section.trigger`. Selecting `exit-intent` writes `{ type: 'exit-intent' }` with no `value`. Selecting `delay` or `scroll` requires a positive number — the value defaults to `1000` (ms) or `50` (%) respectively when the user first switches into that arm.**

   **Why:** the discriminated-union shape of `trigger` in the schema is real — `exit-intent` does not carry a value; the other two arms do, with different units. A flat select would force either lying about which arms need a value or post-hoc "is this required?" UI logic. The conditional control matches the type shape exactly: pick an arm, supply the arm's required data (or none, for `exit-intent`). The defaults exist because the moment the user picks `delay` or `scroll`, the section becomes a popup with whatever value sits in the field; defaulting to a sensible non-zero value avoids the "I picked delay and nothing happened because value was empty" trap. Per the global no-fallbacks rule the defaults are *explicit initial values*, not silent corrections — the user can immediately edit them and the field is visible.

7. **The "Motion & behaviour" group displays a small inline hint above the trigger control: "Setting a trigger turns this section into a popup at visitor-time." No modal, no warning dialog, no confirmation. The hint is plain `<small>` text.**

   **Why:** structural changes should be discoverable, not gated. A modal would be friction every time the Owner edits a popup section; no signal at all would let the "accidentally turned my hero into a popup" failure mode happen. A static one-line hint is the cheapest cue that splits the difference and keeps the group's visual weight low.

## Out of scope

- The published-page popup *runtime* — exit-intent listener, delay timer, scroll observer. Those live in the public renderer ([src/canvas/render.ts](../../src/canvas/render.ts)) and the schema field is already wired there per existing tests.
- The agent's ability to set these fields via `updateSection` tool calls. The AI Chat path was the workaround mentioned in the script (S5.P.1 fallback); this ADR ships the direct edit surface but does not change the chat tool.
- A spec-driven section-inspector dispatch. Explicitly rejected in decision 1; a future ADR would supersede if a second consumer ever appears.
- Renaming `backgroundVideoAssetId` to `backgroundVideo` in the schema. The `*AssetId` suffix is the established naming for asset references ([ADR 0004](0004-owner-asset.md)) and is consistent across `backgroundImageAssetId`, `posterAssetId`, etc. The inspector label can read "Background video" without renaming the field.
- A separate popup-section editing mode (modal preview, "edit the popup" flow). The section edits in place; the trigger field merely flags it for popup runtime treatment.
- Removing the role display from the film reel. Read-only surfacing in the reel stays per decision 3.

## Consequences

**Positive:**

- S5.P / S5.Q / S5.R record as on-screen actions instead of voiceover-only. Camera shows Maya cycling background effects and picking a delay trigger; the demo's "every variant axis cycled at least once on camera" outcome marker becomes literally true.
- Five schema fields that were edit-only via the AI Chat tool become discoverable in the inspector. Owners who don't know the agent vocabulary find them anyway.
- The conditional trigger control teaches the discriminated-union shape through the UI itself — picking `exit-intent` reveals no extra field, picking `delay` reveals a milliseconds input. The user doesn't have to read schema docs.
- Reuses three existing patterns (`selectInput` + `field`, the `backgroundImageAssetId` row, `postAssetUpload`) so the new code is mostly assembly, not invention.

**Negative:**

- The section inspector grows from ~60 lines to roughly 200, adding visual weight to the right panel. Mitigation: the three-group structure with clear sub-headings keeps each section short.
- `role` becomes editable from two surfaces' worth of *display* (reel shows it read-only, inspector edits it). Owners who try to edit it from the reel won't find a control. Mitigation: the reel hover already explains *what* the role is; the script doesn't show role-from-reel editing, so the divergence costs nothing in the demo and little in real use.
- The conditional trigger control is the only conditional field in the editor's inspector ecosystem. It adds a small precedent that future inspector fields might want to follow. Mitigation: the conditional is fully local to the trigger group; it doesn't leak into the spec interpreter, so the precedent stays opt-in.
- Defaults of `1000ms` and `50%` are author judgement calls. If they turn out to be wrong defaults in practice, the only cost is one constant edit. No data migration.

## Follow-ups

- Implement `renderSectionInspector` per the three-group structure in decision 2. Reuse `selectInput`, `field`, and the `backgroundImageAssetId` row shape verbatim.
- Update [docs/demo/act-1-script.md](../demo/act-1-script.md) S5.P.1 / S5.Q.1 / S5.R.1 to remove the "voiceover-only" caveats and describe the on-screen actions (open inspector, cycle bgEffect, pick a delay trigger, set the delay value).
- Update [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.6 (G6) to flag the gap as closed once the inspector lands, with a link to this ADR.
- Smoke test: open the section inspector, change role from `body` to `header`, confirm the action buttons re-render without Duplicate / Move up / Move down. Pick a `delay` trigger, confirm a milliseconds input appears with default `1000`. Upload an MP4 to `backgroundVideoAssetId`, confirm the thumbnail and clear button behave like the element-style background-image row.
- If a second consumer of section-level field declaration ever appears (e.g. AI tool surfacing the same control set in a chat panel), open a superseding ADR for a section-spec dispatch rather than evolving this one in place.
