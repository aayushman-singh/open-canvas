// src/editor-client/collection-scaffold.smoke.ts
//
// ADR 0060 F3 — pins the "+ New collection" wizard surfaced from the
// editor's Pages sidebar.
//
// Coverage:
//   (1) Happy path: prompted slug "blog" → POST hits the right URL with
//       the right body shape → site state refresh → setActivePage runs
//       with the freshly-scaffolded index page id → success status.
//   (2) Cancelled prompt: openTextModal returning null skips the POST
//       entirely.
//   (3) Slug shape failure surfaces an error toast and skips the POST.
//   (4) Server error response surfaces the server's `error` string in
//       the status toast.
//   (5) flushPendingSave returning false short-circuits before the POST.
//
// Bare Bun has no `document`; exercising the runtime button wiring
// (attachCollectionScaffoldButtonImpl) needs a DOM, so the smoke
// targets the seam below it — runCollectionScaffoldFlowImpl — which
// carries all the prompt/POST/refresh/activate logic.
//
// Run with `bun run collection-scaffold:smoke`.

import type { EditableSite } from '../canvas/schema.js';
import type { CollectionScaffoldCtx } from './collection-scaffold.js';
import { runCollectionScaffoldFlowImpl } from './collection-scaffold.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[collection-scaffold:smoke] ' + message);
}

interface RecordedFetch {
  url: string;
  init?: RequestInit | undefined;
}

interface RecordedStatus {
  text: string;
  tone: 'ok' | 'error' | 'info' | undefined;
}

function emptyState(): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-home',
        slug: 'index',
        title: 'Home',
        width: 1440,
        sections: [
          {
            id: 'sec-home',
            recipeId: 'custom',
            name: 'Home',
            height: 400,
            elements: [],
          },
        ],
      },
    ],
  };
}

interface MockHandles {
  ctx: CollectionScaffoldCtx;
  fetches: RecordedFetch[];
  statuses: RecordedStatus[];
  activePageIds: (string | null)[];
  /** Set the slug the openTextModal resolves with. null simulates cancel. */
  setPromptReply: (value: string | null) => void;
  /** Override the POST response. Default: 201 + `{collectionSlug, redirectTo}`. */
  setPostResponse: (response: Response) => void;
  /** Override the refresh GET response. Default: empty site + new pages. */
  setRefreshState: (state: EditableSite) => void;
  /** Override the flushPendingSave outcome. Default: true. */
  setFlushOutcome: (ok: boolean) => void;
  renderAllCalls: { count: number };
  updatePageSidebarCalls: { count: number };
}

