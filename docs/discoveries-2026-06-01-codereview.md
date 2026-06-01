# Discoveries — 2026-06-01 code review

Findings from a deep read of rev01's live source. Each entry: severity, the verified file:line, the user-facing or operator-facing impact, and the direction a fix would take. Nothing committed against these yet — captured here so they don't drift before triage.

---

## Critical

### C1 — Yjs broadcast precedes persistence
- **Where:** [src/live/site-room.ts:367-380](src/live/site-room.ts#L367-L380)
- **Impact:** SiteRoom fans out updates to all connected editors before autosave knows whether the DB write succeeded. Peers can observe state that never persisted. If the DB write throws, the peers don't roll back. Prior "750ms loss window" framing was wrong by an order of magnitude.
- **Fix direction:** broadcast-after-persist OR an explicit rollback message peers must apply on DB failure. Either way the contract needs to be ordered, not optimistic.

---

## High

### H1 — `UNLOCK_SIGNING_SECRET` spans three trust domains
- **Where:** [src/auth/edit-token.ts:36](src/auth/edit-token.ts#L36), [src/password/cookie.ts:73](src/password/cookie.ts#L73), [src/routes/api/collaborators.ts:76](src/routes/api/collaborators.ts#L76)
- **Impact:** One key signs visitor unlock cookies, collaborator invite JWTs, and editor session tokens. One leak → full takeover of visitor unlock + editor + invite-acceptance for every site.
- **Fix direction:** three separate signing secrets (`PUBLIC_UNLOCK_SIGNING_SECRET`, `INVITE_TOKEN_SIGNING_SECRET`, `EDIT_TOKEN_SIGNING_SECRET`) with a rotation story.

### H2 — Custom domain registration CF/DB split-brain
- **Where:** [src/custom-domain/register.ts:147](src/custom-domain/register.ts#L147)
- **Impact:** `cf.create` runs before the DB insert; cleanup only on the duplicate-key branch. A non-unique DB error rethrows with a live CF custom-hostname dangling. Two-system rollback bug.
- **Fix direction:** invert the order (DB first, CF after) or wrap with a compensating cleanup that catches any DB error and tears down the CF resource.

### H3 — Password gate blocks the on-site editor's WebSocket
- **Where:** [src/routes/public.ts:829](src/routes/public.ts#L829) (editor bypass) vs [src/routes/public.ts:863](src/routes/public.ts#L863) (`/__live` behind `requireUnlock`)
- **Impact:** On password-protected sites, the editor renders but its socket gets gated. The Owner sees a working editor that silently can't sync — a confusing failure mode the editor itself does not surface.
- **Fix direction:** carve `/__live` out of the password gate when the request carries a valid edit token, OR surface a "this site is password-protected; the gate also closes the live socket" banner in the editor when ws connect fails after handshake.

### H4 — SVG upload is a stored XSS surface
- **Where:** [src/assets/upload.ts:103](src/assets/upload.ts#L103) (accepts any `image/*`), [src/assets/hash.ts:64](src/assets/hash.ts#L64) (maps `image/svg+xml` → `.svg`), [src/assets/read.ts:125](src/assets/read.ts#L125) (streams stored content type back).
- **Impact:** An SVG with embedded `<script>` executes when served at `/assets/...` on the same origin as the editor. Owner-uploaded asset → editor-origin XSS.
- **Fix direction:** reject `image/svg+xml` at the upload boundary, OR sanitise via DOMPurify-equivalent and re-encode, OR serve SVGs from a sandboxed asset subdomain with `Content-Security-Policy: sandbox`.

### H5 — Collaborator asset upload writes to the wrong customer
- **Where:** asset upload derives `customerId` from the authenticated user ([src/assets/route.ts:34](src/assets/route.ts#L34)); canvas save validates `ownerAsset.customerId` against the site owner ([src/routes/api/canvas.ts:252](src/routes/api/canvas.ts#L252)).
- **Impact:** Collaborator uploads succeed but become unreferenceable in the site they were uploaded for. Owner-rooted asset model (ADR 0004) is correct in spec; the collaborator path violates it.
- **Fix direction:** route the upload through the site's owner-customer (re-key the row to the owner at write time), OR change the canvas validator to accept collaborator-rooted assets when the collaborator has write access to the site.

### H6 — `addon_custom_scripts` IS a publish-time XSS surface (by design)
- **Where:** [src/addons/registry.ts:69-92](src/addons/registry.ts#L69-L92) advertises "Paste any `<script>`"; visitor render injects with `raw(...)` at [src/routes/public.ts:1088](src/routes/public.ts#L1088).
- **Impact:** This one specific addon IS Owner code injection. Prior "addons are curated, not Owner code" framing was wrong. The defensible answer is "it's gated by Addon Entitlement, the Owner authored it for their own site" — not "we control the emitters."
- **Fix direction:** document the trust model in an ADR (Owner is trusted on their own site; entitlement gate is the only check). Audit other addon-emitter pathways to confirm the rest of them really are curated.

### H7 — Server-side agent apply DOES write `editableState` directly
- **Where:** [src/routes/api/canvas-agent.ts:13](src/routes/api/canvas-agent.ts#L13) — route header says POST `/apply` "writes the new editableState." No SiteRoom binding in this file.
- **Impact:** Prior "preview-only, client decides to apply" framing was contradicted by the route's own comment. This is exactly the failure mode [src/routes/api/canvas.ts:364](src/routes/api/canvas.ts#L364) warns about — direct DB writes without SiteRoom broadcast cause connected editors to clobber the change on next save.
- **Fix direction:** route agent applies through SiteRoom (broadcast then persist, per C1's fix) OR make agent apply preview-only and require the client to accept-and-broadcast.

### H8 — Forms swallow email failure but return success to visitor
- **Where:** [src/forms/route.ts:117-158](src/forms/route.ts#L117-L158) — the legacy owner-email block (now superseded by ADR 0043 notif fan-out at the same spot).
- **Impact:** The exact silent-degraded-mode CLAUDE.md forbids. Owner thinks no submission happened; visitor thinks it did.
- **Note:** the ADR 0043 Phase B replacement preserves the same swallow-and-log shape (`form_submission` notif write failure → log, return visitor success). The design tension is real: failing the visitor's request because the owner-notif failed produces resubmits + duplicate rows. The current posture chooses the lesser evil but does not eliminate it.
- **Fix direction:** treat the notif row + email separately. INSERT-fail of the notif row could be retryable from the form_submission row (the form_submission row is the truth; a backfill job can regenerate missing notifs). Email failure stays best-effort.

### H9 — Concurrent chat writes race
- **Where:** [src/agent/chat/session.ts:211](src/agent/chat/session.ts#L211) — plain `UPDATE chat_session SET messages = ... WHERE id = ...` whole-row replace; no version, no lock, no CAS.
- **Impact:** Memory `chat_concurrency_boundary` claimed "recording is sequential." Schema does not enforce it — two concurrent agent calls can lose a message turn.
- **Fix direction:** add a `version` column + optimistic CAS, OR append-only messages table, OR pessimistic row lock in the persistence path.

---

## Things I got factually wrong (carryovers)

*(User's note cut off mid-sentence; placeholder until full list is supplied.)*

- Memory `chat_concurrency_boundary` overstated "recording is sequential" (see H9).
- Memory / prior framing on agent apply as preview-only contradicted by route header (see H7).
- Prior framing on Yjs autosave loss window was off by an order of magnitude (see C1).
- Prior framing on "addons are curated, not Owner code" was wrong for `custom_scripts` (see H6).

---

## Triage notes

- C1 + H7 are the same architectural mistake (broadcast/persist ordering) at two routes; a single fix can close both.
- H1, H4, H6 are the security-cluster — they belong in one threat-model review before any new auth surface ships.
- H2 + H5 are atomicity bugs (DB vs external state). The notif writer (ADR 0043) leans on the same pattern; verify it does not introduce a new split-brain.
- H8 overlaps with the just-landed ADR 0043 Phase B. Re-read the form_submission notif write with this finding in mind before flipping ADR 0043 Accepted in Phase G.
