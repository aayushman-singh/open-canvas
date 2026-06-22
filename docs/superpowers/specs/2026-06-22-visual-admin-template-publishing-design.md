# Visual Admin Template Publishing Design

Date: 2026-06-22

## User View Of Done

Template Curator opens the admin template panel, chooses an existing starting point, edits it in the same visual canvas editor used for sites, then publishes it as a template everyone can select. The curator never has to create a normal site first, and Owners only see templates that have been explicitly published.

## Why

The current production admin can edit template source JSON and create a GitHub pull request, but it is not visual. The desired experience is a direct admin workflow for preparing reusable templates, using the known editor interactions rather than source editing or the new-site route.

## Success Criteria

- Template Curator can create a Template Draft from a Template Seed or existing Curated Custom Template.
- Template Curator can open a Template Draft in the visual editor without the draft appearing in the normal dashboard site list.
- Template Curator can publish a Template Draft into a Published Global Custom Template.
- Owners only see published global templates in the template picker.
- Existing sites created from an older template state do not change when the template is republished.
- Template Curator can rename, unpublish, duplicate, and delete curated templates from the admin panel.

## Non-Goals

- Visual editing of code-defined Template Seeds.
- Reverse-compiling edited site state into Section Library JSON or `TemplateSeed` source.
- Replacing the GitHub-backed Template Seed source admin.
- Analytics, ordering, categories, moderation queues, or template marketplace ranking.
- Version history for each template publication.

## Hard Constraints

- Built-in Template Seeds remain source-managed and reviewable through the existing GitHub path.
- The visual editor must use the canonical editor mutation, validation, persistence, and asset paths.
- Publish must be explicit. Draft saves do not change what Owners can select.
- Failure states must be loud: no silent default template, no guessed asset owner, no hidden degraded mode.

## Recommended Approach

Use Curated Custom Templates as the admin-managed visual template lane. Each Curated Custom Template may have one hidden Template Draft. The Template Draft is an Editable Site rendered through the existing editor in template mode. Publishing copies the draft state and asset manifest into the same global custom template row, then marks it published.

Template Seeds stay in the existing source-managed lane. If a curator wants to visually edit a built-in seed, they create a Template Draft from that seed and publish it as a Curated Custom Template.

## Data Model

Add a site kind to distinguish normal Owner sites from hidden Template Drafts:

```ts
type SiteKind = 'owner_site' | 'template_draft';
```

Normal dashboard site lists read only `owner_site`. The admin template panel reads `template_draft`.

Add publication status to Custom Templates:

```ts
type TemplatePublicationStatus = 'drafting' | 'published' | 'unpublished';
```

Template picker reads global custom templates only when `publicationStatus === 'published'`.

Add a one-to-one draft relation from Curated Custom Template to Template Draft:

```ts
templateDraftSiteId?: string;
```

The relation is unique when present. One Curated Custom Template has at most one Template Draft.

Template Draft assets belong to a configured Template Asset Custodian customer. If that custodian is missing, draft creation, uploads, and publish fail.

## Admin Flow

The admin panel shows curated templates with name, tagline, publication status, source, updated time, and draft status.

Create flow:

1. Curator chooses a Template Seed or existing Curated Custom Template.
2. System creates a hidden Template Draft.
3. Curator opens the Template Draft in the visual editor.
4. Curator publishes the draft as a new Curated Custom Template.

Manage flow:

- Edit draft opens the visual editor.
- Publish validates the draft, builds the asset manifest, overwrites the curated template row, and marks it published.
- Unpublish marks the template unpublished and hides it from future site creation.
- Rename updates template metadata.
- Duplicate draft creates a new draft/template candidate from the current draft.
- Delete requires explicit named confirmation. Published templates must be unpublished first.

## Editor Flow

The editor route gains template mode:

```ts
type EditorMode = 'site' | 'template';
```

Template mode keeps canvas editing, inspector, pages, sections, style controls, assets, AI, undo, validation, and persistence. It changes only the shell contract:

- Header shows template name and status.
- Public address, settings, site publish, and save-as-template controls are hidden.
- Save persists the Template Draft.
- Publish button becomes Publish Template.
- Asset upload is scoped to the Template Asset Custodian.

No second mutation engine is introduced.

## Failure Behavior

- Missing Template Asset Custodian blocks draft creation, asset upload, and publish.
- Invalid Template Draft blocks publish and reports validation errors.
- Missing Template Draft blocks publish.
- Unpublished and drafting templates never appear in the Owner template picker.
- Published template deletion is blocked until unpublish.
- Asset manifest mismatch blocks site creation from the template.

## Verification

- Schema smoke covers `site_kind`, `publication_status`, and one-draft-per-template uniqueness.
- Admin smoke covers create, edit draft, publish, unpublish, rename, duplicate, and delete confirmation.
- Editor smoke covers template-mode chrome and confirms site-only actions are hidden.
- Template picker smoke confirms only published global templates are visible.
- Site creation smoke confirms assets clone from a published global template into the new Owner asset set.
