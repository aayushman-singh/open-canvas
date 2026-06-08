// src/editor-client/collection-scaffold.ts
//
// ADR 0063 Decision 11 — surfaces the "+ New Collection" wizard from the
// editor's Pages sidebar.
//
// The backend endpoint POST /api/sites/:siteId/collections (see
// src/routes/api/collections.ts) atomically creates an index page +
// template page + two seed entries in one round-trip. The editor button
// mounted at #canvas-add-collection collects the slug, calls the endpoint,
// and on success refreshes the editor's local state from the server (so
// the new pages appear in the sidebar list and the active page switches
// to the freshly-minted index page).
//
// Design notes:
//   - The wizard pre-computes the default slug client-side so the prompt's
//     default value (`'blog'`, falling back to `collection-1`/`-2`/... if
//     blog is taken locally) is one keystroke away from acceptance. The
//     Owner can edit it before confirming. The server re-resolves the
//     slug against its own snapshot — local pre-computation is a UX
//     affordance, not a validation gate.
//   - On success we flushPendingSave first so any in-flight local edits
//     land on the server BEFORE we overwrite ctx.state with the server's
//     snapshot. Skipping the flush would clobber unsaved work — fail-loud
//     per CLAUDE.md no-fallbacks rule means we surface the flush-failed
//     status before bailing.
//   - Errors are surfaced through ctx.setStatus(... 'error') so the
//     existing toast-style status line carries the message. The editor
//     does not have a separate "toast" surface; setStatus IS the toast.
//   - The server response includes `indexPageId` directly so we no longer
//     have to re-derive page identity from id-format conventions.
//   - Two seams are extracted for testability:
//       1. `runCollectionScaffoldFlowImpl(ctx)` — the full wizard logic
//          (prompt → POST → refresh → activate). Exercised by the smoke
//          with a mocked ctx that captures fetch payloads and status calls.
//       2. `attachCollectionScaffoldButtonImpl(ctx)` — installs the click
//          handler on #canvas-add-collection. Wired from createEditor in
//          src/editor-client/index.ts alongside the existing
//          canvas-add-page wiring.

import type { EditorContext, StatusEmitterContext } from './editor-context.js';
import type { CanvasPage, EditableSite } from '../canvas/schema.js';
import { WIZARD_DEFAULT_SLUG } from '../canvas/collections-scaffold.js';

// ADR 0064 — collection-scaffold's wizard touches one canonical cluster
// (StatusEmitterContext for the toast surface) plus a grab bag of
// persist/state/render/page-navigation/modal verbs. The canonical
// StateContext / RenderContext / PersistContext aliases would each pull
// in members the wizard never reads (findElement, renderInspector,
// captureForUndo, etc.); declaring the surface as a single inline `Pick`
// keeps the smoke's mock ctx (collection-scaffold.smoke.ts) at exactly
// the 13 fields the wizard actually exercises. Exported because the
// smoke imports it as the mock ctx's structural shape.
export type CollectionScaffoldCtx = StatusEmitterContext &
  Pick<
    EditorContext,
    | 'apiBase'
    | 'siteId'
    | 'siteBase'
    | 'state'
    | 'authFetch'
    | 'openTextModal'
    | 'flushPendingSave'
    | 'migrateState'
    | 'setActivePage'
    | 'panToPage'
    | 'renderAll'
    | 'updatePageSidebar'
  >;

/** Slug rule mirrors `SLUG_RE` in src/canvas/collections-scaffold.ts so the
 *  client surfaces the same rejection the server would emit, without a round
 *  trip. The server is still the source of truth — server-side validation
 *  remains the gate. */
const CLIENT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/** Mirror of `slugIsTaken` from src/canvas/collections-scaffold.ts. Used
 *  only to pick a sensible default for the prompt's pre-filled value; the
 *  server re-resolves authoritatively. Conservative — checks page slugs,
 *  page-level collectionSlug bindings, and the template/seed-entry slug
 *  shapes the scaffold will produce. */
