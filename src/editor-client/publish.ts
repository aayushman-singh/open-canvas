// src/editor-client/publish.ts
//
// ADR 0058 Phase 2q.j — publish flow + version badge update.
// canvas-client.ts:13321-13326 (updateVersionBadge),
// canvas-client.ts:13434-13516 (publishSite),
// canvas-client.ts:13518-13523 (attachPublishButton) carry the inline
// twins. All three retire on ADR 0015 Phase 3 atomic cutover; until
// then, the inline IIFE is the production source-of-truth and this
// module is dead code.
//
// Three functions live here:
//
//   - updateVersionBadgeImpl(ctx, version) — write the "vN" / "Draft"
//     label and the data-version attribute onto ctx.versionBadge.
//     Falls back to 0 ("Draft") for non-finite inputs (boot guard).
//
//   - publishSiteImpl(ctx) — Owner-only publish flow.
//     1. flushPendingSave so the publish reflects the latest local
//        edits (no silent stale-state publishing).
//     2. POST /publish/sites/<id>. Non-OK responses surface their
//        detail in the status line AND through an alert modal (the
//        status flash is too quiet for an actionable failure).
//     3. On success, update the version badge, mark the versions
//        sidebar list as stale (so the next render re-fetches), and
//        open a confirm modal with "View live site" / "Continue
//        editing" — the Owner-friendly successor to the 4-second
//        status flash that was easy to miss.
//     Pending modals (publish-success or publish-failure) are wrapped
//     in try/catch because openConfirmModal/openAlertModal throw when
//     another modal is open; that's intentional — the status line
//     already carries the outcome so the swallowed modal exception is
//     a "best-effort UX upgrade", not a failure mode.
//
//   - attachPublishButtonImpl(ctx) — wire the publish-button click to
//     publishSite. Idempotent at boot; the click handler dispatches
//     through ctx.publishSite (not the local impl) so the cutover can
//     swap in a wrapper without rebinding.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type {
  DomContext,
  EditorContext,
  PersistContext,
  StatusEmitterContext,
} from './editor-context.js';

// ADR 0064 — updateVersionBadgeImpl only touches the cached `versionBadge`
// DOM ref, so it rides DomContext alone. No verbs, no state queries, no
// status emission — the narrowest surface in this module.
export type UpdateVersionBadgeContext = DomContext;

// ADR 0064 — publishSiteImpl is the wide one: DomContext for the cached
// `publishButton` + `sidebar` + `versionBadge` refs, PersistContext for
// the auth-wrapped POST identity (authFetch + apiBase + siteId), and
// StatusEmitterContext for the in-flight + outcome status flashes. The
// inline `Pick` carries the publish-specific verbs / flags (modal pair,
// session-kill sentinels, save flush, versions-panel refresh, badge
// update, versions cache flag) that have no canonical alias.
export type PublishSiteContext = DomContext &
  PersistContext &
  StatusEmitterContext &
  Pick<
    EditorContext,
    | 'flushPendingSave'
    | 'accessRevoked'
    | 'sessionExpired'
    | 'openAlertModal'
    | 'openConfirmModal'
    | 'updateVersionBadge'
    | 'versionsLoaded'
    | 'renderVersionsPanel'
  >;

// ADR 0064 — attachPublishButtonImpl wires one DOM ref (`publishButton`)
// to one verb (`publishSite`); DomContext + a single inline Pick is the
// honest surface. Dispatching through ctx.publishSite (not the local
// impl) preserves the cutover wrapper hook.
export type AttachPublishButtonContext = DomContext &
  Pick<EditorContext, 'publishSite'>;

export function updateVersionBadgeImpl(
  ctx: UpdateVersionBadgeContext,
  version: number,
): void {
  if (!ctx.versionBadge) return;
  const n = typeof version === 'number' && Number.isFinite(version) ? version : 0;
  ctx.versionBadge.setAttribute('data-version', String(n));
  ctx.versionBadge.textContent = n > 0 ? 'v' + n : 'Draft';
}

