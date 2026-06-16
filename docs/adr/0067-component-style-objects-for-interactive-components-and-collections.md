# ADR 0067 - Component Style objects for interactive components and Collections

**Status:** Proposed
**Date:** 2026-06-15
**Author:** Aayushman Singh

## Context

ADR 0066 shipped the Variant layer for form, carousel, accordion, and tabs. It deliberately left richer per-component style objects as a follow-up. The Owner-facing gap is now concrete: an Owner can choose a designed Variant, but cannot tune the meaningful parts of accordion items, tab buttons, carousel controls, or collection cards without dropping to raw `pinnedStyle`.

The user-visible "done" state is: the Owner selects an element, adjusts named style controls such as "active tab color" or "collection card radius", sees the canvas update immediately, publishes, and sees the same result. Clearing a knob returns that part to the chosen Variant, then to the Style Kit. Structural controls such as carousel mode, collection display, tab bar height, and accordion multiple-open behavior are not part of style.

## Decisions

1. **Each styled element keeps a per-element Component Style field, rather than a generic persisted `componentStyle` field.**

   The stored fields are `formStyle`, `accordionStyle`, `carouselStyle`, `tabsStyle`, and `collectionStyle`. They share the domain concept **Component Style**, but keep each element's anatomy local. A generic stored key would hide five different shapes behind one name while validation, rendering, Yjs projection, and agent parsing still branch by element type.

   **Why:** the Owner needs one mental model, not one storage key. This would be wrong if all styled elements shared the same part names; they do not.

2. **Component Style objects are sparse Owner choices, never resolved snapshots of Variant or Style Kit values.**

   Missing fields mean "inherit from the selected Variant; if the Variant does not set a value, inherit from the Style Kit." Clearing one knob deletes that field. Clearing the last field deletes the whole per-element style object. Resetting style deletes the whole per-element style object and does not change `variant`.

   **Why:** storing resolved values would freeze the current Variant or Style Kit into instance data, so later improvements would not reach existing sites. This would be wrong if Owners needed style objects to preserve the exact old visual output across Variant/kit evolution; the product intent here is explicit per-instance tweaks over a living base look.

3. **Component Style owns modeled component variables; `pinnedStyle` stays an escape hatch for unmodeled visual choices.**

   If a Component Style field maps to `--opencanvas-tabs-active-bg`, `pinnedStyle["--opencanvas-tabs-active-bg"]` must not coexist with it. The editor write path removes modeled pinned keys when setting Component Style fields, and the validator rejects any persisted conflict.

   **Why:** dual ownership makes inspector controls appear broken behind hidden raw CSS. The system should either know who owns a value or fail loudly. This would be wrong only if raw custom-property edits were meant to override modeled controls; they are not.

   Existing persisted snapshots are not migrated by this ADR. If old data already carries a modeled custom property in `pinnedStyle`, it continues to render until that element is validated through a write path; then the validator reports the exact element/key conflict. Repository fixtures currently do not carry these modeled component-variable keys in `pinnedStyle`, so a migration would add machinery without a known payload.

4. **Component Style variables emit on the outer `.opencanvas-element` wrapper, after `pinnedStyle`, so malformed legacy conflicts are deterministic.**

   ADR 0066 moved Variant variables to the same wrapper so `pinnedStyle` could beat Variant arms. Component Style is the next layer above Variant. The runtime cascade is: Style Kit token < Variant stylesheet < unmodeled Pinned Style < Component Style modeled value. Validator rejection remains the real guard against dual ownership; render order only makes old malformed data predictable.

   **Why:** putting variables on the inner component root reintroduces proximity fights between wrapper and child. This would be wrong if Component Style were not meant to beat raw duplicates, but the ownership rule in decision 3 says it is.

5. **The inspector uses one generic Component Style panel driven by per-element field metadata.**

   Per-element modules define their part fields; one editor renderer owns color rows, numeric rows, select rows, clear controls, reset behavior, object deletion when empty, rebuild, and save scheduling.

   **Why:** six separate style mounts would duplicate the same mechanics and drift. This would be wrong if each element required unique editing behavior rather than unique field definitions.

6. **The Agent tool can set Component Style fields through the same sparse objects and validation rules.**

   Agent patches use the typed style object for "make these tabs more compact" or "darken the collection cards." The Agent must not bypass the typed surface with modeled `pinnedStyle` keys.

   **Why:** otherwise the agent can only under-deliver or write raw CSS that the inspector no longer owns. This would be wrong if visual fine-tuning were intentionally inspector-only; it is not.

