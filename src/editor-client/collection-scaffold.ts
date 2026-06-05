// src/editor-client/collection-scaffold.ts
//
// ADR 0060 F3 — surfaces the "+ New collection" wizard from the editor's
// Pages sidebar.
//
// The backend endpoint POST /api/sites/:siteId/collections (see
// src/routes/api/collections.ts) creates an index page + template page +
// sample entry triple in one round-trip. The editor button mounted at
// #canvas-add-collection collects the slug, calls the endpoint, and on
// success refreshes the editor's local state from the server (so the
// new pages appear in the sidebar list and the active page can switch to
// the freshly-minted index page).
//
// Design notes:
//   - The wizard is intentionally minimal — just a slug prompt. The
//     scaffold endpoint derives the human title from the slug
//     (`titleCase('blog')` → 'Blog'), so a separate name field would
//     double-bookkeep the same string. If we later want a richer wizard
//     we extend collections-scaffold.ts to take a name override.
//   - On success we flushPendingSave first so any in-flight local edits
//     land on the server BEFORE we overwrite ctx.state with the server's
//     snapshot. Skipping the flush would clobber unsaved work — fail-loud
//     per CLAUDE.md no-fallbacks rule means we surface the flush-failed
//     status before bailing.
//   - Errors are surfaced through ctx.setStatus(... 'error') so the
//     existing toast-style status line carries the message. The editor
//     does not have a separate "toast" surface; setStatus IS the toast.
//   - Two seams are extracted for testability:
//       1. `runCollectionScaffoldFlowImpl(ctx)` — the full wizard logic
//          (prompt → POST → refresh → activate). Exercised by the smoke
//          with a mocked ctx that captures fetch payloads and status calls.
//       2. `attachCollectionScaffoldButtonImpl(ctx)` — installs the click
//          handler on #canvas-add-collection. Wired from createEditor in
//          src/editor-client/index.ts alongside the existing
//          canvas-add-page wiring.

import type { EditorContext } from './editor-context.js';
import type { EditableSite } from '../canvas/schema.js';

/** Subset of EditorContext the wizard actually depends on. Carrying the
 *  narrow shape — instead of leaning on the full EditorContext — keeps
 *  the smoke's mock ctx small (otherwise the smoke has to populate ~150
 *  unrelated ctx fields, see inspector-actions.smoke.ts for the cost). */
export interface CollectionScaffoldCtx {
  apiBase: string;
  siteId: string;
  siteBase: string;
  state: EditableSite | null;
  authFetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
  openTextModal(opts: {
    title?: string | undefined;
    label?: string | undefined;
    defaultValue?: string | undefined;
    placeholder?: string | undefined;
  }): Promise<string | null>;
  setStatus(text: string, tone?: 'ok' | 'error' | 'info'): void;
  flushPendingSave(): Promise<boolean>;
  migrateState(state: EditableSite): EditableSite;
  setActivePage(pageId: string | null): void;
  renderAll(): void;
  updatePageSidebar(): void;
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

/** Full wizard logic — prompt the Owner for a slug, POST to the scaffold
 *  endpoint, refresh local state, and switch the active page to the new
 *  index. Exposed (not just attached) so the smoke can exercise it
 *  without driving a real DOM. */
export async function runCollectionScaffoldFlowImpl(
  ctx: CollectionScaffoldCtx,
): Promise<void> {
  const promptedSlug = await ctx.openTextModal({
    title: 'New collection',
    label:
      'Slug (e.g. "blog", "case-studies"). Pages, the URL path, and the entries tab all use this.',
    placeholder: 'blog',
  });
  if (promptedSlug === null) return;
  const slug = promptedSlug.trim().toLowerCase();
  if (slug.length === 0) {
    ctx.setStatus('Collection slug is required', 'error');
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

  let created: { indexPageId?: unknown; templatePageId?: unknown };
  try {
    created = (await response.json()) as { indexPageId?: unknown; templatePageId?: unknown };
  } catch (err: unknown) {
    ctx.setStatus(
      'Collection created but server response was malformed: ' + errorToString(err),
      'error',
    );
    return;
  }
  if (typeof created.indexPageId !== 'string' || created.indexPageId.length === 0) {
    ctx.setStatus(
      'Collection created but server response was missing indexPageId',
      'error',
    );
    return;
  }
  if (typeof created.templatePageId !== 'string' || created.templatePageId.length === 0) {
    ctx.setStatus(
      'Collection created but server response was missing templatePageId',
      'error',
    );
    return;
  }

  // POST succeeded. Refresh the editor's local state so the new pages
  // appear in the sidebar list and the active page can switch to the
  // freshly-minted index page.
  const refreshed = await refreshSiteState(ctx);
  if (!refreshed) return;
  ctx.state = refreshed;
  ctx.renderAll();
  ctx.updatePageSidebar();
  if (!refreshed.pages.some((page) => page && page.id === created.indexPageId)) {
    ctx.setStatus(
      'Collection created but refreshed state did not include index page "' +
        created.indexPageId +
        '"',
      'error',
    );
    return;
  }
  ctx.setActivePage(created.indexPageId);
  ctx.setStatus('Created collection "' + slug + '"', 'ok');
}

/** Wire the #canvas-add-collection button. Mirrors the canvas-add-page
 *  wiring at src/editor-client/index.ts:754-759. No-op when the button
 *  is absent (smokes, edit-token surfaces without the sidebar, etc.). */
export function attachCollectionScaffoldButtonImpl(ctx: EditorContext): void {
  const btn = document.getElementById('canvas-add-collection');
  if (!btn) return;
  btn.addEventListener('click', () => {
    void runCollectionScaffoldFlowImpl(ctx);
  });
}