function makeCtx(): MockHandles {
  let promptReply: string | null = null;
  let postResponse: Response | null = null;
  let refreshState: EditableSite | null = null;
  let flushOutcome = true;
  const fetches: RecordedFetch[] = [];
  const statuses: RecordedStatus[] = [];
  const activePageIds: (string | null)[] = [];
  const renderAllCalls = { count: 0 };
  const updatePageSidebarCalls = { count: 0 };

  const ctx: CollectionScaffoldCtx = {
    apiBase: '/api',
    siteId: 'site-smoke',
    siteBase: '/api/canvas/sites/site-smoke',
    state: emptyState(),
    authFetch(input, init) {
      const url = typeof input === 'string' ? input : input.url;
      fetches.push({ url, init });
      const method =
        (init && typeof init.method === 'string' ? init.method.toUpperCase() : null) ?? 'GET';
      if (method === 'POST') {
        return Promise.resolve(
          postResponse ??
            new Response(
              JSON.stringify({
                collectionSlug: 'blog',
                redirectTo: '/dashboard/sites/site-smoke/entries?collection=blog',
              }),
              { status: 201, headers: { 'content-type': 'application/json' } },
            ),
        );
      }
      // GET refresh of /canvas/sites/:siteId — return a state with the
      // new pages already appended so the wizard can pick up the index
      // page id (the scaffold endpoint already wrote them to the DB).
      const defaultRefresh: EditableSite = refreshState ?? {
        styleKit: 'charcoal',
        pages: [
          ...emptyState().pages,
          {
            id: 'page-collection-blog-index',
            slug: 'blog',
            title: 'Blog',
            width: 1440,
            sections: [],
            pageKind: 'collection-index',
            collectionSlug: 'blog',
          },
          {
            id: 'page-collection-blog-template',
            slug: 'blog/template',
            title: '{{title}}',
            width: 1440,
            sections: [],
            pageKind: 'collection-item-template',
            collectionSlug: 'blog',
          },
        ],
      };
      return Promise.resolve(
        new Response(
          JSON.stringify({ editableState: defaultRefresh, publishedVersion: 0 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    },
    openTextModal(_opts) {
      return Promise.resolve(promptReply);
    },
    setStatus(text, tone) {
      statuses.push({ text, tone });
    },
    flushPendingSave() {
      return Promise.resolve(flushOutcome);
    },
    migrateState(state) {
      return state;
    },
    setActivePage(pageId) {
      activePageIds.push(pageId);
    },
    renderAll() {
      renderAllCalls.count += 1;
    },
    updatePageSidebar() {
      updatePageSidebarCalls.count += 1;
    },
  };

  return {
    ctx,
    fetches,
    statuses,
    activePageIds,
    setPromptReply: (value) => {
      promptReply = value;
    },
    setPostResponse: (response) => {
      postResponse = response;
    },
    setRefreshState: (state) => {
      refreshState = state;
    },
    setFlushOutcome: (ok) => {
      flushOutcome = ok;
    },
    renderAllCalls,
    updatePageSidebarCalls,
  };
}

// ---------------------------------------------------------------------------
// (1) Happy path
// ---------------------------------------------------------------------------

{
  const handles = makeCtx();
  handles.setPromptReply('blog');

  await runCollectionScaffoldFlowImpl(handles.ctx);

  // Two requests fired: POST collection, then GET site state refresh.
  assert(handles.fetches.length === 2, '(1) expected 2 fetches, got ' + handles.fetches.length);

  const postCall = handles.fetches[0]!;
  assert(
    postCall.url === '/api/sites/site-smoke/collections',
    '(1) POST url must hit the scaffold endpoint (got ' + postCall.url + ')',
  );
  assert(
    postCall.init?.method === 'POST',
    '(1) POST init.method must be POST (got ' + String(postCall.init?.method) + ')',
  );
  const headers = postCall.init?.headers as Record<string, string> | undefined;
  assert(
    headers !== undefined && headers['content-type'] === 'application/json',
    '(1) POST must declare JSON content-type',
  );
  const rawBody = postCall.init?.body;
  assert(
    typeof rawBody === 'string',
    '(1) POST body must be a JSON string (got ' + typeof rawBody + ')',
  );
  const parsedBody = JSON.parse(rawBody) as { slug?: string };
  assert(parsedBody.slug === 'blog', '(1) POST body must carry {slug:"blog"}');

  const refreshCall = handles.fetches[1]!;
  assert(
    refreshCall.url === '/api/canvas/sites/site-smoke',
    '(1) refresh url must hit siteBase (got ' + refreshCall.url + ')',
  );

  // setActivePage called once with the index page id from the refreshed state.
  assert(
    handles.activePageIds.length === 1 &&
      handles.activePageIds[0] === 'page-collection-blog-index',
    '(1) setActivePage must switch to the new index page (got ' +
      JSON.stringify(handles.activePageIds) +
      ')',
  );

  assert(handles.renderAllCalls.count === 1, '(1) renderAll must run after refresh');
  assert(
    handles.updatePageSidebarCalls.count === 1,
    '(1) updatePageSidebar must run after refresh',
  );

  const final = handles.statuses[handles.statuses.length - 1];
  assert(
    final !== undefined &&
      final.tone === 'ok' &&
      final.text.includes('blog'),
    '(1) final status must announce success with the slug (got ' + JSON.stringify(final) + ')',
  );
}

// ---------------------------------------------------------------------------
// (2) Cancelled prompt → no POST
// ---------------------------------------------------------------------------

{
  const handles = makeCtx();
  handles.setPromptReply(null);

  await runCollectionScaffoldFlowImpl(handles.ctx);

  assert(
    handles.fetches.length === 0,
    '(2) cancelled prompt must skip POST (got ' + handles.fetches.length + ' fetches)',
  );
  assert(
    handles.statuses.length === 0,
    '(2) cancelled prompt must skip status (got ' + handles.statuses.length + ' statuses)',
  );
}

// ---------------------------------------------------------------------------
// (3) Bad slug shape → error toast, no POST
// ---------------------------------------------------------------------------

{
  const handles = makeCtx();
  handles.setPromptReply('Has Caps');

  await runCollectionScaffoldFlowImpl(handles.ctx);

  assert(
    handles.fetches.length === 0,
    '(3) malformed slug must skip POST (got ' + handles.fetches.length + ' fetches)',
  );
  const last = handles.statuses[handles.statuses.length - 1];
  assert(
    last !== undefined && last.tone === 'error',
    '(3) malformed slug must surface an error status (got ' + JSON.stringify(last) + ')',
  );
}

// ---------------------------------------------------------------------------
// (4) Server returns 409 with conflict error
// ---------------------------------------------------------------------------

{
  const handles = makeCtx();
  handles.setPromptReply('blog');
  handles.setPostResponse(
    new Response(
      JSON.stringify({ error: 'a page with slug "blog" already exists' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ),
  );

  await runCollectionScaffoldFlowImpl(handles.ctx);

  // POST happened, refresh did not.
  assert(
    handles.fetches.length === 1,
    '(4) server error must skip refresh (got ' + handles.fetches.length + ' fetches)',
  );
  assert(
    handles.activePageIds.length === 0,
    '(4) server error must skip setActivePage',
  );
  const last = handles.statuses[handles.statuses.length - 1];
  assert(
    last !== undefined &&
      last.tone === 'error' &&
      last.text.includes('a page with slug "blog" already exists'),
    '(4) server error message must surface in the status (got ' + JSON.stringify(last) + ')',
  );
}

// ---------------------------------------------------------------------------
// (5) flushPendingSave returning false short-circuits before POST
// ---------------------------------------------------------------------------

{
  const handles = makeCtx();
  handles.setPromptReply('blog');
  handles.setFlushOutcome(false);

  await runCollectionScaffoldFlowImpl(handles.ctx);

  assert(
    handles.fetches.length === 0,
    '(5) failed flush must skip POST (got ' + handles.fetches.length + ' fetches)',
  );
  const last = handles.statuses[handles.statuses.length - 1];
  assert(
    last !== undefined && last.tone === 'error' && last.text.toLowerCase().includes('save'),
    '(5) failed flush must surface a save-prompt error status (got ' + JSON.stringify(last) + ')',
  );
}

console.log('[collection-scaffold:smoke] OK');
