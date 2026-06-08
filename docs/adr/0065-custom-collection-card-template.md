# ADR 0065: Custom Collection card template lives on the element, edited in-place via global editor state

**Status:** Accepted
**Date:** 2026-06-05
**Decision driver:** Aayushman Singh (Owner)
**Implements:** [ADR 0063](0063-collection-element-binds-at-element-level-and-ships-defaults.md) follow-up F1

## Context

[ADR 0063](0063-collection-element-binds-at-element-level-and-ships-defaults.md) shipped `CollectionElement.display = 'image-only' | 'card'` (decision 4) and explicitly deferred a third value `'custom'`. Today every Collection in `'card'` mode renders a grid of `DEFAULT_CARD_TEMPLATE` clones from [src/canvas/elements/collection-defaults.ts](../../src/canvas/elements/collection-defaults.ts) — a Container with a known schema (hero image + title + excerpt + "Read more" button), no way to deviate.

Power users want richer cards: magazine-style overlapping text on a hero image, oversized serif titles, brand-specific motion, asymmetric type hierarchies, polaroid borders, side-by-side image+text. The default card cannot express any of those. The Owner's lived "done" for this gap: *the Collection's card looks the way I want it to look, and I can change it without editing TypeScript.*

The grilling session (2026-06-05) settled the six load-bearing forks:

