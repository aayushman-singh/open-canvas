# ADR 0080 - Flow Items own placement; Content Elements own behaviour

**Status:** Proposed
**Date:** 2026-06-16
**Author:** Aayushman Singh

## Context

ADR 0078 introduces Flow Container as a Compound Element inside Canvas
Sections. ADR 0079 defines the first Flow Layout grammar. The remaining fork
is what a Flow Item may contain.

The first instinct was to restrict v1 to "leaf primitives" and postpone
stateful compound elements such as Tabs, Carousel, Accordion, Form, Collection,
and nested Flow Container. That restriction is too conservative. The existing
codebase already has nested authoring precedent and visitor rendering for
compound components:

- Tabs render nested `CanvasElement[]` inside tab panels.
- Collection custom templates render nested `CanvasElement[]` in an in-place
  edit surface.
- Carousel, Accordion, Form, Nav, and similar elements own their own visitor
  behaviour inside one element box.
- Editor lookup already tracks nested parents with explicit kinds such as
  `tab-panel`, `collection-entry`, and `collection-custom-template`.

The real mismatch is narrower: current `CanvasElement` rendering always means
"wrap this element in a positioned element box." Flow Items deliberately do
not mean that. A child inside Flow Layout is placed by Flow Item order, span,
alignment, and responsive overrides, not by section-local `x/y/z`.

The user-perceived done state is that an Owner can put a useful component in a
Flow Item, including stateful components, and the component behaves normally
inside the flow cell. The Owner edits flow placement through Flow Item controls
and edits the component's content/behaviour through the component's own
controls.

## Decisions

1. **Flow Item owns placement.**

   **Why:** a Flow Item is the relation from Flow Layout to one visible child.
   Its placement comes from array order, responsive order, span, hidden state,
   and alignment. It must not also inherit section-position fields. This would
   be wrong if Flow Items were just smaller Positioned Elements. ADR 0078 says
   they are not.

2. **Content Element owns visible behaviour and styling inside a Flow Item.**

   **Why:** the Owner should not learn separate "flow text," "flow media," and
   "flow carousel" concepts. A Flow Item hosts the same content concepts the
   editor already exposes; only the placement relation changes. This would be
   wrong if Flow Layout required bespoke child behaviours. It does not.

3. **Flow Item content is not rendered with the section-positioned wrapper.**

   **Why:** the current element wrapper reads `box.x`, `box.y`, `box.w`,
   `box.h`, `box.z`, and `stickyOffset` to emit absolute or sticky placement.
   Flow placement must emit a flow-owned wrapper/cell, then render the Content
   Element's body and element-level visual contract inside that cell. Reusing
   the positioned wrapper would make unused x/y data look authoritative and
   would let freeform drag/resize corrupt flow layout. This would be wrong if
   the current wrapper were placement-neutral. It is not.

4. **Stateful compound Content Elements are allowed inside Flow Items when
   their behaviour is self-contained.**

   **Why:** Tabs, Carousel, Accordion, Form, Nav, Collection, and nested Flow
   Container all describe behaviours that can live inside a bounded box. Banning
   them would block realistic pricing cards, tabbed feature panels, form rows,
   collection cards, nested media/text groups, and footer columns for no domain
   reason. This would be wrong if those components depended on being direct
   children of a Canvas Section. Their existing contracts are element-local or
   compound-local.

5. **Flow Layout controls replace freeform drag/resize for Flow Item
   placement.**

   **Why:** dragging a Flow Item by x/y fights the layout relation. The Owner
   should reorder items, change spans, hide/show per breakpoint, align one
   item, or edit the Flow Container's gap/padding/columns/wrap. This would be
   wrong if Flow Layout were only a visual helper over absolute boxes. It is a
   different placement relation.

6. **Element resize inside a Flow Item is intrinsic or flow-scoped, not
   section-scoped.**

   **Why:** some hosted content needs a size relation inside the flow cell
   (for example media aspect ratio, chart height, or form minimum height), but
   that size should not be expressed as section `x/y/w/h`. A future
   implementation may introduce flow-scoped sizing fields, but those fields
   belong to Flow Item or the child Content Element, not Positioned Element.
   This would be wrong if all content already sized itself perfectly from
   intrinsic content. It does not.

7. **Invalid hosted content fails validation explicitly.**

   **Why:** a Flow Item with missing content, duplicate child identity,
   unsupported element kind, cyclic child structure, malformed nested compound
   state, or content that requires section-positioned placement must fail with
   the Flow Container id, Flow Item id, child element id when present, and
   failing field. It must not silently coerce to absolute layout or drop the
   child. This would be wrong if degraded layout were acceptable. It is not.

8. **Nested Flow Containers are allowed.**

   **Why:** common designs need a grid item that contains its own stack or row:
   media above text above actions, icon beside copy inside a card, footer column
   with grouped links. Forcing every nested arrangement back into the outer
   Canvas Section would destroy the benefit of Flow Container. This would be
   wrong if nested layout created a second page model. It does not; it is still
   a finite tree inside one Positioned Flow Container.

## Out of scope

- Exact TypeScript schema for storing hosted Content Elements.
- Exact renderer function names or wrapper class names.
- Exact editor UI for selecting Flow Item versus hosted Content Element.
- Exact flow-scoped sizing fields.
- Arbitrary CSS inside Flow Items.
- Special migrations for existing Tabs, Carousel, Accordion, Form,
  Collection, Nav, or Container.
- Replacing existing compound component contracts.

## Consequences

- The v1 child set can be broad: existing Content Elements may be hosted in
  Flow Items when validation proves they do not require section-positioned
  placement.
- Flow implementation needs a placement-neutral render path for Content Element
  bodies or an explicit Flow Item wrapper that suppresses section positioning.
- Drag/resize code must branch by placement relation: Positioned Element uses
  box handles; Flow Item uses flow controls.
- State lookup should stop growing one bespoke parent kind per compound and
  move toward a generic child-slot model, but that refactor is implementation
  work, not a reason to block the product model.
- Nested Flow Containers become possible, so validation must walk Flow Item
  trees for identity, anchor, asset, and interaction integrity.
- Existing compound components remain self-contained. Flow Layout does not
  absorb their behaviour.

## Follow-ups

- Define the generic child-slot lookup model for editor selection, insertion,
  delete/restore, and agent operations.
- Define flow-scoped sizing fields for hosted Content Elements.
- Define how inspector selection moves between Flow Container, Flow Item, and
  hosted Content Element.
- Define validation rules for nested Flow Containers and duplicate identities.
