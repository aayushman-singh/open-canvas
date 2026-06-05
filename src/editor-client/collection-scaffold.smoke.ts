// src/editor-client/collection-scaffold.smoke.ts
//
// ADR 0063 Decision 11 — pins the "+ New Collection" wizard surfaced from
// the editor's Pages sidebar.
//
// Coverage:
//   (1) Happy path with the default slug pre-filled: openTextModal receives
//       `defaultValue: 'blog'` (computed client-side from ctx.state) →
//       POST hits the right URL with the right body shape → site state
//       refresh → setActivePage runs with the index page id returned by
//       the server → success status echoes the resolved slug.
//   (2) Cancelled prompt: openTextModal returning null skips the POST.
//   (3) Bad slug shape surfaces an error toast and skips the POST.
//   (4) Server 409 surfaces the server's `error` string in the status.
//   (5) flushPendingSave returning false short-circuits before POST.
//   (6) When the local state already has 'blog' bound, the prompt's
//       default value falls back to 'collection-1'.
//   (7) Server returns 500 with `step: 'db-transaction'` — wizard surfaces
//       the failure message; refresh does NOT run; active page unchanged.
//   (8) Server returns a different resolved slug than what the client
//       sent — the success toast and setActivePage use the SERVER's slug.
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

interface RecordedModalOpen {
  defaultValue: string | undefined;
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

function stateWithBlogTaken(): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      ...emptyState().pages,
      {
        id: 'page-existing-blog',
        slug: 'blog',
        title: 'Existing Blog',
        width: 1440,
        sections: [{ id: 'sec', recipeId: 'custom', name: '', height: 100, elements: [] }],
      },
    ],
  };
}

interface MockHandles {
  ctx: CollectionScaffoldCtx;
  fetches: RecordedFetch[];
  statuses: RecordedStatus[];
  activePageIds: (string | null)[];
  modalOpens: RecordedModalOpen[];
  setPromptReply: (value: string | null) => void;
  setPostResponse: (response: Response) => void;
  setRefreshState: (state: EditableSite) => void;
  setFlushOutcome: (ok: boolean) => void;
  setInitialState: (state: EditableSite | null) => void;
  renderAllCalls: { count: number };
  updatePageSidebarCalls: { count: number };
}