- **Editing surface.** In-place toggle on the canvas, not a separate route nor a floating panel. Lowest navigation cost, mirrors how Carousel slide editing already works.
- **Template storage.** A new dedicated field on `CollectionElement`, not a separate page nor a re-purposed `entries[][]` slot. Travels with the element through Yjs round-trips.
- **Initial seed.** Pre-seeded with `DEFAULT_CARD_TEMPLATE` on first switch to `'custom'`. No empty canvas, no picker dialog. (The picker UX + curated variant library land in a separate follow-up.)
- **Iteration unit.** One template, N clones in a grid — the same model `'card'` mode already uses. Asymmetry happens *inside* a card, not across cards. (Asymmetric grids across cards are not in this ADR's scope.)
- **Click-bubble signal.** Global editor state on `EditorContext`, not a flag persisted on the element. UI mode stays out of the saved schema.
- **Mode-switch policy.** Silent keep — switching display back to `'card'` does *not* delete the custom template. Switching back to `'custom'` re-uses the prior edits.

ADR 0063 decision 6 said clicks inside a rendered card bubble up to select the parent Collection (so the Owner can't author what the materializer authors). That rule must invert in `'custom'` template-edit mode: while editing the template, individual template elements ARE authorable. This ADR pins how the inversion is signaled.

## Decision

1. **`CollectionElement.display` union widens to `'image-only' | 'card' | 'custom'`.**
   Materializer dispatch becomes three-way ([src/canvas/elements/collection-materializer.ts](../../src/canvas/elements/collection-materializer.ts)). The `'custom'` arm reads `customTemplate` (decision 2) instead of `DEFAULT_CARD_TEMPLATE`. All other behaviour (source/folder filter, sort, manual reorder, placeholder rendering, click-bubble rule) is identical to the `'card'` arm.

   **Why.** The `'custom'` mode is a strict superset of `'card'` semantically — the only behavioural change is *which* template the materializer clones per entry. A new top-level mode is the right shape because the source-of-template differs; encoding `'custom'` as a flag on `'card'` mode would mean two ways to express the same intent and a non-canonical `display === 'card' && customTemplate !== undefined` ambiguity.

2. **`CollectionElement` gains `customTemplate?: CanvasElement[]`.**
   - Type: array of canvas elements, validated like any other element subtree. May contain Container/Image/Text/Button/Shape/Embed — the same primitives available anywhere else on the canvas.
   - Substitution: identical to the default-card path — `{{title}}`, `{{excerpt}}`, `{{slug}}`, `{{ogImageAssetId}}`, `{{author}}`, `{{publishedDate}}`, `{{category}}`, `{{tag}}`, `{{body}}` ([src/editor-client/page-inspector.ts:65](../../src/editor-client/page-inspector.ts#L65)).
   - Absent when `display` has never been `'custom'` for this Collection. Once set, persists across mode switches (decision 5).

   **Why.** A dedicated field is the simplest shape: Yjs codec encodes it like any element subtree, validator recurses into it like any element subtree, asset-walker recurses for unfilled asset detection, renderer never reads it directly (materializer clones it into `entries[][]` which the renderer already iterates). Reusing `entries[][]` for dual purpose (output in card-mode, input in custom-mode) was considered and rejected: it would force the materializer to branch on "is this an input or an output," and any tool that walks `entries` (asset rewrite, prototype-pollution checks, render) would need the same branch.

3. **First switch to `'custom'` auto-seeds `customTemplate` with a deep clone of `DEFAULT_CARD_TEMPLATE`.**
   The switch is atomic: setting `display = 'custom'` *and* setting `customTemplate = structuredClone(DEFAULT_CARD_TEMPLATE)` happen in the same write through the editor's persistence path. The Owner is immediately moved into template-edit mode (decision 6) so the seeded card is editable from the next click.

   On second-or-later switches to `'custom'` (after the Owner has previously toggled away and back per decision 5), the existing `customTemplate` is reused — no re-seed, no auto-enter into edit mode. The Owner clicks "Edit template" explicitly.

   **Why.** First-time discoverability requires the Owner to *see* a customisable card the instant they pick `'custom'` from the display dropdown. An empty canvas would look broken; a picker dialog adds friction that ADR 0063 D5 (auto-placeholders) deliberately avoided. The auto-enter-on-first-switch is also a one-shot tutorial — by the time the Owner exits, they have a working customised card and know the model.

   **Failure path.** If `structuredClone` fails (memory exhaustion on an absurd default), throw — do not silently fall back to an empty array. v1 ships the smallest possible default, so the failure is theoretical.

4. **`customTemplate` survives display-mode changes — silent keep.**
   Setting `display = 'card'` or `display = 'image-only'` does NOT clear `customTemplate`. The field persists in Yjs and is re-read the next time `display === 'custom'`. An inspector "Reset template" button (decision 9) is the only way for the Owner to discard, and it requires a confirm dialog.

   **Why.** The Owner experimenting with display modes should not lose their custom-card edits. The Yjs payload cost is one optional array per Collection — negligible compared to the value of letting the Owner toggle freely.

5. **In-place toggle is the editing surface.**
   "Edit template" button on the Collection inspector (visible only when `display === 'custom'`) → canvas viewport flips:
   - Rendered grid (N materialized cards) is replaced by a single editable instance of the template, centered in the viewport.
   - A subtle banner above the template reads `"Editing template — substitutions apply at publish"`.
   - A "Done" button below the template exits edit mode.
   - Pressing `Esc` exits.
   - Clicking on any canvas region *outside* the template (the dimmed page surround) exits.

   Camera pans the viewport so the template is centered when entering edit mode; reverses on exit. No new route, no new panel, no new modal.

   **Why.** Carousel slide editing already uses an in-place toggle ([src/canvas/elements/carousel.ts](../../src/canvas/elements/carousel.ts) — slide-list authoring vs preview rendering). The Owner already learned this affordance once. A detail-view route would jump the Owner out of the Collection's page context and lose visual anchoring; a floating panel would force two competing viewports.

6. **Edit-template mode is global editor state, not element state.**
   `EditorContext` gains:
   ```ts
   editingCollectionTemplate: { collectionId: string } | null;
   ```
   Set to `{ collectionId }` when "Edit template" is clicked. Cleared (set to `null`) on Done / Esc / click-outside / switching to a different page.

   This field is **not** persisted in Yjs and **not** part of `EditableSite`. It lives purely in the editor's runtime state. Loading a site never restores edit-mode — the Owner always starts in the rendered-grid view.

   **Why.** UI mode is the editor's business, not the document's. Persisting it would mean (a) one collaborator entering edit mode visibly moves the other collaborator's viewport, (b) reloading the editor drops the Owner into an edit-mode they didn't choose on this session, (c) every consumer of `CollectionElement` (renderer, asset-walker, validator) would have to know about UI state it has no use for. The global-state approach mirrors how selection itself lives on `EditorContext`, not on elements.

   **Failure path.** If `editingCollectionTemplate.collectionId` references an element that no longer exists (e.g. concurrent collaborator deleted the Collection), the next render-pass clears the field. The editor briefly shows the empty page; no crash, no zombie viewport.

7. **Click-bubble rule (ADR 0063 D6) inverts inside the active template.**
   When `editingCollectionTemplate?.collectionId === <some Collection's id>`, clicks on that Collection's template children select the clicked child element directly — the same behaviour as any normal element on the canvas.

   When `editingCollectionTemplate === null`, ADR 0063 D6 applies: clicks bubble to the parent Collection.

   The walk-up code in [src/editor-client/selection.ts](../../src/editor-client/selection.ts) branches on this one field. Mechanically: it short-circuits the "walk up to find `data-element-type='collection'`" loop when the current `editingCollectionTemplate` matches the ancestor it would have selected.

   **Why.** The whole point of edit-template mode is to let the Owner author the template. Selection has to follow the affordance.

8. **Materializer `'custom'` arm.**
   Identical to the `'card'` arm except for the source of the cloned template:
   - `'card'`: clones `DEFAULT_CARD_TEMPLATE` per entry, substitutes placeholders.
   - `'custom'`: clones `el.customTemplate` per entry, substitutes the same placeholders.
   - `'image-only'`: emits `<a><img></a>` per entry (unchanged from ADR 0063).
   The clone-and-substitute helper is extracted into one function the two card-mode arms share.

   **Why.** Behaviourally and code-wise the two modes are isomorphic — the substitution logic, the per-entry container linkHref, the sort + folder filter, the manualOrder, the warnings on zero matches — all identical. The arm is a one-line dispatch into a shared helper.

   **Failure path.** `customTemplate` present but empty (`length === 0`) → materializer emits zero cards and the publish report includes warning `"Collection element <id> display='custom' but customTemplate has zero elements."` Editor inspector shows the warning inline. Same loud-fail discipline as zero-entries (ADR 0063 D1 failure path).

9. **Inspector controls when `display === 'custom'`.**
   Existing fields (source slug, folder, sort, manage-entries link, display dropdown) unchanged. Added:
   - **"Edit template" button** — visible when `editingCollectionTemplate?.collectionId !== this.id`. Click → enters edit-template mode (sets the editor state, pans viewport).
   - **"Done editing template" button** — visible when `editingCollectionTemplate?.collectionId === this.id`. Click → exits.
   - **"Reset template" button** — always visible when `display === 'custom'`. Click → confirm dialog: `"Replace your custom template with the default card?"` Yes → `customTemplate = structuredClone(DEFAULT_CARD_TEMPLATE)`. No → cancel. Confirm dialog matches the existing pattern used elsewhere in the editor.

   **Why.** Three buttons map to three intents: enter, exit, reset. No persistent variant dropdown (deferred per follow-up F1-variant-picker), no implicit destructive paths.

10. **Source/sort/display changes during template edit are independent.**
    The Owner can switch the source slug, folder, or sort while editing the template; the binding updates immediately. The template stays — only the rendered grid (visible once the Owner exits edit-template mode) reflects the new data.

    Switching `display` away from `'custom'` while inside edit mode → editor automatically exits edit-template mode (clears `editingCollectionTemplate`), then applies the display change. Inspector reflects the new state.

    **Why.** The Owner's intent in toggling display mid-edit is unambiguous: leave the template alone, change the rendering. The auto-exit on display-away is the only edge that would otherwise need handling; doing it implicitly avoids a confirm dialog for what is clearly meant.

## Shared types (contract for parallel implementation)

```ts
// src/canvas/elements/collection.ts — additive
export interface CollectionElement extends CanvasElementBase {
  type: 'collection';
  collectionSlug: string | undefined;
  folder?: string;
  sort: 'date-desc' | 'date-asc' | 'manual';
  manualOrder?: string[];
  display: 'image-only' | 'card' | 'custom';   // widened
  customTemplate?: CanvasElement[];             // NEW
  entries?: CanvasElement[][];                  // unchanged — materializer output
}

// src/editor-client/editor-context.ts — additive
export interface EditorContext {
  // ... existing fields ...
  editingCollectionTemplate: { collectionId: string } | null;
}

// src/canvas/elements/collection-defaults.ts — new export
export function seedCustomTemplate(): CanvasElement[] {
  return structuredClone(DEFAULT_CARD_TEMPLATE);
}
```

```ts
// src/canvas/elements/collection-materializer.ts — additive shape
function materializeCard(
  el: CollectionElement,
  entries: MaterializerEntry[],
  warnings: string[],
): CanvasElement[][] {
  const template =
    el.display === 'custom'
      ? el.customTemplate
      : DEFAULT_CARD_TEMPLATE_ARRAY;
  if (!template || template.length === 0) {
    warnings.push(/* per decision 8 failure path */);
    return [];
  }
  // existing per-entry clone + substitute logic
}
```

```ts
// src/editor-client/selection.ts — branch addition
function shouldBubbleToCollection(
  ancestorCollection: CollectionElement,
  ctx: EditorContext,
): boolean {
  // ADR 0063 D6: yes, by default
  // ADR 0065 D7: no, when actively editing this Collection's template
  return ctx.editingCollectionTemplate?.collectionId !== ancestorCollection.id;
}
```

## Out of scope

- **Layout variants library.** v1 ships with `DEFAULT_CARD_TEMPLATE` as the only seed. Curated alternative layouts (image-overlay, magazine, side-by-side, polaroid, minimal-text) come in a separate follow-up. The seed function is a single chokepoint so adding variants later is additive.

- **Variant picker UX.** No "Choose a starting layout" dialog in v1. The seed is implicit on first switch. The picker lands alongside the variants library.

- **Asymmetric layouts across cards.** All N cards remain the same shape — the template is per-card, not per-grid. A future ADR could introduce a separate "Collection layout" element that wraps multiple Collections with mixed display modes; this ADR does not enable that.

- **Multi-collaborator template-edit signaling.** If two collaborators are editing the same Collection's template, Yjs merges their concurrent edits per [ADR 0045](0045-siteroom-broadcast-precedes-persistence.md). No "Alice is editing this template" presence indicator in v1.

- **Separate undo stack for template edits.** Template edits go on the same undo stack as everything else on the canvas. No "scoped undo while in edit mode" in v1.

- **Per-source template binding.** `customTemplate` is per-Collection, not per-`collectionSlug`. Two Collections bound to the same slug each have their own template.

- **Validator enforcement of substitution presence.** A `customTemplate` with zero `{{...}}` placeholders is allowed — the Owner may genuinely want N identical static cards. Inspector should *warn* (one-line note) but not block.

## Consequences

- The Collection inspector grows three buttons (Edit template / Done editing template / Reset template). The first two are mutually exclusive states of the same affordance.
- `EditorContext` gains a non-persisted runtime field. UI state precedent — not new ground.
- `CollectionElement.customTemplate` adds an optional array that's Yjs-encoded the same way any element subtree is. Asset-walker, validator, prototype-pollution checks, and snapshot-replay all recurse into it without new dispatch.
- The materializer's `'card'` and `'custom'` arms share the same substitution helper. One change, two consumers — less drift.
- ADR 0063 D6 (click bubbles to Collection) gains an explicit exception. Documented in both ADRs; the exception is narrow and tied to a single editor-context field.
- The Owner can lose their custom template only by explicitly clicking "Reset template" and confirming. No display-mode change is destructive.
- Yjs payload grows by one optional array per Collection. Worst-case (~20 elements per template, 8 sites) is sub-kilobyte. Negligible.

## Failure modes (loud, per CLAUDE.md)

- `customTemplate` present and `length === 0` → materializer emits zero cards + publish warning + inspector inline message. No fallback to `DEFAULT_CARD_TEMPLATE`; if the Owner emptied the template, they get what they asked for (visually broken Collection) and a loud signal explaining why.
- `editingCollectionTemplate.collectionId` references a deleted Collection (concurrent collaborator removed it) → next render-pass clears the field. Editor renders the empty page; no crash.
- Switching `display` away from `'custom'` while in template-edit mode → editor auto-exits edit mode silently. This is the one place the ADR deliberately resolves a state conflict without a dialog, because the Owner's intent is unambiguous.
- `structuredClone(DEFAULT_CARD_TEMPLATE)` fails (theoretical: memory) → throws, surfaces to the Owner via the editor's existing error-toast path. No silent empty-template fallback.

## Follow-ups

### F1-variant-picker — curated layout variants library + picker UX

**Decision space.** v1 seeds `customTemplate` with `DEFAULT_CARD_TEMPLATE`. A future ADR ships a curated set of alternative starting layouts (image-overlay, side-by-side, polaroid, magazine, minimal-text) as named exports from `collection-defaults.ts`. The "Reset template" button becomes a starter-picker modal that shows variant thumbnails; the first switch to `'custom'` also opens the picker instead of auto-seeding.

**Touches.** New constants in `collection-defaults.ts`, picker modal in editor-client, inspector wiring to open the picker on first switch, reset-button rewired to open the picker.

**Why deferred.** The Owner wants to design the variants themselves (a curation pass distinct from the materializer plumbing). Bolting variant designs into this ADR would couple the architectural decision (in-place toggle, customTemplate field, global edit state) to a separate aesthetic decision (what the variants look like). Better separated.

### F1-multi-collab-presence — "Alice is editing this template" indicator

**Decision space.** If two collaborators are concurrently in `editingCollectionTemplate` for the same Collection, the Yjs merge handles their template edits correctly per ADR 0045, but neither sees the other's presence. Add a presence indicator that surfaces this via the existing in-app presence channel (ADR 0043 SSE infrastructure or whatever the current presence path is).

**Touches.** Editor-client presence dispatch, inspector chrome to render the indicator.

**Why deferred.** Concurrent template editing is a rare case. Ship the feature, observe whether the presence gap actually causes confusion, decide.

### F1-substitution-warning — inspector warning when template has zero placeholders

**Decision space.** A `customTemplate` with no `{{...}}` substitutions renders N identical static cards. The Owner may want that or it may be a mistake. Inspector should surface a one-line warning ("This template has no per-entry substitutions — all cards will show the same content. Add `{{title}}` or `{{excerpt}}` to the template.") when this is detected.

**Touches.** Element inspector for Collection. One predicate (`countPlaceholdersInTemplate`), one line of UI.

**Why deferred.** Trivial to add; not load-bearing. Ships when the inspector layout sees its next refactor pass.
