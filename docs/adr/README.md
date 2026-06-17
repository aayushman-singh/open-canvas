# Architecture Decision Records

This directory holds rev01's Architecture Decision Records (ADRs). Each ADR captures one architectural decision, its context, its consequences, and any follow-ups.

> **Note.** ADR 0001 lives at [`docs/architecture/0001-architecture.md`](../architecture/0001-architecture.md) for historical reasons (it was authored before this index existed). All subsequent ADRs live in this directory.

---

## Index

| Number | Title | Status | Location |
|--------|-------|--------|----------|
| 0001 | rev01 architecture | Accepted | [`docs/architecture/0001-architecture.md`](../architecture/0001-architecture.md) |
| 0002 | Published address routing | Accepted | [`docs/adr/0002-published-address.md`](0002-published-address.md) |
| 0003 | Canvas-first reset | Accepted | [`docs/adr/0003-canvas-first-reset.md`](0003-canvas-first-reset.md) |
| 0004 | Owner-rooted assets and their lifecycle | Accepted | [`docs/adr/0004-owner-asset.md`](0004-owner-asset.md) |
| 0005 | Custom domains via Cloudflare for SaaS Custom Hostnames | Accepted | [`docs/adr/0005-custom-domains.md`](0005-custom-domains.md) |
| 0006 | Owner Asset storage backend: R2 originals + Cloudflare image transforms | Accepted | [`docs/adr/0006-asset-storage-backend.md`](0006-asset-storage-backend.md) |
| 0007 | Yjs revival as canonical operation model for co-edit and version history | Accepted | [`docs/adr/0007-yjs-revival.md`](0007-yjs-revival.md) |
| 0008 | Site import architecture | Accepted | [`docs/adr/0008-site-import-architecture.md`](0008-site-import-architecture.md) |
| 0009 | Addon entitlement model: account-scoped purchase, site-scoped configuration | Accepted | [`docs/adr/0009-addon-entitlement-model.md`](0009-addon-entitlement-model.md) |
| 0010 | Collaboration invite link is a bearer credential | Accepted | [`docs/adr/0010-invite-link-bearer-auth.md`](0010-invite-link-bearer-auth.md) |
| 0011 | Canvas element registry as the single source of truth per element type | Accepted | [`docs/adr/0011-canvas-element-registry.md`](0011-canvas-element-registry.md) |
| 0012 | `canvas/validate.ts` is the only write gate; consumers trust its output | Accepted | [`docs/adr/0012-validation-write-gate.md`](0012-validation-write-gate.md) |
| 0013 | Apex host is environment-driven; production code reads it through one helper | Accepted | [`docs/adr/0013-host-config-from-environment.md`](0013-host-config-from-environment.md) |
| 0014 | Compile-time data substitution for template-literal-bound client scripts | Rejected (superseded by 0015 without implementation) | [`docs/adr/0014-template-literal-data-substitution.md`](0014-template-literal-data-substitution.md) |
| 0015 | Editor client ships as a built, cached, separately-fetched asset | Accepted | [`docs/adr/0015-editor-client-asset-pipeline.md`](0015-editor-client-asset-pipeline.md) |
| 0016 | Fake discriminated-union patterns become real TS discriminated unions | Accepted | [`docs/adr/0016-fake-discriminated-unions-to-real.md`](0016-fake-discriminated-unions-to-real.md) |
| 0017 | Cookie name prefix is environment-driven | Accepted | [`docs/adr/0017-cookie-name-prefix-from-env.md`](0017-cookie-name-prefix-from-env.md) |
| 0018 | Email sender address is environment-driven | Accepted | [`docs/adr/0018-email-sender-from-env.md`](0018-email-sender-from-env.md) |
| 0019 | `SectionRecipeId 'custom'` is the sentinel for manually-designed sections | Accepted | [`docs/adr/0019-section-recipe-custom-sentinel.md`](0019-section-recipe-custom-sentinel.md) |
| 0020 | Per-request CSP nonce gates the editor's inline boot blob | Accepted | [`docs/adr/0020-csp-nonce-for-editor-boot-blob.md`](0020-csp-nonce-for-editor-boot-blob.md) |
| 0021 | Dashboard ships as one shared, browser-cached asset bundle | Accepted | [`docs/adr/0021-dashboard-shared-asset-bundle.md`](0021-dashboard-shared-asset-bundle.md) |
| 0022 | Twelve-token OKLCH theme grammar derived from a single seed | Accepted | [`docs/adr/0022-twelve-token-oklch-theme-grammar.md`](0022-twelve-token-oklch-theme-grammar.md) |
| 0023 | Seed asset bytes are stored as base64 text files in-repo | Accepted | [`docs/adr/0023-seed-asset-bytes-as-base64-text.md`](0023-seed-asset-bytes-as-base64-text.md) |
| 0024 | Landing page is one locked Post-Aero surface with a checked-in preview artifact | Accepted | [`docs/adr/0024-landing-locked-post-aero-with-preview.md`](0024-landing-locked-post-aero-with-preview.md) |
| 0025 | The renderer is the only throw site in the canvas subsystem; the validator never throws | Accepted | [`docs/adr/0025-renderer-is-only-throw-site.md`](0025-renderer-is-only-throw-site.md) |
| 0026 | Defer Clerk networkless JWT verification; accept the JWKS fetch per isolate | Accepted | [`docs/adr/0026-defer-clerk-networkless-jwt.md`](0026-defer-clerk-networkless-jwt.md) |
| 0027 | Yjs encode/decode dispatch stays central; per-element files do not gain yjs runtime dependencies | Accepted | [`docs/adr/0027-yjs-projection-central-placement.md`](0027-yjs-projection-central-placement.md) |
| 0028 | Page background uses the buildColorRow swatch+hex pattern | Accepted | [`docs/adr/0028-page-background-colour-picker-verification.md`](0028-page-background-colour-picker-verification.md) |
| 0029 | Custom-404 toggle on the page inspector | Accepted | [`docs/adr/0029-custom-404-toggle-on-page-inspector.md`](0029-custom-404-toggle-on-page-inspector.md) |
| 0030 | Audit re-run button reads "Run audit" | Accepted | [`docs/adr/0030-audit-button-label-run-audit.md`](0030-audit-button-label-run-audit.md) |
| 0031 | Accessibility audit hides the numeric score | Accepted | [`docs/adr/0031-audit-numeric-score-handling.md`](0031-audit-numeric-score-handling.md) |
| 0032 | CSV export reachable from the top-level Forms inbox | Accepted | [`docs/adr/0032-csv-export-at-top-level-forms-inbox.md`](0032-csv-export-at-top-level-forms-inbox.md) |
| 0033 | Section inspector surfaces role, bg effect, entrance, bg video, popup trigger | Accepted | [`docs/adr/0033-section-inspector-fields-for-role-bgeffect-entrance-bgvideo-popup.md`](0033-section-inspector-fields-for-role-bgeffect-entrance-bgvideo-popup.md) |
| 0034 | `+ New Page` opens a modal that captures title, slug, and locale | Accepted | [`docs/adr/0034-new-page-modal-with-title-slug-locale.md`](0034-new-page-modal-with-title-slug-locale.md) |
| 0035 | Visitor dark mode is a three-way enum (`light` / `dark` / `toggleable`) | Accepted | [`docs/adr/0035-visitor-dark-mode-three-way-enum.md`](0035-visitor-dark-mode-three-way-enum.md) |
| 0036 | Per-page password gate scope, single site secret | Rejected | [`docs/adr/0036-per-page-password-gate-scope.md`](0036-per-page-password-gate-scope.md) |
| 0037 | Account page ships the billing surface before the billing engine | Superseded by 0042 | [`docs/adr/0037-account-page-billing-surface-pre-billing.md`](0037-account-page-billing-surface-pre-billing.md) |
| 0042 | Account page renders a mock-billing plan picker; no billing engine ships | Accepted (supersedes 0037, amended 2026-06-04) | [`docs/adr/0042-account-page-metering-only.md`](0042-account-page-metering-only.md) |
| 0038 | Snapshot preview is a server-rendered sandboxed iframe via srcdoc | Accepted | [`docs/adr/0038-snapshot-preview-iframe.md`](0038-snapshot-preview-iframe.md) |
| 0039 | A11y link in the canvas editor header | Accepted | [`docs/adr/0039-a11y-link-in-canvas-editor-header.md`](0039-a11y-link-in-canvas-editor-header.md) |
| 0040 | Apogee Showcase fixture canonical URLs derive from request host at emit time | Accepted | [`docs/adr/0040-canonical-urls-from-host-config.md`](0040-canonical-urls-from-host-config.md) |
| 0041 | Apogee Showcase fixture og:image renders fresh per published page | Accepted | [`docs/adr/0041-og-image-fresh-render-per-page.md`](0041-og-image-fresh-render-per-page.md) |
| 0043 | In-app notifications: persistent, recipient-tagged, delivered live over SSE | Accepted | [`docs/adr/0043-in-app-notifications.md`](0043-in-app-notifications.md) |
| 0044 | Single HMAC secret signs invite, edit, and unlock tokens | Accepted | [`docs/adr/0044-single-hmac-secret-for-signed-tokens.md`](0044-single-hmac-secret-for-signed-tokens.md) |
| 0045 | SiteRoom broadcasts Yjs updates to peers before autosave persistence completes | Accepted | [`docs/adr/0045-siteroom-broadcast-precedes-persistence.md`](0045-siteroom-broadcast-precedes-persistence.md) |
| 0046 | `addon_custom_scripts` is Owner-authored JavaScript by design; entitlement is the security boundary | Accepted | [`docs/adr/0046-addon-custom-scripts-as-owner-code.md`](0046-addon-custom-scripts-as-owner-code.md) |
| 0047 | Editor WebSocket bearer travels in the URL query string | Accepted | [`docs/adr/0047-ws-token-in-query-for-editor-socket.md`](0047-ws-token-in-query-for-editor-socket.md) |
| 0048 | Chat session is last-writer-wins; concurrent tab writes are out of scope | Accepted | [`docs/adr/0048-chat-session-last-writer-wins.md`](0048-chat-session-last-writer-wins.md) |
| 0049 | Rename R2 bucket `rev01-assets` to `opencanvas-assets` | Proposed | [`docs/adr/0049-r2-bucket-rename-from-rev01-assets-to-opencanvas-assets.md`](0049-r2-bucket-rename-from-rev01-assets-to-opencanvas-assets.md) |
| 0050 | Layout primitives: fluid type, anchor ids, site-level scroll behaviour | Proposed | [`docs/adr/0050-layout-primitives-fluid-type-anchor-ids-scroll-padding.md`](0050-layout-primitives-fluid-type-anchor-ids-scroll-padding.md) |
| 0051 | Action expressiveness: rich labels, icon registry, copy behaviour, container links | Proposed | [`docs/adr/0051-action-expressiveness-rich-labels-icons-copy-container-links.md`](0051-action-expressiveness-rich-labels-icons-copy-container-links.md) |
| 0052 | Tabs as a `TabsElement` with embedded panels | Proposed | [`docs/adr/0052-tabs-as-element-with-embedded-panels.md`](0052-tabs-as-element-with-embedded-panels.md) |
| 0054 | Layout v2: sticky positioning, drill-in overlay contract, scroll-snap rail | Proposed (sticky + scroll-snap shipped; drill-in overlay documented as contract, implementation deferred) | [`docs/adr/0054-layout-v2-sticky-positioning-drill-in-overlay-scroll-snap-rail.md`](0054-layout-v2-sticky-positioning-drill-in-overlay-scroll-snap-rail.md) |
| 0055 | Agent runs until budget exhausts, not until a fixed iteration count | Accepted | [`docs/adr/0055-agent-runs-until-budget-exhausts.md`](0055-agent-runs-until-budget-exhausts.md) |
| 0056 | Summarisation and read-only inspection iterations run on Flash; planning iterations run on Pro | Accepted | [`docs/adr/0056-llm-tier-routing-flash-for-inspection-pro-for-planning.md`](0056-llm-tier-routing-flash-for-inspection-pro-for-planning.md) |
| 0057 | Every canvas element dispatch shares one shape: mapped-type record, typed dispatcher, runtime guard | Accepted | [`docs/adr/0057-canvas-element-dispatch-shape.md`](0057-canvas-element-dispatch-shape.md) |
| 0058 | EditorContext is a 1:1 mirror of the IIFE closure, populated incrementally | Accepted | [`docs/adr/0058-editor-context-as-iife-closure-mirror.md`](0058-editor-context-as-iife-closure-mirror.md) |
| 0059 | Site header/footer is the only canonical pinned section; pages opt-in or opt-out | Accepted | [`docs/adr/0059-site-header-footer-is-only-canonical-pin.md`](0059-site-header-footer-is-only-canonical-pin.md) |
| 0060 | CMS-style entries live in a dedicated table; the canvas holds template pages, not individual entries | Accepted | [`docs/adr/0060-cms-entries-table-and-template-pages.md`](0060-cms-entries-table-and-template-pages.md) |
| 0061 | Section Library is the canonical pool; Template Seeds are compositions of Section Instances | Accepted | [`docs/adr/0061-section-library-is-canonical-pool-templates-are-compositions.md`](0061-section-library-is-canonical-pool-templates-are-compositions.md) |
| 0062 | Section accent border is a single discriminated-union field with four mutually exclusive variants | Accepted | [`docs/adr/0062-section-accent-border.md`](0062-section-accent-border.md) |
| 0063 | Collection element binds at element level, ships visible defaults, and groups entries by folder | Accepted | [`docs/adr/0063-collection-element-binds-at-element-level-and-ships-defaults.md`](0063-collection-element-binds-at-element-level-and-ships-defaults.md) |
| 0064 | EditorContext decomposes into narrow named-Pick contexts per consumer | Accepted | [`docs/adr/0064-editor-context-decomposition.md`](0064-editor-context-decomposition.md) |
| 0065 | Custom Collection card template lives on the element, edited in-place via global editor state | Accepted | [`docs/adr/0065-custom-collection-card-template.md`](0065-custom-collection-card-template.md) |
| 0066 | Interactive components gain the variant-preset layer; pointer-reactive variants run on one fragment in the existing interactive runtime | Accepted | [`docs/adr/0066-interactive-component-variant-layer-and-declarative-motion-runtime.md`](0066-interactive-component-variant-layer-and-declarative-motion-runtime.md) |
| 0067 | Component Style objects for interactive components and Collections | Accepted | [`docs/adr/0067-component-style-objects-for-interactive-components-and-collections.md`](0067-component-style-objects-for-interactive-components-and-collections.md) |
| 0068 | License-safe third-party interaction runtimes | Accepted | [`docs/adr/0068-license-safe-third-party-interaction-runtimes.md`](0068-license-safe-third-party-interaction-runtimes.md) |
| 0069 | Motion Sequence and Scroll Scene | Accepted | [`docs/adr/0069-motion-sequence-and-scroll-scene.md`](0069-motion-sequence-and-scroll-scene.md) |
| 0070 | Overlay as first-class behaviour | Accepted | [`docs/adr/0070-overlay-as-first-class-behaviour.md`](0070-overlay-as-first-class-behaviour.md) |
| 0071 | Load Experience and Route Transition | Accepted | [`docs/adr/0071-load-experience-and-route-transition.md`](0071-load-experience-and-route-transition.md) |
| 0072 | Rich Motion Asset runtimes | Accepted | [`docs/adr/0072-rich-motion-asset-runtimes.md`](0072-rich-motion-asset-runtimes.md) |
| 0073 | Owner-chosen Growth Signals | Proposed | [`docs/adr/0073-owner-chosen-growth-signals.md`](0073-owner-chosen-growth-signals.md) |
| 0074 | Experiments use Alternatives | Proposed | [`docs/adr/0074-experiments-use-alternatives.md`](0074-experiments-use-alternatives.md) |
| 0075 | Personalization uses Visitor Segments | Proposed | [`docs/adr/0075-personalization-uses-visitor-segments.md`](0075-personalization-uses-visitor-segments.md) |
| 0076 | On-page Content Editing is review-gated | Proposed | [`docs/adr/0076-on-page-content-editing-is-review-gated.md`](0076-on-page-content-editing-is-review-gated.md) |
| 0077 | On-page Design Editing edits the Editable Site | Proposed | [`docs/adr/0077-on-page-design-editing-edits-the-editable-site.md`](0077-on-page-design-editing-edits-the-editable-site.md) |
| 0078 | Flow Container is a Compound Element inside Canvas Sections | Accepted | [`docs/adr/0078-flow-container-is-a-compound-element-inside-canvas-sections.md`](0078-flow-container-is-a-compound-element-inside-canvas-sections.md) |
| 0079 | Flow Layout grammar v1 | Accepted | [`docs/adr/0079-flow-layout-grammar-v1.md`](0079-flow-layout-grammar-v1.md) |
| 0080 | Flow Items own placement; Content Elements own behaviour | Accepted | [`docs/adr/0080-flow-items-own-placement-content-elements-own-behaviour.md`](0080-flow-items-own-placement-content-elements-own-behaviour.md) |

