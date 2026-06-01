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
| 0011 | Canvas element registry as the single source of truth per element type | Proposed | [`docs/adr/0011-canvas-element-registry.md`](0011-canvas-element-registry.md) |
| 0012 | `canvas/validate.ts` is the only write gate; consumers trust its output | Proposed | [`docs/adr/0012-validation-write-gate.md`](0012-validation-write-gate.md) |
| 0013 | Apex host is environment-driven; production code reads it through one helper | Accepted | [`docs/adr/0013-host-config-from-environment.md`](0013-host-config-from-environment.md) |
| 0014 | Compile-time data substitution for template-literal-bound client scripts | Proposed | [`docs/adr/0014-template-literal-data-substitution.md`](0014-template-literal-data-substitution.md) |
| 0015 | Editor client ships as a built, cached, separately-fetched asset | Proposed | [`docs/adr/0015-editor-client-asset-pipeline.md`](0015-editor-client-asset-pipeline.md) |
| 0016 | Fake discriminated-union patterns become real TS discriminated unions | Proposed | [`docs/adr/0016-fake-discriminated-unions-to-real.md`](0016-fake-discriminated-unions-to-real.md) |
| 0017 | Cookie name prefix is environment-driven | Accepted | [`docs/adr/0017-cookie-name-prefix-from-env.md`](0017-cookie-name-prefix-from-env.md) |
| 0018 | Email sender address is environment-driven | Accepted | [`docs/adr/0018-email-sender-from-env.md`](0018-email-sender-from-env.md) |
| 0019 | `SectionRecipeId 'custom'` is the sentinel for manually-designed sections | Accepted | [`docs/adr/0019-section-recipe-custom-sentinel.md`](0019-section-recipe-custom-sentinel.md) |
| 0020 | Per-request CSP nonce gates the editor's inline boot blob | Proposed | [`docs/adr/0020-csp-nonce-for-editor-boot-blob.md`](0020-csp-nonce-for-editor-boot-blob.md) |
| 0021 | Dashboard ships as one shared, browser-cached asset bundle | Proposed | [`docs/adr/0021-dashboard-shared-asset-bundle.md`](0021-dashboard-shared-asset-bundle.md) |
| 0022 | Twelve-token OKLCH theme grammar derived from a single seed | Proposed | [`docs/adr/0022-twelve-token-oklch-theme-grammar.md`](0022-twelve-token-oklch-theme-grammar.md) |
| 0023 | Seed asset bytes are stored as base64 text files in-repo | Proposed | [`docs/adr/0023-seed-asset-bytes-as-base64-text.md`](0023-seed-asset-bytes-as-base64-text.md) |
| 0024 | Landing page is one locked Post-Aero surface with a checked-in preview artifact | Proposed | [`docs/adr/0024-landing-locked-post-aero-with-preview.md`](0024-landing-locked-post-aero-with-preview.md) |
| 0025 | The renderer is the only throw site in the canvas subsystem; the validator never throws | Proposed | [`docs/adr/0025-renderer-is-only-throw-site.md`](0025-renderer-is-only-throw-site.md) |
| 0026 | Defer Clerk networkless JWT verification; accept the JWKS fetch per isolate | Proposed | [`docs/adr/0026-defer-clerk-networkless-jwt.md`](0026-defer-clerk-networkless-jwt.md) |
| 0028 | Page background uses the buildColorRow swatch+hex pattern | Accepted | [`docs/adr/0028-page-background-colour-picker-verification.md`](0028-page-background-colour-picker-verification.md) |
| 0029 | Custom-404 toggle on the page inspector | Accepted | [`docs/adr/0029-custom-404-toggle-on-page-inspector.md`](0029-custom-404-toggle-on-page-inspector.md) |
| 0030 | Audit re-run button reads "Run audit" | Accepted | [`docs/adr/0030-audit-button-label-run-audit.md`](0030-audit-button-label-run-audit.md) |
| 0031 | Accessibility audit hides the numeric score | Accepted | [`docs/adr/0031-audit-numeric-score-handling.md`](0031-audit-numeric-score-handling.md) |
| 0032 | CSV export reachable from the top-level Forms inbox | Accepted | [`docs/adr/0032-csv-export-at-top-level-forms-inbox.md`](0032-csv-export-at-top-level-forms-inbox.md) |
| 0033 | Section inspector surfaces role, bg effect, entrance, bg video, popup trigger | Accepted | [`docs/adr/0033-section-inspector-fields-for-role-bgeffect-entrance-bgvideo-popup.md`](0033-section-inspector-fields-for-role-bgeffect-entrance-bgvideo-popup.md) |
| 0034 | `+ New Page` opens a modal that captures title, slug, and locale | Accepted | [`docs/adr/0034-new-page-modal-with-title-slug-locale.md`](0034-new-page-modal-with-title-slug-locale.md) |
| 0035 | Visitor dark mode is a three-way enum (`light` / `dark` / `toggleable`) | Accepted | [`docs/adr/0035-visitor-dark-mode-three-way-enum.md`](0035-visitor-dark-mode-three-way-enum.md) |
| 0037 | Account page ships the billing surface before the billing engine | Superseded by 0042 | [`docs/adr/0037-account-page-billing-surface-pre-billing.md`](0037-account-page-billing-surface-pre-billing.md) |
| 0042 | Account page is usage metering only; no billing surface ships | Accepted (supersedes 0037) | [`docs/adr/0042-account-page-metering-only.md`](0042-account-page-metering-only.md) |
| 0038 | Snapshot preview is a server-rendered sandboxed iframe via srcdoc | Accepted | [`docs/adr/0038-snapshot-preview-iframe.md`](0038-snapshot-preview-iframe.md) |
| 0039 | A11y link in the canvas editor header | Accepted | [`docs/adr/0039-a11y-link-in-canvas-editor-header.md`](0039-a11y-link-in-canvas-editor-header.md) |
| 0040 | Apogee Showcase fixture canonical URLs derive from request host at emit time | Accepted | [`docs/adr/0040-canonical-urls-from-host-config.md`](0040-canonical-urls-from-host-config.md) |
| 0041 | Apogee Showcase fixture og:image renders fresh per published page | Accepted | [`docs/adr/0041-og-image-fresh-render-per-page.md`](0041-og-image-fresh-render-per-page.md) |
| 0043 | In-app notifications: persistent, recipient-tagged, delivered live over SSE | Accepted | [`docs/adr/0043-in-app-notifications.md`](0043-in-app-notifications.md) |
| 0044 | Single HMAC secret signs invite, edit, and unlock tokens | Accepted | [`docs/adr/0044-single-hmac-secret-for-signed-tokens.md`](0044-single-hmac-secret-for-signed-tokens.md) |
| 0045 | SiteRoom broadcasts Yjs updates before autosave persistence completes | Accepted | [`docs/adr/0045-siteroom-broadcast-precedes-persistence.md`](0045-siteroom-broadcast-precedes-persistence.md) |
| 0046 | `addon_custom_scripts` is Owner-authored JavaScript; entitlement is the boundary | Accepted | [`docs/adr/0046-addon-custom-scripts-as-owner-code.md`](0046-addon-custom-scripts-as-owner-code.md) |
| 0047 | Editor WebSocket bearer travels in the URL query string | Accepted | [`docs/adr/0047-ws-token-in-query-for-editor-socket.md`](0047-ws-token-in-query-for-editor-socket.md) |
| 0048 | Chat session is last-writer-wins; concurrent tab writes out of scope | Accepted | [`docs/adr/0048-chat-session-last-writer-wins.md`](0048-chat-session-last-writer-wins.md) |

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
