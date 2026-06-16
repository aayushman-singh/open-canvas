# ADR 0078 - Flow Container is a Compound Element inside Canvas Sections

**Status:** Proposed
**Date:** 2026-06-16
**Author:** Aayushman Singh

## Context

Open Canvas is canvas-first: an Editable Site contains Canvas Pages, each
Canvas Page contains Canvas Sections, and each Canvas Section contains
Positioned Elements. That model is strong for direct manipulation and freeform
composition, but it becomes painful for structured responsive regions such as
feature grids, pricing cards, logo rails, testimonial rows, navigation groups,
and mixed media/text stacks. Those regions need order, wrapping, gaps,
alignment, spans, and intrinsic sizing more than they need per-child x/y
placement.

The competitive gap is not "add a second page model." Figma-like freeform
editing still matters. The user-perceived done state is: an Owner drops one
object into a Canvas Section, resizes that object like any other canvas
element, then edits children inside it using flow rules so the object behaves
like a structured mini-section inside the larger canvas.

The codebase already has compound element precedent:

- `TabsElement` owns `tabs[].elements: CanvasElement[]`, with each panel using
  panel-local coordinates.
- `CollectionElement.customTemplate` owns a `CanvasElement[]` subtree for a
  per-entry template.
- `CarouselElement`, `AccordionElement`, and `FormElement` own typed child
  lists rather than freeform canvas children.
- `ContainerElement` is currently a Surface primitive: a card/panel/frame/link
  shell. It is not a child-owning layout parent.

The decision is where flow layout belongs without splitting the canvas model or
overloading existing surface primitives.

## Decisions

1. **Flow layout enters through a Flow Container, not a Flow Section.**

   **Why:** the Owner wants one structured region inside the larger canvas, not
   a second section system beside Canvas Section. Keeping Canvas Section as the
   only section model preserves section ordering, section library reuse,
   header/footer pinning, publish rendering, and film-reel mental model. This
   would be wrong if Open Canvas were moving to a document-flow page builder.
   It is not.

2. **Flow Container is a new element type, not a mode on `ContainerElement`.**

   **Why:** `ContainerElement` already means Surface primitive: visual chrome,
   link wrapper, tint, and card-like presentation. Making it sometimes a
   layout parent would create one node with two unrelated behaviours. A new
   registry entry keeps the name honest: Flow Container owns flow layout;
   Container remains surface. This would be wrong if Container already owned
   children. It does not.

3. **Flow Container is a Compound Element.**

   **Why:** the existing model already permits content elements that own child
   structures. Tabs and Collection prove nested authoring surfaces; Carousel,
   Accordion, and Form prove typed compound components. Flow Container belongs
   to the nested-authoring family because its value is arranging arbitrary
   visible primitives, not collecting fixed fields like form inputs or carousel
   slides. This would be wrong if every flow use case had one fixed schema.
   Feature grids, card stacks, and mixed content rows do not.

4. **A Flow Container remains a Positioned Element inside its Canvas Section.**

   **Why:** the canvas still controls where the structured region sits in the
   section and how large it is. The Flow Container keeps normal canvas-level
   position, size, stacking, responsive visibility, styling, and motion. Its
   children do not claim section-level x/y coordinates. This would be wrong if
   child overlap and freeform placement inside the region were the primary
   need. In that case, the Owner should use ordinary canvas positioning or a
   compound element whose contract is local coordinates, such as Tabs.

5. **Flow Container children are Flow Items, not Positioned Elements.**

   **Why:** a child in flow layout is placed by order, span, alignment, and the
   parent layout rules. Treating those children as ordinary Positioned Elements
   would preserve x/y fields that no longer mean what their name says, and
   future tooling would need to guess which coordinate system owns them. Flow
   Item names the different relation explicitly. This would be wrong if child
   x/y placement remained authoritative. It does not in flow layout.

6. **A Flow Item owns one Content Element plus flow placement intent.**

   **Why:** Owners still need familiar primitives: text, media, action, shape,
   surface, form, embed, chart, and other supported content. What changes is
   the placement relation between child and parent. Keeping the Content Element
   as the visible payload lets the element registry keep owning rendering and
   style, while the Flow Item owns layout placement. This would be wrong if
   Flow Container needed bespoke child types only. The competitive need is to
   compose existing primitives in a more responsive layout relation.

7. **Existing compound components keep their own element contracts.**

   **Why:** Tabs owns visibility between panels, Carousel owns slide movement,
   Accordion owns disclosure state, Form owns submission semantics, and
   Collection owns repeated content binding. Rebuilding them all as Flow
   Containers would erase useful behaviour into one overbroad abstraction. They
   may use Flow Container concepts later only where flow layout is actually the
   child placement relation. This would be wrong if all compound components
   were only layout wrappers. They are not.

8. **Invalid flow configuration fails validation or render explicitly.**

   **Why:** a malformed layout mode, unsupported child type, impossible span,
   missing child payload, or cyclic child structure must not silently fall back
   to absolute layout or empty output. The failure must name the Flow Container,
   Flow Item, field, and phase. This would be wrong if best-effort layout were
   acceptable. It is not.

## Out of scope

- Replacing Canvas Section.
- Introducing a document-flow page model.
- Migrating Tabs, Carousel, Accordion, Form, Collection, or Container into Flow
  Container.
- Exact Flow Layout grammar such as stack, row, grid, wrap, gap, padding,
  alignment, spans, and responsive overrides.
- Arbitrary CSS flexbox/grid syntax or owner-authored CSS.
- Exact editor UI for entering/exiting Flow Container child editing.
- Custom component platform or third-party extension model.
- Implementation changes to schema, renderer, validator, Yjs projection,
  inspector, agent tools, or public styles.

## Consequences

- Open Canvas keeps one section model while gaining structured responsive
  regions inside the canvas.
- The domain gains a new abstraction: Compound Element.
- `ContainerElement` stays a Surface primitive; future implementation should
  not overload it into a layout parent.
- Flow Container will require a new element registry branch, validator path,
  renderer path, Yjs projection path, inspector surface, selection semantics,
  and agent patch surface.
- Flow Item introduces a new child relation distinct from Positioned Element.
  Implementation may need to separate "content payload" from "section-positioned
  element" more cleanly than the current `BaseElement` shape does.
- Nested editing becomes more important. The editor must make it clear whether
  the Owner is selecting the Flow Container or one of its Flow Items.
- Agent-generated layouts gain a safer target for responsive feature grids,
  pricing tables, card groups, footer columns, logo rails, and mixed content
  stacks.

## Follow-ups

- ADR 0079 defines the Flow Layout grammar and required v1 fields.
- ADR 0080 defines how Flow Items host Content Elements.
- Define the editor selection and editing mode for Flow Container children.
- ADR 0079 defines inner responsive layout overrides for Flow Container and
  Flow Items.
- Decide whether Tabs panels and Collection custom templates can contain Flow
  Containers without special authoring modes.
- Define agent tools for creating, reordering, and patching Flow Items.