function clientSlugIsTaken(pages: readonly CanvasPage[], slug: string): boolean {
  const templatePageSlug = `${slug}/_template`;
  const seedSlugs = [
    `${slug}/welcome-to-your-blog`,
    `${slug}/your-second-post`,
  ];
  for (const page of pages) {
    if (!page) continue;
    if (page.slug === slug) return true;
    if (page.slug === templatePageSlug) return true;
    if (seedSlugs.includes(page.slug)) return true;
    if (page.collectionSlug === slug) return true;
  }
  return false;
}

/** Compute the default slug to pre-fill the prompt with. Mirrors the
 *  server's `resolveAvailableSlug`: tries `'blog'`, then `collection-1`,
 *  `collection-2`, ... up to N. Returns the empty string if state is
 *  unavailable; the caller surfaces an error in that case. */
function pickDefaultSlugClientSide(state: EditableSite | null): string {
  if (state === null) return WIZARD_DEFAULT_SLUG;
  if (!clientSlugIsTaken(state.pages, WIZARD_DEFAULT_SLUG)) {
    return WIZARD_DEFAULT_SLUG;
  }
  for (let i = 1; i <= 99; i += 1) {
    const candidate = `collection-${i}`;
    if (!clientSlugIsTaken(state.pages, candidate)) return candidate;
  }
  // Exhausted: the server will fail with the pool-exhausted 409. Returning
  // WIZARD_DEFAULT_SLUG here is fine — the server's failure surfaces
  // through the existing error toast path; we don't silently substitute.
  return WIZARD_DEFAULT_SLUG;
}

function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown';
}

/** GET the current site state and re-seat ctx.state. Pulled out so the
 *  smoke can assert that a successful POST is followed by exactly one
 *  refresh request against ctx.siteBase. */
async function refreshSiteState(ctx: CollectionScaffoldCtx): Promise<EditableSite | null> {
  const response = await ctx.authFetch(ctx.siteBase);
  if (!response.ok) {
    ctx.setStatus(
      'Collection created but failed to refresh editor (' + response.status + ')',
      'error',
    );
    return null;
  }
  const body = (await response.json()) as {
    editableState?: EditableSite;
  };
  if (
    !body ||
    typeof body !== 'object' ||
    !body.editableState ||
    typeof body.editableState !== 'object' ||
    !Array.isArray(body.editableState.pages)
  ) {
    ctx.setStatus(
      'Collection created but server response was malformed (refresh skipped)',
      'error',
    );
    return null;
  }
  return ctx.migrateState(body.editableState);
}

/** Confirm that the page id the server returned in the POST response is
 *  actually present in the freshly refreshed editor state. The server is
 *  the source of truth for the id; this guards against the (unlikely) race
 *  where the refresh GET returned a stale snapshot that pre-dates the POST.
 *  Returns the id when present, null otherwise. */
function confirmIndexPageId(state: EditableSite, indexPageId: string): string | null {
  for (const page of state.pages) {
    if (page && page.id === indexPageId) return page.id;
  }
  return null;
}

/** Full wizard logic — prompt the Owner for a slug, POST to the scaffold
 *  endpoint, refresh local state, and switch the active page to the new
 *  index. Exposed (not just attached) so the smoke can exercise it
 *  without driving a real DOM. */
