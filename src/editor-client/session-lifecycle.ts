// src/editor-client/session-lifecycle.ts
//
// ADR 0058 Phase 2p.a — session-expired / access-revoked lifecycle.
// canvas-client.ts:1030-1138 (the "Save-busy + session-expired handling"
// block: sessionExpired / accessRevoked latches, setSaveBusy, the two
// 401/403 handlers, the access-removed modal, and authFetch) moves into
// this module as the Phase 3 cutover destination.
//
// Behavioural parity is pinned by the existing editor smokes against the
// production inline path; this module ships no sibling smoke (the bundle
// stays buildable but is dead code until createEditor is fleshed out).
//
// One function lives here as a public export:
//
//   - authFetchImpl(ctx, input, init) — same shape as the global `fetch`
//     but trips handleSessionExpired on 401 and handleAccessRevoked on
//     403, then throws "session expired" / "access revoked" so callers
//     skip their happy-path branches. Bound onto ctx.authFetch at boot;
//     the existing `ctx.authFetch` declaration (Phase 2h.2.d) carries the
//     signature.
//
// Three helpers stay private to this module — only authFetch reaches
// them, and the impl-pinning logic doesn't need to surface them on ctx:
//
//   - setSaveBusy(ctx, busy) — flip ctx.saveBusy (OR-ed with the two
//     latches so once either flips on, no setSaveBusy(false) can re-
//     enable the save button) and mirror onto ctx.saveButton.disabled.
//
//   - handleSessionExpired(ctx) — idempotent 401 latch. Flips
//     ctx.sessionExpired, locks save/AI/publish controls, status-flashes
//     "Session expired — reloading…", schedules a 1.5s page reload so
//     Clerk's handshake fires fresh on the next load. Multiple in-flight
//     401s collapse into a single reload because the early-exit on the
//     latch suppresses repeat work.
//
//   - handleAccessRevoked(ctx) — idempotent 403 latch. Flips
//     ctx.accessRevoked, locks save/AI/publish controls, status-flashes
//     "Access removed", and opens the access-removed modal. No auto-
//     reload — the user's Clerk session is still valid for other sites,
//     so a reload would just put them on the same editor with another
//     403. The modal CTAs (Back to dashboard) let them navigate away on
//     their own terms.
//
//   - showAccessRemovedModal() — DOM builder for the 403 modal. Renders
//     a backdrop + alertdialog with a single "Back to dashboard" link,
//     traps capture-phase keydowns inside the modal so Ctrl+Z / Ctrl+S
//     can't still mutate the (now read-only-server) canvas, and focuses
//     the CTA so keyboard users land on it immediately. Idempotent via
//     a `[data-opencanvas-access-removed]` querySelector probe — repeat
//     calls (e.g. a second 403 from a queued request) no-op.
//
// authFetch is the single entry point — every Owner-gated /api/* call
// routes through it. The two handlers must therefore be reachable only
// via authFetch's 401/403 branches; module-private declarations keep
// the contract enforced.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { DomContext, EditorContext, StatusEmitterContext } from './editor-context.js';

// ADR 0064 — setSaveBusy reads + writes the save-busy latch trio
// (saveBusy / sessionExpired / accessRevoked) and mirrors the result
// onto ctx.saveButton.disabled. None of the three latches ride a named
// canonical context yet, so they sit inline alongside the DomContext
// pick that supplies saveButton.
export type SessionLifecycleSaveBusyContext = Pick<DomContext, 'saveButton'> &
  Pick<EditorContext, 'saveBusy' | 'sessionExpired' | 'accessRevoked'>;

// ADR 0064 — the 401 / 403 handlers + authFetchImpl share one cluster
// shape: the save-busy latch surface (so the handler can call setSaveBusy
// directly) plus setStatus for the toast, setAiBusy for the AI-control
// lock, and publishButton for the publish lock. Exported for downstream
// reuse if save-wiring or another module needs to thread the same shape.
export type SessionLifecycleContext = SessionLifecycleSaveBusyContext &
  StatusEmitterContext &
  Pick<DomContext, 'publishButton'> &
  Pick<EditorContext, 'setAiBusy'>;

