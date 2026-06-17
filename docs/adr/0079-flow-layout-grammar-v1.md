# ADR 0079 - Flow Layout grammar v1

**Status:** Accepted
**Date:** 2026-06-16
**Author:** Aayushman Singh

## Context

ADR 0078 chooses Flow Container as the way to add structured responsive layout
inside the existing canvas model. It deliberately leaves the layout grammar
open.

The user-perceived done state is that an Owner can build common structured
website regions inside one canvas-positioned object: vertical content stacks,
horizontal logo/action rows, pricing grids, feature grids, testimonial groups,
footer columns, and media/text compositions. The object should resize as one
canvas element, while its children reflow predictably inside it.

The grammar must not become raw CSS. Owners should choose product concepts,
not type `display: grid` strings. Agents should emit small structured values,
not arbitrary style blobs. The editor should be able to validate and visualize
the arrangement before publish.

Existing constraints:

- A Flow Container is a Positioned Element at canvas level.
- A Flow Item is not a Positioned Element.
- Current `BaseElement.responsive` controls outer canvas boxes at `tablet` and
  `phone` breakpoints. Flow needs an inner responsive grammar for flow rules,
  not x/y/w/h.
- Open Canvas has no degraded layout mode. Invalid flow data must fail
  validation or render explicitly.

## Decisions

1. **Flow Layout v1 has three modes: `stack`, `row`, and `grid`.**

   **Why:** these three modes cover the high-value website patterns without
   exposing CSS syntax. `stack` handles vertical content groups, `row` handles
   one-dimensional horizontal groups, and `grid` handles repeated cards and
   columns. This would be wrong if v1 needed masonry, subgrid, overlapping
   layers, or arbitrary flex/grid expressions. Those are not needed to unlock
   the first competitive gap.

2. **Every Flow Layout has explicit spacing and alignment fields.**

   The common grammar is:

   ```ts
   interface FlowSpacing {
     row: number;
     column: number;
   }

   interface FlowPadding {
     top: number;
     right: number;
     bottom: number;
     left: number;
   }

   type FlowAlign = 'start' | 'center' | 'end' | 'stretch';
   type FlowJustify = 'start' | 'center' | 'end' | 'space-between';
   ```

   Each layout mode carries `gap: FlowSpacing`, `padding: FlowPadding`,
   `align: FlowAlign`, and `justify: FlowJustify`.

   **Why:** these fields are the minimum visible controls Owners expect from
   structured layout: space between children, inset from the container edge,
   cross-axis alignment, and main-axis distribution. Numbers and enums are
   inspectable, patchable, and validatable. Raw CSS strings would make the
   editor and agent surfaces parse a second language. This would be wrong if
   the target user needed full CSS authoring. That is a different product
   surface.

3. **`stack` is ordered vertical flow.**

   `stack` arranges Flow Items top-to-bottom in array order. It has no wrap
   field and no column count.

   **Why:** vertical stacks are the most common structured layout relation:
   headline/body/action groups, icon/text blocks, FAQ summaries, and footer
   link groups. Making stack a first-class mode avoids forcing Owners to fake
   vertical layout through a one-column grid. This would be wrong if one-column
   grid carried identical editing behaviour. It does not; grid spans and
   columns are noise for simple stacks.

4. **`row` is ordered horizontal flow with explicit wrapping.**

   `row` arranges Flow Items left-to-right in array order and carries
   `wrap: boolean`.

   **Why:** logo rails, action bars, nav groups, stats strips, and social rows
   need one-dimensional horizontal layout. `wrap` must be explicit because
   wrapping changes the visitor-visible shape. If `wrap` is false and content
   overflows, that is the authored layout result; the renderer must not
   silently switch to wrapping. This would be wrong if row were only a special
   case of grid. It has different author intent.

5. **`grid` uses explicit column count, not auto-fit CSS.**

   `grid` carries `columns: number`, constrained to an integer from 1 through
   12. Items auto-place in array order.

   **Why:** explicit columns match canvas authoring better than `auto-fit` or
   `minmax(...)`: the Owner can see and choose "3 cards on desktop, 2 on
   tablet, 1 on phone" instead of hoping a browser width calculation produces
   the intended count. This would be wrong if Open Canvas were exposing CSS
   grid as a professional-code surface. It is exposing a no-code layout
   primitive.

