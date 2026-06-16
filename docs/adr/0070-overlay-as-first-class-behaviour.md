# ADR 0070 - Overlay as first-class behaviour

**Status:** Accepted
**Date:** 2026-06-16
**Author:** Aayushman Singh

## Context

The Owner-facing gap is designer-grade modal and overlay behaviour. A template
author should be able to create a project detail modal, nav overlay, command
palette, lightbox, product-tour panel, or iframe drill-in and control its
trigger, backdrop, entrance, exit, close affordance, focus handling, body scroll
behaviour, and styling. The visitor should experience it as an intentional
surface, not a body section that abruptly jumps to the center of the viewport.

Today `CanvasSection.trigger` can make a section act as a popup through
`exit-intent`, `delay`, or `scroll`. The visitor runtime creates a hard-coded
backdrop and close button, mutates the section into fixed center positioning,
and has no element-click trigger. ADR 0054 documented iframe drill-in overlay as
a deferred contract. That contract is now part of the template-fidelity gap.

Native `<dialog>` provides a browser-owned modal primitive with `showModal()`:
<https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog>. Floating UI
is an MIT-positioning library for anchored floating surfaces:
<https://github.com/floating-ui/floating-ui>. Those tools can carry mechanics,
but the Open Canvas behaviour must be an Overlay.

## Decisions

1. **Overlay is a first-class site behaviour, not a section layout mutation.**

   **Why:** a body section and an overlay have different contracts. A body
   section participates in page order; an Overlay opens above the page from an
   Interaction Trigger, owns dismissal, and may trap focus or lock page scroll.
   Mutating one concept into the other hides those relations and prevents
   editor controls from matching visitor behaviour. This would be wrong if all
   overlays were just timed newsletter popups. The target behaviours include
   nav menus, project modals, lightboxes, and drill-ins.

2. **Overlay content references a section-shaped content surface without making
   that surface a page body section.**

   **Why:** template authors already compose rich content with Canvas Sections.
   Reusing that shape keeps layout power, Section Library reuse, and agent
   editing. Keeping the content out of page body order prevents a hidden modal
   from affecting the document's normal visual flow. This would be wrong if
   overlay content needed a totally different authoring model; it does not.

3. **Every Overlay has one Interaction Trigger and one explicit dismissal
   policy.**

   **Why:** hidden triggers create untestable behaviour. Element click, load,
   delay, scroll threshold, exit intent, and route state should all be expressed
   as Interaction Triggers. Dismissal must say whether Escape, backdrop click,
   close button, route change, or programmatic close is allowed. This would be
   wrong if all overlays shared the same close rules. They do not.

4. **Overlay focus, scroll, and modality are part of the stored contract.**

   **Why:** a modal that animates well but loses focus, scrolls the body behind
   it, or fails to return focus is not designer-grade. The stored Overlay must
   declare modal or non-modal mode, focus behaviour, return-focus target, body
   scroll policy, and initial focus target. Native `<dialog>` can implement the
   modal path; Floating UI can implement anchored non-modal positioning. This
   would be wrong if overlays were visual-only. They are interaction surfaces.

5. **Overlay entrance and exit are Motion Sequences.**

   **Why:** designer sites do not merely show and hide surfaces. They wipe,
   scale, slide, mask, stagger child content, and coordinate backdrop movement.
   Reusing Motion Sequence gives one choreography model for page content and
   overlays. This would be wrong if overlays needed bespoke animation fields.
   They do not.

6. **The editor needs an explicit overlay preview mode.**

   **Why:** ADR 0066 skipped popup hydration in the editor to avoid trapping the
   Owner. That protects editing, but it also means overlay behaviour cannot be
   trusted from the canvas. Overlay preview mode lets the Owner open, inspect,
   and close the surface intentionally while the normal editor chrome remains
   safe. This would be wrong if the editor were allowed to surprise-open
   visitor modals during ordinary selection. It is not.

7. **Invalid Overlay relations fail validation and publish; they do not render
   inert hidden markup.**

   **Why:** a missing trigger target, missing content surface, conflicting
   dismissal rule, or unresolved focus target makes the Overlay broken. Rendering
   hidden markup would produce a "nothing happened" visitor bug. This would be
   wrong if partial overlay output were useful. It is not.

## Out of scope

- Designing the overlay inspector UI.
- Implementing all overlay variants in this ADR.
- Defining a lightbox media gallery data model.
- Route transitions.
- Load Experience.
- Rich Motion Assets.
- Using arbitrary Owner-authored JavaScript for overlay behaviour.

## Consequences

- `CanvasSection.trigger` should stop accumulating new overlay concerns. Existing
  popup triggers need a migration path into Overlay.
- Public rendering needs an overlay layer separate from page body sections.
- The Runtime Hydrator must attach overlay triggers, dismissal handlers, focus
  handling, scroll handling, and Motion Sequence execution from one source.
- The editor needs a controlled preview affordance so overlay behaviour is
  inspectable without hijacking the editing session.
- Accessibility testing becomes part of overlay acceptance, not a later polish
  pass.

## Follow-ups

- Define the Overlay TypeScript shape and migration from existing popup
  section triggers.
- Add element-click Interaction Trigger support.
- Define overlay chrome Component Style fields after ADR 0067 lands.
- Add overlay preview mode to the editor.
- Add smokes for focus trap, return focus, Escape dismissal, backdrop dismissal,
  body scroll lock, and invalid relation rejection.