Add new ADRs here. Keep the index sorted by number.

---

## File naming

`NNNN-kebab-title.md` — four-digit zero-padded number, kebab-cased title, no date in the filename. The date lives inside the file.

Examples:
- `0002-document-schema.md`
- `0003-multiplayer-transport.md`
- `0004-agent-tool-surface.md`

---

## Status flow

```
Proposed ──┬──► Accepted ──► Superseded (by ADR NNNN)
           └──► Rejected
```

- **Proposed** — drafted, under discussion, not yet binding.
- **Accepted** — the decision stands; the codebase must conform.
- **Rejected** — explored, declined. The ADR stays in the repo as the record of why.
- **Superseded** — replaced by a later ADR. The header points to the successor.

Never delete an ADR. A rejected or superseded decision is part of the audit trail.

---

## Required sections

Every ADR has exactly these top-level sections, in this order:

1. **Header** — `Status`, `Date`, `Author` (and `Supersedes` / `Superseded by` if applicable).
2. **Context** — the user-perceived problem and the constraints that frame the decision. No mechanism yet.
3. **Decisions** — the choices made. Numbered. Each has a one-line statement and a "Why" paragraph.
4. **Out of scope** — what this ADR explicitly does *not* decide. Closes the door on scope creep.
5. **Consequences** — positive and negative trade-offs that fall out of the decisions.
6. **Follow-ups** — pointers to ADRs that must come next (with proposed numbers if known).

Decisions in the "Decisions" section are immutable once Accepted. Change of mind = new ADR that supersedes the old one.

---

## Authoring rules

- Reason from the **user's experience of "done"** first. The "why" of every decision must trace to a user-perceived outcome, not an internal preference.
- Write each "Why" as a falsifiable claim — what would have to be true in the world for this decision to be wrong?
- One ADR per coherent decision cluster. Do not bundle unrelated decisions to save numbering.
- Decisions are conceptual. Name *what* the system does, not *which library does it*. Library choices belong inside the "Why" paragraph as evidence, not in the decision title.
- No fallbacks, no degraded modes. If a decision implies a failure path, name the failure path explicitly.