function setSaveBusy(ctx: SessionLifecycleSaveBusyContext, busy: boolean): void {
  ctx.saveBusy = busy || ctx.sessionExpired || ctx.accessRevoked;
  if (ctx.saveButton) (ctx.saveButton as HTMLButtonElement).disabled = ctx.saveBusy;
}

function handleSessionExpired(ctx: SessionLifecycleContext): void {
  if (ctx.sessionExpired) return;
  ctx.sessionExpired = true;
  ctx.setStatus('Session expired — reloading…', 'error');
  // Lock every mutating control. Reload happens in ~1.5s; idempotent so
  // multiple in-flight 401s collapse into a single reload.
  setSaveBusy(ctx, true);
  ctx.setAiBusy(true);
  if (ctx.publishButton) ctx.publishButton.disabled = true;
  setTimeout(() => {
    location.reload();
  }, 1500);
}

function handleAccessRevoked(ctx: SessionLifecycleContext): void {
  if (ctx.accessRevoked) return;
  ctx.accessRevoked = true;
  ctx.setStatus('Access removed', 'error');
  // Lock every mutating control. Unlike sessionExpired we do not auto-
  // reload — the user's Clerk session is still valid for other sites,
  // so a reload would just put them on the same editor with another
  // 403. The modal CTAs let them navigate away on their own terms.
  setSaveBusy(ctx, true);
  ctx.setAiBusy(true);
  if (ctx.publishButton) ctx.publishButton.disabled = true;
  showAccessRemovedModal();
}

function showAccessRemovedModal(): void {
  if (document.querySelector('[data-opencanvas-access-removed]')) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'opencanvas-modal-backdrop';
  backdrop.setAttribute('data-opencanvas-access-removed', 'true');
  const panel = document.createElement('div');
  panel.className = 'opencanvas-modal';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'opencanvas-access-removed-title');

  const title = document.createElement('h3');
  title.id = 'opencanvas-access-removed-title';
  title.textContent = 'Access removed';
  panel.appendChild(title);

  const body = document.createElement('p');
  body.textContent =
    'This site is no longer shared with you. Unsaved changes since your last successful save are lost. Sign out and back in to other shared sites if you need to verify which still grant you access.';
  body.style.margin = '8px 0 16px';
  panel.appendChild(body);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  actions.style.justifyContent = 'flex-end';

  const dashLink = document.createElement('a');
  dashLink.href = '/dashboard';
  dashLink.textContent = 'Back to dashboard';
  dashLink.style.padding = '8px 14px';
  dashLink.style.borderRadius = '6px';
  dashLink.style.background = '#111';
  dashLink.style.color = '#fff';
  dashLink.style.textDecoration = 'none';
  dashLink.style.fontWeight = '600';
  actions.appendChild(dashLink);

  panel.appendChild(actions);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  document.body.classList.add('opencanvas-modal-open');

  // Trap keyboard shortcuts so Ctrl+Z / Ctrl+S can't still mutate the
  // (now read-only-server) canvas while the modal is up. capture-phase
  // listener stops the events before the editor's window-level handler
  // sees them.
  function trap(e: KeyboardEvent): void {
    e.stopPropagation();
  }
  backdrop.addEventListener('keydown', trap, true);
  // Focus the only CTA so keyboard users land on it immediately.
  setTimeout(function () {
    dashLink.focus();
  }, 0);
}

export async function authFetchImpl(
  ctx: SessionLifecycleContext,
  input: RequestInfo,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401) {
    handleSessionExpired(ctx);
    throw new Error('session expired');
  }
  if (response.status === 403) {
    handleAccessRevoked(ctx);
    throw new Error('access revoked');
  }
  return response;
}
