# ADR 0077 - On-page Design Editing edits the Editable Site

**Status:** Proposed
**Date:** 2026-06-16
**Author:** Aayushman Singh

## Context

ADR 0076 defines a content-only, review-gated workflow for collaborators who
should not control layout or behaviour. That is not the whole on-page editing
ambition. To compete with Framer, Webflow, and similar builders, Open Canvas
also needs a full design-capable experience where a trusted user can open the
site in page context and change the design directly.

The codebase already has a related path: `/?edit` on a published address serves
the full canvas editor after authenticating an Owner or accepted editor
collaborator. That route deliberately bypasses the published snapshot and
password gate; the editor operates on `editableState`. The strategic question
is therefore not "should Open Canvas invent editing from the live page?" The
question is what product contract the design-capable on-page editing surface
must obey.

The user-perceived "done" state is that an Owner or Design Collaborator opens a
published address, enters design mode, selects the real page object they are
looking at, changes content, layout, style, structure, or behaviour, and sees
the Editable Site update. Visitors still see the previous Published Site until
the Owner publishes.

## Decisions

1. **On-page Design Editing is full design editing, separate from On-page
   Content Editing.**

   **Why:** restricting everything to content would fail the competitive goal:
   designers expect to edit spacing, layout, structure, styles, motion, and
   behaviour while seeing the page in context. ADR 0076 remains valuable for
   low-trust content collaboration, but it is not the design-authoring surface.
   This would be wrong if every collaborator only needed copy edits. The user
   explicitly rejected that restriction.

2. **The Editable Site is the source of truth for On-page Design Editing.**

   **Why:** a published page can be behind the current draft. Editing the
   Published Snapshot or patching the live DOM would fork the site into two
   truths: what the editor is changing and what the Owner will later publish.
   The published address is the entry context; once editing starts, the user is
   editing the current Editable Site. This would be wrong if Open Canvas allowed
   direct production patches. It does not, and should not.

3. **On-page Design Editing uses the canonical editor contract, not a second
   mutation engine.**

   **Why:** layout, style, structure, behaviour, validation, rendering,
   co-editing, undo, and publish already have one canonical path. A separate
   page-context mutation engine would drift from the canvas editor and produce
   states one surface can create but the other cannot understand. This would be
   wrong if on-page design editing were a tiny DOM annotation layer. It is a
   full authoring surface.

4. **Design Collaborators can make Design Changes directly to the Editable Site
   when granted design access.**

   **Why:** a Design Collaborator is trusted to design. Forcing every design
   operation through Review Requests would make full on-page design editing feel
   like a content approval queue and would duplicate the co-edit model already
   present in the editor. This would be wrong if the user were a low-trust
   client or marketer. That role is Content Collaborator from ADR 0076.

5. **Publish remains Owner-only in v1.**

   **Why:** publishing changes the external contract of the public site,
   consumes the existing publish pipeline, and writes the current Published
   Snapshot. The current publish endpoint is owner-scoped, while editor access
   can include accepted collaborators. Keeping publish Owner-only preserves the
   existing release boundary while still letting Design Collaborators prepare
   changes. This would be wrong if collaborators must ship production changes
   without Owner review. That is a separate role decision.

6. **Visitors never receive un-published Design Changes.**

   **Why:** the editing socket can carry Editable Site updates, but anonymous
   visitors should only receive publish broadcasts. A visitor observing a
   half-finished layout change would violate the Published Site contract and
   make publish meaningless. This would be wrong if the product promise were
   live production editing. It is not.

7. **The surface must clearly signal when the Editable Site differs from the
   Published Site.**

   **Why:** entering design mode from a public URL can create a false
   expectation that the user is editing exactly what visitors currently see.
   If unpublished draft changes already exist, the editor must make that state
   explicit instead of pretending the published page and editable page are the
   same. This would be wrong if drafts and published snapshots never diverged.
   They routinely can.

8. **Invalid Design Changes fail through the same validation and publish gates
   as the canonical editor.**

   **Why:** on-page design editing must not coerce an invalid layout,
   unsupported behaviour, deleted target, missing asset, or renderer mismatch
   into a nearby valid state. The failure must name the site, target, change,
   and failing phase. This would be wrong if best-effort DOM patching were
   acceptable. It is not.

## Out of scope

- Replacing the dashboard editor shell.
- Content-only Review Requests; ADR 0076 owns that workflow.
- Direct production patches to the Published Site.
- Collaborator publish rights.
- Administrative surfaces such as billing, domain management, Addon purchase,
  collaborator management, and account settings.
- Comment threads, annotations, mentions, and design review.
- Mobile or tablet design editing.
- Detailed UI layout, selection mechanics, keyboard shortcuts, and command
  palettes.
- Persistence schema changes beyond the existing Editable Site contract.

## Consequences

- Open Canvas has two named page-context editing workflows: review-gated
  On-page Content Editing and full-authority On-page Design Editing.
- The existing `/?edit` path is conceptually aligned with On-page Design
  Editing, but future implementation still needs to decide whether it remains
  the actual shell or becomes a bridge into a more page-native shell.
- The implementation must avoid a second write path for canvas state.
- Design Collaborators can create visible draft changes, but only Owners can
  publish those changes in v1.
- The editor needs a strong draft-vs-live signal when entered from a published
  address.
- Any future direct-live-edit feature requires a superseding ADR because it
  would change the Published Site contract.

## Follow-ups

- Decide whether the existing `/?edit` full canvas editor becomes the v1
  On-page Design Editing surface or is replaced by a page-native shell.
- Define the Design Collaborator permission model relative to the current
  collaborator `editor` role.
- Define draft-vs-live signalling when the Published Snapshot differs from the
  Editable Site.
- Define target mapping from published URL and visible object to current
  Editable Site page, section, and element.
- Decide whether collaborator publish rights are ever needed.
