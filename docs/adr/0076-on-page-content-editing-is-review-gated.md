# ADR 0076 - On-page Content Editing is review-gated

**Status:** Proposed
**Date:** 2026-06-16
**Author:** Aayushman Singh

## Context

The Owner-facing gap is safe collaboration for content updates. Framer and
Webflow both make it possible for non-designers to edit site content without
being handed the full builder. Open Canvas already has an on-site edit flow:
`/?edit` on a published address can authenticate an Owner or accepted
collaborator and serve the full canvas editor. That is useful for designers and
site operators, but it is too powerful for a marketer, client, or teammate who
only needs to fix copy, swap a photo, or update a link.

The user-perceived "done" state is that a Content Collaborator opens the
Published Site, edits allowed content in place, submits a Review Request, and
the Owner can accept or reject it before it reaches the Editable Site and later
the Published Site. The collaborator cannot move sections, resize elements,
change styles, add scripts, alter behaviour, or publish by accident.

This ADR deliberately uses **On-page Content Editing** rather than "on-site
editor" because the codebase already uses on-site edit to mean the full canvas
editor launched from the published address. The new capability is narrower: it
is a content workflow with a review gate.

## Decisions

1. **On-page Content Editing is a separate content-only workflow, not a mode of
   the full canvas editor.**

   **Why:** the full editor owns layout, style, structure, behaviour, AI tools,
   publishing, and site settings. Hiding buttons in that surface would make a
   permission boundary depend on UI affordances instead of the product model.
   A separate content-only workflow gives future implementation a smaller
   contract: a collaborator can propose Content Changes, not mutate the canvas.
   This would be wrong if the target collaborator needed design control. They
   do not in v1.

2. **V1 Content Changes are limited to content fields.**

   **Why:** the useful first set is copy, rich text content, media choice,
   media description, action label, link destination, form labels,
   placeholders, success copy, and collection entry content. Those are the
   things a non-designer naturally owns. Layout, style, element type, section
   order, page structure, interaction behaviour, scripts, Addons, SEO settings,
   and publishing are not content fields. This would be wrong if owners were
   primarily asking clients to redesign pages. The competitive gap is safer
   content collaboration.

3. **Every On-page Content Editing session produces a Review Request.**

   **Why:** a content collaborator's edits should not quietly alter the
   Editable Site, and they should never alter the Published Site. A Review
   Request gives the Owner a named decision point with the proposed content
   changes grouped together. This would be wrong if content collaborators were
   trusted as full editors. That is the existing collaborator/full-editor path,
   not this feature.

4. **Only the Owner can accept a Review Request.**

   **Why:** publishing is already Owner-controlled, and accepting a content
   bundle into the Editable Site is the same class of release responsibility.
   Letting content collaborators approve their own changes would collapse the
   review gate into ceremony. This would be wrong if the role were "editor with
   publish rights." The role here is content collaborator.

5. **Accepted Review Requests change the Editable Site; the Published Site
   changes only after publish.**

   **Why:** Open Canvas' core contract is that Visitors see the Published Site,
   and the Published Site changes after publish. Content collaboration must not
   create a second live-update path. This would be wrong if on-page content
   editing were meant to patch production immediately. It is not.

6. **Rejected or withdrawn Review Requests leave no partial site changes.**

   **Why:** a rejected content proposal should be easy to reason about: the
   site did not change. Partial application would make review hard to audit and
   would force the Owner to inspect which pieces leaked through. This would be
   wrong if Review Requests were long-lived branches with partial merges. V1 is
   a small content proposal.

7. **Invalid Content Changes fail before a Review Request can be accepted.**

   **Why:** a Content Change pointing at a deleted element, an unsupported
   field, an invalid asset, a dangerous link, or a stale collection entry must
   not be accepted silently or coerced into a nearby valid field. The failure
   must name the Review Request, Content Change, target, and failing rule. This
   would be wrong if best-effort content merging were acceptable. It is not.

8. **Comments and discussion are not part of v1 On-page Content Editing.**

   **Why:** comments create a separate collaboration model: anchors, threads,
   mentions, read state, notification policy, and resolution history. That is a
   real product surface and should not be smuggled into the content-editing
   workflow. This would be wrong if the first goal were design review. The
   first goal is safe content edits.

## Out of scope

- Full canvas editing from the content-only surface.
- Moving, resizing, adding, removing, or reordering sections or elements.
- Style, theme, motion, interaction, Addon, script, SEO, domain, password, or
  publishing changes.
- Direct-to-published content patches.
- Comment threads, mentions, annotations, or design review.
- Multi-reviewer approval chains.
- Long-lived branches or partial merges.
- Detailed persistence schema, diff format, and merge algorithm.
- Visual design of the review inbox.

## Consequences

- The product gains a collaborator-safe workflow that competes with
  content-editing modes without widening full editor permissions.
- The existing on-site edit flow remains the full canvas editor; the new
  On-page Content Editing surface must have a separate authorization and write
  contract.
- Content-bearing elements and collection entries need stable field identities
  so Review Requests can target them safely.
- The Owner needs a review inbox that shows proposed before/after content and
  blocks accept on invalid or stale changes.
- Publish remains the only path from Editable Site to Published Site.
- Comments and design review remain a separate future capability.

## Follow-ups

- Define Content Change target identity and diff format.
- Define the Content Collaborator permission model and invite flow.
- Define Review Request lifecycle states and notifications.
- Define stale-target validation and conflict reporting.
- ADR 0077 defines full On-page Design Editing separately.
- Draft a separate ADR for comments, annotations, and design review.