function makeCtx(): MockHandles {
  let promptReply: string | null = null;
  let postResponse: Response | null = null;
  let refreshState: EditableSite | null = null;
  let flushOutcome = true;
  let initialState: EditableSite | null = emptyState();
  const fetches: RecordedFetch[] = [];
  const statuses: RecordedStatus[] = [];
  const activePageIds: (string | null)[] = [];
  const modalOpens: RecordedModalOpen[] = [];
  const renderAllCalls = { count: 0 };
  const updatePageSidebarCalls = { count: 0 };

  const ctx: CollectionScaffoldCtx = {
    apiBase: '/api',
    siteId: 'site-smoke',
    siteBase: '/api/canvas/sites/site-smoke',
    get state() {
      return initialState;
    },
    set state(value: EditableSite | null) {
      initialState = value;
    },
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
                indexPageId: 'page-collection-blog-index',
                templatePageId: 'page-collection-blog-template',
                seededEntrySlugs: ['welcome-to-your-blog', 'your-second-post'],
                redirectTo: '/dashboard/sites/site-smoke/entries?collection=blog',
              }),
              { status: 201, headers: { 'content-type': 'application/json' } },
            ),
        );
      }
      // GET refresh of /canvas/sites/:siteId — return a state with the
      // new pages appended so the wizard can confirm the index page id.
      // ADR 0063 F5 — the wizard's refresh shape no longer carries a
      // page-level `pageKind: 'collection-index'` on the index page.
      // The element-level binding on the Collection element is the
      // single source of truth; the template page keeps its kind
      // because the publish-time clone-per-entry pass keys on it.
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
          },
          {
            id: 'page-collection-blog-template',
            slug: 'blog/_template',
            title: '{{title}}',
            width: 1440,
            sections: [],
            pageKind: 'collection-item-template',
            collectionSlug: 'blog',
            noIndex: true,
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
    openTextModal(opts) {
      modalOpens.push({ defaultValue: opts.defaultValue });
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
    panToPage() {
      // No-op in the smoke — the scaffold flow calls panToPage after
      // setActivePage to bring the newly-created index page into view.
      // The activePageIds recording is enough to pin the scaffold's
      // navigation contract.
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
    modalOpens,
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
    setInitialState: (state) => {
      initialState = state;
    },
    renderAllCalls,
    updatePageSidebarCalls,
  };
}

// ---------------------------------------------------------------------------
// (1) Happy path — default 'blog' pre-filled, server returns it, success
// ---------------------------------------------------------------------------

{
  const handles = makeCtx();
  handles.setPromptReply('blog');

  await runCollectionScaffoldFlowImpl(handles.ctx);

  assert(handles.modalOpens.length === 1, '(1) modal opened exactly once');
  assert(
    handles.modalOpens[0]!.defaultValue === 'blog',
    `(1) modal pre-filled with default slug 'blog' (got ${String(handles.modalOpens[0]!.defaultValue)})`,
  );

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
// (4) Server 409 with conflict error
// ---------------------------------------------------------------------------

{
  const handles = makeCtx();
  handles.setPromptReply('blog');
  handles.setPostResponse(
    new Response(
      JSON.stringify({ error: 'a page with slug "blog" already exists', step: 'slug-conflict' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ),
  );

  await runCollectionScaffoldFlowImpl(handles.ctx);

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

// ---------------------------------------------------------------------------
// (6) Local 'blog' taken → prompt pre-fills with 'collection-1'
// ---------------------------------------------------------------------------

{
  const handles = makeCtx();
  handles.setInitialState(stateWithBlogTaken());
  handles.setPromptReply(null);

  await runCollectionScaffoldFlowImpl(handles.ctx);

  assert(handles.modalOpens.length === 1, '(6) modal opened once');
  assert(
    handles.modalOpens[0]!.defaultValue === 'collection-1',
    `(6) modal default must fall back to 'collection-1' when 'blog' is taken (got ${String(handles.modalOpens[0]!.defaultValue)})`,
  );
}

// ---------------------------------------------------------------------------
// (7) Server 500 / db-transaction failure → error toast, no refresh
// ---------------------------------------------------------------------------

{
  const handles = makeCtx();
  handles.setPromptReply('blog');
  handles.setPostResponse(
    new Response(
      JSON.stringify({
        error: 'failed to provision collection: connection reset',
        step: 'db-transaction',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    ),
  );

  await runCollectionScaffoldFlowImpl(handles.ctx);

  assert(
    handles.fetches.length === 1,
    '(7) 500 response must skip refresh (got ' + handles.fetches.length + ' fetches)',
  );
  assert(handles.activePageIds.length === 0, '(7) 500 response must skip setActivePage');
  const last = handles.statuses[handles.statuses.length - 1];
  assert(
    last !== undefined &&
      last.tone === 'error' &&
      last.text.includes('failed to provision collection: connection reset'),
    '(7) 500 error message must surface in the status (got ' + JSON.stringify(last) + ')',
  );
}

// ---------------------------------------------------------------------------
// (8) Server resolved slug differs from client-sent slug
// ---------------------------------------------------------------------------

{
  const handles = makeCtx();
  handles.setPromptReply('blog');
  handles.setPostResponse(
    new Response(
      JSON.stringify({
        collectionSlug: 'collection-1',
        indexPageId: 'page-collection-collection-1-index',
        templatePageId: 'page-collection-collection-1-template',
        seededEntrySlugs: ['welcome-to-your-blog', 'your-second-post'],
        redirectTo: '/dashboard/sites/site-smoke/entries?collection=collection-1',
      }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ),
  );
  // ADR 0063 F5 — index page no longer carries pageKind/collectionSlug.
  handles.setRefreshState({
    styleKit: 'charcoal',
    pages: [
      ...emptyState().pages,
      {
        id: 'page-collection-collection-1-index',
        slug: 'collection-1',
        title: 'Collection 1',
        width: 1440,
        sections: [],
      },
    ],
  });

  await runCollectionScaffoldFlowImpl(handles.ctx);

  assert(
    handles.activePageIds.length === 1 &&
      handles.activePageIds[0] === 'page-collection-collection-1-index',
    '(8) setActivePage must use the server-returned index page id (got ' +
      JSON.stringify(handles.activePageIds) +
      ')',
  );
  const final = handles.statuses[handles.statuses.length - 1];
  assert(
    final !== undefined && final.tone === 'ok' && final.text.includes('collection-1'),
    '(8) success status must echo the server-resolved slug (got ' + JSON.stringify(final) + ')',
  );
}

console.log('[collection-scaffold:smoke] OK');
