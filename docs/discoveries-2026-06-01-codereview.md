# Discoveries — 2026-06-01 code review

Findings from a deep read of rev01's live source. Each entry: severity, the verified file:line, the user-facing or operator-facing impact, the direction a fix would take, and its current resolution.

**Triage outcome (2026-06-01):** of the 10 findings, 5 shipped behavioural fixes on `main`, 5 were lifted into Accepted ADRs or documented as path-specific trades, and 0 remain open. The proper long-term fix for H8 (retryable backfill from `form_submission` rows when the notif row is missing) is named as an ADR 0043 follow-up rather than a posture flip in the route.

---

## Critical

### C1 — Yjs broadcast precedes persistence  →  **ADR 0045 Accepted**
- **Where:** [src/live/site-room.ts:367-380](src/live/site-room.ts#L367-L380)
- **Resolution:** lifted into [ADR 0045](adr/0045-siteroom-broadcast-precedes-persistence.md) as a deliberate trade. The broadcast-before-persist ordering is correct for a live co-edit product; the loss-window after a failed persistence is bounded by the autosave debounce + DO eviction and the version-history checkpoint at publish time.

---

## High

### H1 — `UNLOCK_SIGNING_SECRET` spans three trust domains  →  **ADR 0044 Accepted**
- **Where:** [src/auth/edit-token.ts](src/auth/edit-token.ts), [src/password/cookie.ts](src/password/cookie.ts), [src/routes/api/collaborators.ts](src/routes/api/collaborators.ts), [src/live/socket-route.ts](src/live/socket-route.ts)
- **Resolution:** lifted into [ADR 0044](adr/0044-single-hmac-secret-for-signed-tokens.md) as a deliberate trade. The three signing classes share the same threat surface (Worker env, Wrangler deploy CLI, operator shell); splitting the secret only helps if exactly one leaks. The operational cost (three rotations, three runbooks, three mental models of which class uses which key) is not justified at the current product's threat-model + traffic shape.

### H2 — Custom domain registration CF/DB split-brain  →  **fixed in `51ae2d8`**
- **Where:** [src/custom-domain/register.ts:147](src/custom-domain/register.ts#L147)
- **Resolution:** `fix(custom-domain): roll back CF hostname on any DB error`. The CF custom-hostname is now torn down via a compensating cleanup wrapping the DB insert; the duplicate-key narrow path is generalised to "any DB error."

### H3 — Password gate blocks the on-site editor's WebSocket  →  **fixed in `12ed4dc`**
- **Where:** [src/routes/public.ts](src/routes/public.ts)
- **Resolution:** `fix(public): bypass password gate for /__live when wsToken is valid`. A valid edit-token on the upgrade URL now bypasses `requireUnlock`; the editor's live socket connects on password-protected sites.

### H4 — SVG upload is a stored XSS surface  →  **fixed in `72c3957`**
- **Where:** [src/assets/upload.ts](src/assets/upload.ts), [src/assets/read.ts](src/assets/read.ts)
- **Resolution:** `fix(assets): block svg uploads and set nosniff on asset reads`. `image/svg+xml` is rejected at upload; `X-Content-Type-Options: nosniff` is set on asset reads so existing-non-svg payloads cannot be MIME-sniffed into script context.

### H5 — Collaborator asset upload writes to the wrong customer  →  **fixed in `de27db7`**
- **Where:** [src/assets/route.ts](src/assets/route.ts), [src/routes/api/canvas.ts](src/routes/api/canvas.ts)
- **Resolution:** `fix(assets): scope upload customerId to site owner when siteId is supplied`. Collaborator uploads are now re-keyed to the site's owner-customer at write time so the canvas-save validator's owner-rooted-asset check (ADR 0004) admits them.

### H6 — `addon_custom_scripts` IS a publish-time XSS surface (by design)  →  **ADR 0046 Accepted**
- **Where:** [src/addons/registry.ts:69-92](src/addons/registry.ts#L69-L92), [src/addons/emit.ts:15-63](src/addons/emit.ts#L15-L63), [src/routes/public.ts:1088](src/routes/public.ts#L1088)
- **Resolution:** lifted into [ADR 0046](adr/0046-addon-custom-scripts-as-owner-code.md) as a deliberate feature. Same-origin Owner-self-script is the contract every comparable site builder ships; entitlement at emit (`src/addons/emit.ts:15-63`) is the actual security boundary.

### H7 — Server-side agent apply DOES write `editableState`  →  **fixed in `91f9de1`**
- **Where:** [src/routes/api/canvas-agent.ts](src/routes/api/canvas-agent.ts)
- **Resolution:** `fix(canvas-agent): broadcast editable-state-replaced after apply`. The agent-apply path now broadcasts the new state via SiteRoom so connected editors do not clobber the apply on next save. The shape mirrors the publish path's `editable-state-replaced` message.

### H8 — Forms swallow email failure but return success to visitor  →  **closed: path-specific posture, follow-up named**
- **Where:** [src/forms/route.ts:117-158](src/forms/route.ts#L117-L158)
- **Resolution:** the writer's `f44eacc` tightening (fail-loud on email + DO push) is correct for admin-action routes (collaborators, publish) where the actor wants 5xx-on-notif-failure feedback. The form-submission path is the deliberate carve-out: the actor is a Visitor whose contract is "the form submission landed" — surfacing a writer throw as a visitor 500 would loop them through a resubmit, double the `form_submission` row count, AND still miss the Owner notif. Comment in `src/forms/route.ts:106-120` documents the trade-off and cross-references this dossier. The long-term fix (retryable backfill from `form_submission` rows when the notif row is missing) is named in ADR 0043's Follow-ups rather than as a posture flip in the route.

### H9 — Concurrent chat writes race  →  **ADR 0048 Accepted**
- **Where:** [src/agent/chat/session.ts:218-220](src/agent/chat/session.ts#L218-L220)
- **Resolution:** lifted into [ADR 0048](adr/0048-chat-session-last-writer-wins.md) as a deliberate trade. The lost-message failure mode is bounded to power-user multi-tab usage; the schema migration to a versioned compare-and-swap is named in the ADR's Follow-ups as a one-line lift when usage data demands it.

---

## Things I got factually wrong (carryovers)

- Memory `chat_concurrency_boundary` overstated "recording is sequential" (see H9 — last-writer-wins is the real contract).
- Prior framing on agent apply as preview-only contradicted by route header (see H7 — fixed in `91f9de1`).
- Prior framing on Yjs autosave loss window was off by an order of magnitude (see C1 / ADR 0045).
- Prior framing on "addons are curated, not Owner code" was wrong for `custom_scripts` (see H6 / ADR 0046).

---

## Triage notes (post-resolution)

- The 5 behavioural fixes (H2/H3/H4/H5/H7) shipped same day as the dossier landed.
- 4 findings (C1, H1, H6, H9) closed by ADRs (0045, 0044, 0046, 0048) that ratify the existing as-built contract. Three of these (C1, H1, H6) reject the original fix-direction sketch; H9 defers the schema CAS migration under a named shape.
- H8 closed by documenting the path-specific posture in `src/forms/route.ts` and naming the retryable-backfill follow-up in ADR 0043.
- The original framings of C1, H1, H6, H8, and H9 read the code in isolation and identified failure modes correctly; what they missed was that the failure modes were *deliberate trades* documented (or now documented) elsewhere. That class of audit blind-spot is itself a process finding worth keeping.