6. **Flow Item base order is array order.**

   Flow Items do not carry a base `order` field. Reordering items means
   reordering the array.

   **Why:** a stored `order` number would duplicate the array relation and
   create two sources of truth. The editor, agent, validator, and renderer
   would then need collision rules for duplicate order values. This would be
   wrong if base order needed to differ from document order. It does not.

7. **Flow Items may carry grid span and item alignment overrides.**

   Flow Item placement fields are:

   ```ts
   interface FlowItemPlacement {
     span?: number;
     align?: FlowAlign;
   }
   ```

   `span` applies only in `grid` mode and must be between 1 and the active
   column count. `align` overrides the parent layout's `align` for one item.
   Absence means "use the parent relation," not "guess a fallback."

   **Why:** span and one-off alignment are enough to express common feature
   grids and asymmetric emphasis cards without opening manual row/column
   placement. This would be wrong if Owners needed true art-directed grid
   placement inside Flow Containers. That belongs either in ordinary canvas
   positioning or a later Flow Layout expansion.

8. **Inner responsive layout uses the existing breakpoint names but not
   `BaseElement.responsive`.**

   A Flow Layout may carry `responsive.tablet` and `responsive.phone` partial
   overrides for layout fields such as `columns`, `wrap`, `gap`, `padding`,
   `align`, and `justify`. A Flow Item may carry `responsive.tablet` and
   `responsive.phone` overrides for `span`, `align`, `hidden`, and `order`.
   The `order` override exists only for breakpoint-specific reordering; base
   order remains array order.

   **Why:** outer responsive overrides move and size a Positioned Element in
   the Canvas Section. Inner responsive overrides change how children reflow
   inside a Flow Container. Reusing `BaseElement.responsive` for both would
   make one field mean two relations. This would be wrong if flow children were
   Positioned Elements. ADR 0078 says they are not.

9. **Invalid Flow Layout data fails validation or render explicitly.**

   Invalid examples include missing required layout fields, unsupported mode,
   negative spacing, non-integer columns, span greater than active columns,
   `span` on non-grid mode, duplicate breakpoint `order` values, and a hidden
   state that removes every Flow Item from a breakpoint.

   **Why:** the system must not silently coerce malformed flow data to a nearby
   valid shape, such as "grid with bad columns becomes stack" or "bad span
   becomes 1." The error must name the Flow Container, Flow Item when relevant,
   field, breakpoint, and phase. This would be wrong if degraded layout were
   acceptable. It is not.

## Out of scope

- ADR 0080 defines how Flow Items host Content Elements.
- Additional schema expansion beyond the v1 TypeScript shape.
- Full editor UI for editing Flow Layouts and direct Flow Item selection.
- Dedicated Flow Item tool names beyond the existing `addElement` /
  `updateElement` creation and patch surface.
- Masonry, subgrid, absolute child placement, overlapping flow items, manual
  row/column placement, custom CSS, container queries, and arbitrary media
  queries.
- Migrating existing compound components to Flow Layout.

## Consequences

- Flow Layout v1 is small enough for inspector controls, agent patches, and
  validation to stay deterministic.
- Grid responsiveness is explicit: column counts change at known breakpoints.
- Base item order has one source of truth: array position.
- Breakpoint-specific item reordering is possible without polluting the base
  model.
- Flow Layout introduces a second responsive concept. Documentation and editor
  UI must distinguish outer canvas responsiveness from inner flow
  responsiveness.
- Some advanced CSS layouts remain impossible by design. Owners can still use
  ordinary canvas positioning when they need art-directed overlap.

## Follow-ups

- **DONE 2026-06-16:** ADR 0080 defines how Flow Items host Content Elements.
- **DONE 2026-06-16:** v1 editor selection resolves Flow-hosted children and
  uses hosted-child rebuild/autogrow rules. Dedicated Flow Item inspector
  navigation remains successor work under ADR 0080.
- **DONE 2026-06-17:** Agent tools create Flow Containers through `addElement`
  and patch/reorder/hide Flow Items through `updateElement.items`.
- **DONE 2026-06-17:** `flow-container:smoke` covers stack, row wrap/no-wrap,
  grid columns, spans, and breakpoint overrides.
