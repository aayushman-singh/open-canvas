# ADR 0085 - Curated Custom Templates use hidden Template Drafts

**Status:** Proposed
**Date:** 2026-06-22
**Author:** Aayushman Singh

## Context

The production admin template source panel lets a trusted admin edit code-defined Template Seed section JSON and create a GitHub pull request. The user now wants an admin visual editor "exactly like the site one" that can publish and manage templates available to everyone without going through the new-site route.

The tempting path is to make visual edits update built-in Template Seeds. That would require reverse-compiling full Editable Site state back into a Template Seed composition plus Section Library source entries. The existing domain model says Template Seeds are source-managed compositions, while Custom Templates are captured from Editable Sites.

## Decisions

1. **Visual admin template editing targets Curated Custom Templates, not Template Seeds.**

   **Why:** A curator's user-visible goal is to visually prepare templates everyone can select. Custom Templates already preserve whole Editable Site state, so they match the editor output. Template Seeds remain reviewable, source-managed, and GitHub-backed. This would be wrong if visual admin edits had to land as code-defined built-in seeds on every publish.

2. **A Curated Custom Template has at most one hidden Template Draft.**

   **Why:** Curators need one obvious place to continue editing a template. Hidden drafts avoid cluttering the normal Owner dashboard while keeping the editor's existing state contract. This would be wrong if curators needed multiple simultaneous branches or version history in v1.

3. **A Template Draft is an Editable Site with a template-only site kind.**

   **Why:** Reusing Editable Site keeps canvas mutation, validation, persistence, co-edit, undo, AI, and assets on the canonical path. A separate draft table or editor engine would duplicate behaviour and drift. This would be wrong if Template Drafts needed a different authoring model from sites.

4. **Publishing copies the Template Draft into the same global custom template row and marks it published.**

   **Why:** Owners need a stable selectable template identity, and existing sites must remain unaffected because site creation clones template state. Creating a new row on every publish would fragment the picker and management surface. This would be wrong if template publication history or rollback were v1 requirements.

5. **Unpublish hides a Curated Custom Template from new site creation without deleting its record or draft.**

   **Why:** Unpublish means "not selectable now", not "destroy the working template". Keeping the draft lets the curator revise and republish the same template identity. This would be wrong if legal or policy removal required hard deletion as the primary action.

6. **Template Draft assets are owned by a Template Asset Custodian, not the curator's personal account.**

   **Why:** Global templates should not depend on the lifecycle of one curator account. The existing custom template asset manifest can still clone assets into each Owner's account when they create a site. This would be wrong if templates were personal artifacts tied to one curator's asset library.

## Out of scope

- Visual mutation of code-defined Template Seeds.
- Reverse-compiling Editable Site state into Template Seed and Section Library source files.
- Publication version history, rollback, marketplace ordering, analytics, categories, or moderation queues.
- Replacing the GitHub-backed Template Seed source admin.

## Consequences

- The admin panel gets a visual lane for globally available templates without weakening the source-managed Template Seed lane.
- The `site` model needs a site kind so hidden Template Drafts do not appear as normal Owner sites.
- The `custom_template` model needs publication status and an optional one-to-one draft relation.
- Template picker queries must filter global custom templates by publication status.
- Missing Template Asset Custodian configuration blocks draft creation, uploads, and publish rather than guessing an owner.

## Follow-ups

- Write the implementation plan from the approved design spec at `docs/superpowers/specs/2026-06-22-visual-admin-template-publishing-design.md`.