export async function runCollectionScaffoldFlowImpl(
  ctx: CollectionScaffoldCtx,
): Promise<void> {
  // ADR 0063 dec 11 §a — surface the available slug as the prompt's
  // pre-filled default so the Owner can hit Enter to accept, or rename
  // before confirming. Computed client-side from ctx.state; the server
  // re-resolves authoritatively (no fallback inside the wizard).
  const defaultSlug = pickDefaultSlugClientSide(ctx.state);
  const promptedSlug = await ctx.openTextModal({
    title: 'New collection',
    label:
      'Slug (e.g. "blog", "case-studies"). Pages, the URL path, and the entries tab all use this. Rename if you prefer something else.',
    defaultValue: defaultSlug,
    placeholder: 'blog',
  });
  if (promptedSlug === null) return;
  const slug = promptedSlug.trim().toLowerCase();
  if (slug.length === 0) {
    ctx.setStatus('Collection slug is required', 'error');
    return;
  }
  if (!CLIENT_SLUG_RE.test(slug)) {
    ctx.setStatus(
      'Slug must be 1..80 lowercase letters, digits, or dashes (no leading/trailing dash)',
      'error',
    );
    return;
  }

  // Flush any pending in-flight edits so the server's snapshot we're
  // about to refetch carries them. Without this we'd overwrite local
  // unsaved work when we re-seat ctx.state below.
  const flushed = await ctx.flushPendingSave();
  if (!flushed) {
    ctx.setStatus('Save pending edits before creating a collection', 'error');
    return;
  }

  ctx.setStatus('Creating collection "' + slug + '"…', 'info');

  let response: Response;
  try {
    response = await ctx.authFetch(
      ctx.apiBase + '/sites/' + ctx.siteId + '/collections',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      },
    );
  } catch (err: unknown) {
    ctx.setStatus('Create collection failed: ' + errorToString(err), 'error');
    return;
  }

  if (!response.ok) {
    let serverMessage = '';
    try {
      const body = (await response.json()) as { error?: string };
      if (body && typeof body.error === 'string') serverMessage = body.error;
    } catch {
      // body wasn't JSON; surface the HTTP code instead
    }
    ctx.setStatus(
      'Create collection failed: ' + (serverMessage || 'HTTP ' + response.status),
      'error',
    );
    return;
  }

  // Read the 201 body — the server returns the resolved slug (which may
  // differ from `slug` if the server walked the fallback pool) and the
  // index page id directly, so we don't have to re-derive page identity
  // from the id format convention.
  let createdSlug = slug;
  let createdIndexPageId: string | null = null;
  try {
    const body = (await response.json()) as {
      collectionSlug?: unknown;
      indexPageId?: unknown;
    };
    if (typeof body.collectionSlug === 'string' && body.collectionSlug.length > 0) {
      createdSlug = body.collectionSlug;
    }
    if (typeof body.indexPageId === 'string' && body.indexPageId.length > 0) {
      createdIndexPageId = body.indexPageId;
    }
  } catch {
    // 201 with non-JSON body would be a server bug; carry on with the
    // slug the client supplied. The refresh step below still re-seats
    // ctx.state correctly regardless.
  }

  // POST succeeded. Refresh the editor's local state so the new pages
  // appear in the sidebar list and the active page can switch to the
  // freshly-minted index page.
  const refreshed = await refreshSiteState(ctx);
  if (!refreshed) return;
  ctx.state = refreshed;
  ctx.renderAll();
  ctx.updatePageSidebar();
  // Switch active page to the freshly-minted index. Prefer the id the
  // server returned; fall back to the id-format convention if absent.
  const targetPageId =
    createdIndexPageId !== null
      ? confirmIndexPageId(refreshed, createdIndexPageId)
      : confirmIndexPageId(refreshed, 'page-collection-' + createdSlug + '-index');
  if (targetPageId !== null) {
    ctx.setActivePage(targetPageId);
    // Newly-minted collection index page — pan so the freshly-created
    // page lands in view. setActivePage is camera-pure; explicit nav
    // opts in.
    ctx.panToPage(targetPageId);
  }
  ctx.setStatus('Created collection "' + createdSlug + '"', 'ok');
}

/** Wire every element carrying `data-canvas-add-collection` to the
 *  scaffold flow. Mirrors the canvas-add-page wiring at
 *  src/editor-client/index.ts:754-759 but selects by data attribute so
 *  multiple entry points (Pages tab, Add tab, future surfaces) share one
 *  handler without duplicating the flow. No-op when no buttons are
 *  present (smokes, edit-token surfaces without the sidebar, etc.). */
export function attachCollectionScaffoldButtonImpl(ctx: CollectionScaffoldCtx): void {
  const buttons = document.querySelectorAll('[data-canvas-add-collection]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      void runCollectionScaffoldFlowImpl(ctx);
    });
  });
}