7. **Component Style fields use typed values wherever the meaning is typed.**

   Lengths such as gap, radius, padding, font size, arrow size, dot size, and border width are non-negative finite numbers in pixels. Weights and families use enums. Colors and shadows remain injection-safe strings because their CSS value spaces are broader than a useful enum. Unknown keys are rejected by the validator.

   **Why:** Form already proves this shape. Free-form length strings would reintroduce raw CSS with nicer spelling. This would be wrong if Owners needed arbitrary CSS units for these controls in this wave; they do not.

8. **The initial field catalog is fixed for this ADR.**

   `formStyle` keeps its existing fields and adds visible gaps only: field surface background, field surface border color, field surface border width, field surface radius, field surface shadow, field surface padding X/Y, spotlight glow color, spotlight glow size, and spotlight glow opacity. Field-surface controls are shown only when the selected Variant has a field surface; spotlight controls are shown only for the spotlight Variant. Stored sparse values may persist across Variant switches.

   `accordionStyle`: gap, item background, item border color, item border width, item radius, item shadow, header background, header color, header padding X/Y, body color, body font size, body line height, and body padding X/Y.

   `tabsStyle`: bar gap, bar background, bar border color, bar border width, bar radius, tab padding X/Y, tab radius, tab color, tab font weight, active tab background, active tab color, active tab font weight, active indicator color, panel background, panel border color, panel border width, and panel radius.

   `carouselStyle`: caption background, caption color, caption font size, caption font weight, caption line height, caption padding X/Y, arrow background, arrow color, arrow size, dot background, active dot background, and dot size.

   `collectionStyle`: grid gap, card background, card border color, card border width, card radius, card shadow, card padding, card image radius, image-only gap, and image-only radius.

   **Why:** fixed fields keep the change testable and reject "while here" sprawl. This would be wrong if implementation discovery showed a named field cannot map to an owner-visible part; then that field must be removed by a follow-up decision before implementation.

9. **Collection card/image styling ships only with a real published render target.**

   `renderCollection` must render materialized `entries` inside the Collection frame instead of emitting an empty frame. Built-in `card` and `image-only` display modes expose mode-specific entry/card/image chrome that reads Collection Style variables from the Collection host; materialization must not bake style fields into cloned child elements. `custom` display remains owned by the Owner's custom template; card chrome controls are hidden there with an explicit note.

   **Why:** styling non-rendered card chrome is fake work. This would be wrong if Collection entries were rendered elsewhere before publish; the current render path does not do that.

10. **Editor preview must use the same component DOM/class contract as published output for styled parts.**

   The editor may wrap components in editor-only selection chrome, but the inner component class names and attributes must match the public renderer for form, accordion, carousel, tabs, and collection. Component Style preview must be immediate and must share the same CSS variable contract as publish.

   **Why:** ADR 0066 already created static Variant preview debt because editor classes diverged from public classes. Adding Component Style on top of a second CSS mirror would deepen that drift. This would be wrong if the editor were allowed to be an approximate preview; Open Canvas is a live site builder, so it is not.

## Out of scope

- User-authored reusable Variants.
- Style Kit defaults for Component Style fields.
- A generic persisted `componentStyle` field.
- Structural controls: collection `display`, carousel `mode`, carousel arrow position/style, tab bar height, accordion multiple-open behavior.
- Collection column count; if needed, it is a structural layout field, not `collectionStyle`.
- Component Style for unrelated elements such as action, shape, container, table, nav, chart, code, text, media, and embed.
- Collection title, excerpt, and CTA styling; built-in card mode uses generated Text and Action elements, and those child element types own their own text/action styling.
- Arbitrary CSS unit support for numeric controls.

## Consequences

- Schema, validator, renderer, Yjs projection, editor inspector, editor body builders, public/editor CSS, and Agent tool specs all gain per-element style handling.
- The validator becomes the conflict boundary between modeled Component Style fields and raw `pinnedStyle` keys.
- Existing Form style behavior stays compatible, but Form gains a few additional modeled fields for Variant-only visible parts.
- Collection rendering must be corrected before Collection Style can honestly ship.
- Editor/public DOM parity becomes part of the acceptance bar, not a follow-up.

## Follow-ups

- If a second wave wants more fields, it should add them by named owner-visible part, not by exposing every CSS variable.
- If Owners need arbitrary units or saved reusable style recipes, those are separate ADRs.