export async function publishSiteImpl(ctx: PublishSiteContext): Promise<void> {
  if (!ctx.publishButton) return;
  ctx.publishButton.disabled = true;
  try {
    const saved = await ctx.flushPendingSave();
    if (!saved) return;
    ctx.setStatus('Publishing...');
    const response = await ctx.authFetch(
      ctx.apiBase + '/publish/sites/' + ctx.siteId,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      },
    );
    if (ctx.accessRevoked || ctx.sessionExpired) return;
    const body = (await response.json().catch(() => null)) as
      | {
          version?: number;
          errors?: string[];
          missingAssetIds?: string[];
          error?: string;
          // ADR 0063 F-publish-warnings — non-fatal warnings emitted by
          // the collection materializer (zero-entry / unbound / empty-
          // folder Collections). Always present on success; empty array
          // on a clean publish.
          warnings?: string[];
        }
      | null;
    if (!response.ok) {
      let detail: string = response.statusText;
      if (body && Array.isArray(body.errors) && body.errors.length > 0) {
        detail = body.errors[0]!;
      } else if (
        body &&
        Array.isArray(body.missingAssetIds) &&
        body.missingAssetIds.length > 0
      ) {
        detail = 'missing assets: ' + body.missingAssetIds.join(', ');
      } else if (body && body.error) {
        detail = body.error;
      }
      ctx.setStatus('Publish failed', 'error');
      // Modal surface — same reasoning as the AI-preview path: the
      // status-line flash is too quiet for a failure the Owner needs to act
      // on (fix the issue, then re-publish).
      try {
        await ctx.openAlertModal({ title: 'Publish failed', message: detail });
      } catch (_) {
        /* another modal was open; status line still has it */
      }
      return;
    }
    const versionSuffix =
      body && typeof body.version === 'number' && Number.isFinite(body.version)
        ? ' v' + body.version
        : '';
    // ADR 0063 F-publish-warnings — surface materializer warnings on
    // success. CLAUDE.md fail-loud: a Collection that publishes with
    // zero cards is a configuration error the Owner must see, not a
    // silent skip. Status line carries the count; each warning is
    // console.warn'd verbatim so the Owner can copy them from devtools
    // into a bug report. The structured array remains in the JSON
    // response body for future inspector-side surfacing (post-F5 work).
    const publishWarnings = body && Array.isArray(body.warnings) ? body.warnings : [];
    const warningSuffix =
      publishWarnings.length > 0
        ? ' (' + String(publishWarnings.length) + ' warning' + (publishWarnings.length === 1 ? '' : 's') + ')'
        : '';
    ctx.setStatus('Published' + versionSuffix + warningSuffix, 'ok');
    if (publishWarnings.length > 0) {
      for (const line of publishWarnings) {
        console.warn('[publish:warning]', line);
      }
    }
    if (body && typeof body.version === 'number') {
      ctx.updateVersionBadge(body.version);
    }

    // Refresh Versions sidebar panel so the new snapshot is visible without
    // a page reload. Invalidate the cache flag always; repaint only if the
    // panel is currently visible (otherwise the next tab-click triggers a
    // fresh fetch via activateSidebarTab).
    ctx.versionsLoaded = false;
    const versionsPanel = ctx.sidebar
      ? ctx.sidebar.querySelector<HTMLElement>('[data-sidebar-panel="versions"]')
      : null;
    if (versionsPanel && !versionsPanel.hidden) {
      ctx.renderVersionsPanel();
    }

    // Publish-success modal — gives the Owner an explicit "View live site"
    // exit (opens published URL in new tab + leaves editor) and an
    // unambiguous "Continue editing" path that just dismisses. Replaces the
    // 4-second status-line flash that was easy to miss.
    const addrEl = document.querySelector('.opencanvas-editor-header .address');
    const publishedHost = addrEl && addrEl.textContent ? addrEl.textContent.trim() : '';
    const modalTitle = 'Published' + versionSuffix;
    const modalMessage = publishedHost
      ? publishedHost +
        ' is live.\\nVisitors with the page open see your changes without refreshing.'
      : 'Your site is live. Visitors with the page open see your changes without refreshing.';
    try {
      const openLive = await ctx.openConfirmModal({
        title: modalTitle,
        message: modalMessage,
        confirmLabel: 'View live site',
        cancelLabel: 'Continue editing',
      });
      if (openLive && publishedHost) {
        window.open('https://' + publishedHost, '_blank');
        window.location.href = '/dashboard';
      }
    } catch (_) {
      // Another modal was already open; the status line still announced
      // success so the Owner is not left without feedback.
    }
  } catch (err) {
    if (!ctx.accessRevoked && !ctx.sessionExpired) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.setStatus('Publish failed: ' + message, 'error');
    }
  } finally {
    if (!ctx.accessRevoked && !ctx.sessionExpired) ctx.publishButton.disabled = false;
  }
}

export function attachPublishButtonImpl(ctx: AttachPublishButtonContext): void {
  if (!ctx.publishButton) return;
  ctx.publishButton.addEventListener('click', () => {
    void ctx.publishSite();
  });
}
