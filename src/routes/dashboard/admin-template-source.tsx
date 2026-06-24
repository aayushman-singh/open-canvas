import { Hono } from 'hono';
import type { Context } from 'hono';
import { raw } from 'hono/html';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { clerkAuth } from '../../auth/middleware';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { isTemplateSourceAdminCustomer } from '../../auth/db-admin';
import { requireAuth } from '../../auth/require-auth';
import { canvasPublishedStyles } from '../../canvas/public-styles';
import {
  ENTRANCE_ANIMATION_CSS,
  renderEntranceObserverScriptTag,
} from '../../canvas/entrance-animation';
import { requireTurnstileSiteKey } from '../../canvas/elements/form';
import { renderBuiltInTemplatePreviewBodyHtml } from '../../templates/built-in-preview';
import { getTemplateSeed } from '../../templates/registry';
import {
  createTemplateSourcePullRequest,
  getProductionTemplateSourceCatalog,
  readProductionTemplateSourceDocument,
  requireTemplateSourceGitHubConfig,
  type GitHubTemplateSourceEnv,
} from '../../templates/source-admin-github';
import { readThemeCookie } from '../../ui';
import { DashboardShell } from './shell';

type Bindings = GitHubTemplateSourceEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  ADMIN_CLERK_USER_IDS?: string;
  TURNSTILE_SITE_KEY?: string;
};

const pageStyles = `
  .content { max-width: 1240px; }
  .admin-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 24px;
  }
  .admin-head h1 {
    margin: 0;
    font-size: 32px;
    letter-spacing: 0;
  }
  .source-admin {
    display: grid;
    grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }
  .source-sidebar,
  .source-panel {
    border: 1px solid var(--line);
    border-radius: var(--r);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .source-sidebar {
    padding: 14px;
    display: grid;
    gap: 8px;
    max-height: 74vh;
    overflow: auto;
  }
  .source-template {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
    background: var(--surface);
    color: var(--ink);
    display: grid;
    gap: 4px;
    padding: 10px 11px;
    text-align: left;
    cursor: pointer;
  }
  .source-template[aria-current="true"] {
    border-color: var(--red);
    box-shadow: 0 0 0 2px var(--red-tint);
  }
  .source-template b {
    font-family: var(--display);
    font-size: 14px;
    letter-spacing: 0;
  }
  .source-template span {
    color: var(--ink-3);
    font-family: var(--mono);
    font-size: 11px;
  }
  .source-panel {
    display: grid;
    overflow: hidden;
  }
  .source-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--line);
  }
  .source-panel-head h2 {
    margin: 0;
    font-size: 18px;
    letter-spacing: 0;
  }
  .source-panel-head code,
  .source-path {
    font-family: var(--mono);
    color: var(--ink-3);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .source-panel-body {
    display: grid;
    gap: 14px;
    padding: 18px;
  }
  .source-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: end;
  }
  .source-field {
    display: grid;
    gap: 7px;
  }
  .source-field label {
    color: var(--ink-3);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .source-field select {
    min-height: 40px;
    border: 1px solid var(--line-2);
    border-radius: var(--r-xs);
    background: var(--surface);
    color: var(--ink);
    padding: 8px 10px;
  }
  .source-editor {
    width: 100%;
    min-height: 54vh;
    border: 1px solid #111827;
    border-radius: var(--r-xs);
    background: #111827;
    color: #f8fafc;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.55;
    padding: 14px;
    resize: vertical;
    white-space: pre;
    overflow-wrap: normal;
    overflow-x: auto;
  }
  .source-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
  }
  .source-status {
    border-left: 4px solid var(--line-2);
    border-radius: var(--r-xs);
    background: var(--surface-2);
    color: var(--ink-2);
    min-height: 42px;
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.45;
    white-space: pre-wrap;
  }
  .source-status[data-kind="ok"] { border-left-color: #25724f; color: #25724f; }
  .source-status[data-kind="bad"] { border-left-color: var(--red); color: var(--red-ink); }
  .source-status a {
    color: inherit;
    font-weight: 700;
    border-bottom: 1px solid currentColor;
  }
  .source-loading {
    opacity: .62;
    pointer-events: none;
  }
  @media (max-width: 720px) {
    .admin-head { align-items: flex-start; flex-direction: column; }
    .source-admin { grid-template-columns: 1fr; }
    .source-fields { grid-template-columns: 1fr; }
  }
`;

type AdminTemplateSourceEnv = {
  Bindings: Bindings;
  Variables: ClerkAuthVariables;
};

type AdminTemplateSourceContext = Context<AdminTemplateSourceEnv>;

const adminTemplateSourceRoute = new Hono<AdminTemplateSourceEnv>();

adminTemplateSourceRoute.use('*', clerkAuth());
adminTemplateSourceRoute.use('*', requireAuth());
adminTemplateSourceRoute.use('*', async (c, next) => {
  const auth = c.get('auth');
  const customerRecord = c.get('customer');
  if (!customerRecord) {
    throw new Error('template source admin reached with authenticated user but no customer row');
  }
  if (!isTemplateSourceAdminCustomer(customerRecord, auth.userId, c.env.ADMIN_CLERK_USER_IDS)) {
    return c.text('admin access required', 403);
  }
  await next();
});

function errorStatus(error: Error): ContentfulStatusCode {
  const message = error.message;
  if (message.includes('TEMPLATE_SOURCE_GITHUB_')) return 500;
  if (message.includes('unknown template')) return 404;
  if (message.includes('does not use section')) return 404;
  if (message.includes('not a code-defined Section Library entry')) return 404;
  if (
    message.includes('not valid JSON') ||
    message.includes('must be') ||
    message.includes('failed') ||
    message.includes('requires')
  ) {
    return 400;
  }
  if (message.includes('GitHub')) return 502;
  return 500;
}

function errorResponse(c: AdminTemplateSourceContext, error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error('[template-source-admin] request failed', {
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    message: err.message,
    stack: err.stack,
  });
  return c.json({ error: err.message }, errorStatus(err));
}

async function readJsonObject(c: AdminTemplateSourceContext) {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch (cause) {
    throw new Error('request body must be valid JSON', { cause });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function renderPreviewPage(templateId: string, turnstileSiteKey: string): string {
  const template = getTemplateSeed(templateId);
  if (!template) {
    throw new Error(`template-source-admin: unknown template '${templateId}'`);
  }
  const html = renderBuiltInTemplatePreviewBodyHtml(template.id, {
    turnstileSiteKey,
    assetBasePath: `/dashboard/templates/${template.id}/assets`,
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${template.name} preview</title>
  <style>${canvasPublishedStyles}\n${ENTRANCE_ANIMATION_CSS}</style>
  <style>html,body{margin:0;width:100%;min-height:100%;overflow-x:hidden;}</style>
</head>
<body style="margin:0;overflow-x:hidden;background:var(--paper)"><script>window.__opencanvasRuntimeOptions={reducedMotion:"no-preference"};</script>${html}${renderEntranceObserverScriptTag()}</body>
</html>`;
}

const adminScript = `
(() => {
  const base = '/dashboard/admin/template-source';
  const state = { templates: [], selectedTemplateId: null, document: null, selectedSectionId: null };
  const els = {
    root: document.querySelector('[data-template-source-admin]'),
    templateList: document.getElementById('sourceTemplateList'),
    templateTitle: document.getElementById('sourceTemplateTitle'),
    templateMeta: document.getElementById('sourceTemplateMeta'),
    sectionSelect: document.getElementById('sourceSectionSelect'),
    sectionPath: document.getElementById('sourceSectionPath'),
    source: document.getElementById('sourceSectionSource'),
    preview: document.getElementById('sourcePreviewLink'),
    createPr: document.getElementById('sourceCreatePr'),
    status: document.getElementById('sourceStatus'),
  };
  function api(path, options) {
    return fetch(base + path, options).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Request failed with status ' + response.status);
      return body;
    });
  }
  function setLoading(loading) {
    els.root.classList.toggle('source-loading', Boolean(loading));
    els.createPr.disabled = Boolean(loading);
  }
  function status(kind, message, href) {
    els.status.dataset.kind = kind;
    els.status.textContent = '';
    if (href) {
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = message;
      els.status.append(link);
    } else {
      els.status.textContent = message;
    }
  }
  function currentSection() {
    if (!state.document) return null;
    return state.document.sections.find((section) => section.sectionId === state.selectedSectionId) || null;
  }
  function renderTemplates() {
    els.templateList.textContent = '';
    for (const template of state.templates) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'source-template';
      button.setAttribute('aria-current', String(template.id === state.selectedTemplateId));
      button.innerHTML = '<b></b><span></span>';
      button.querySelector('b').textContent = template.name;
      button.querySelector('span').textContent = template.id + ' / ' + template.sectionCount + ' sections';
      button.addEventListener('click', () => selectTemplate(template.id));
      els.templateList.append(button);
    }
  }
  function renderSection() {
    const section = currentSection();
    els.source.value = section ? section.source : '';
    els.sectionPath.textContent = section ? section.filePath : '';
  }
  function renderDocument() {
    const doc = state.document;
    if (!doc) return;
    els.templateTitle.textContent = doc.template.name;
    els.templateMeta.textContent = doc.template.id + ' / ' + doc.template.styleKit;
    els.preview.href = base + '/preview/' + encodeURIComponent(doc.template.id);
    els.sectionSelect.textContent = '';
    for (const section of doc.sections) {
      const option = document.createElement('option');
      option.value = section.sectionId;
      option.textContent = section.slot + ' / ' + section.baseSlug;
      els.sectionSelect.append(option);
    }
    if (!state.selectedSectionId || !doc.sections.some((section) => section.sectionId === state.selectedSectionId)) {
      state.selectedSectionId = doc.sections[0]?.sectionId || null;
    }
    els.sectionSelect.value = state.selectedSectionId || '';
    renderSection();
  }
  async function selectTemplate(templateId) {
    setLoading(true);
    status('', 'Loading source');
    state.selectedTemplateId = templateId;
    state.selectedSectionId = null;
    renderTemplates();
    try {
      state.document = await api('/api/templates/' + encodeURIComponent(templateId));
      renderDocument();
      status('', 'Ready');
    } catch (error) {
      status('bad', error.message);
    } finally {
      setLoading(false);
    }
  }
  els.sectionSelect.addEventListener('change', () => {
    state.selectedSectionId = els.sectionSelect.value;
    renderSection();
  });
  els.createPr.addEventListener('click', async () => {
    const section = currentSection();
    if (!state.selectedTemplateId || !section) return;
    setLoading(true);
    status('', 'Creating pull request');
    try {
      const result = await api(
        '/api/templates/' + encodeURIComponent(state.selectedTemplateId) + '/sections/' + encodeURIComponent(section.sectionId) + '/pull-request',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: els.source.value }),
        },
      );
      section.source = els.source.value;
      status('ok', 'Open pull request: ' + result.pullRequestUrl, result.pullRequestUrl);
    } catch (error) {
      status('bad', error.message);
    } finally {
      setLoading(false);
    }
  });
  async function boot() {
    try {
      const catalog = await api('/api/templates');
      state.templates = catalog.templates;
      state.selectedTemplateId = state.templates[0]?.id || null;
      renderTemplates();
      if (state.selectedTemplateId) await selectTemplate(state.selectedTemplateId);
    } catch (error) {
      status('bad', error.message);
    }
  }
  boot();
})();
`;

adminTemplateSourceRoute.get('/', (c) => {
  const customerRecord = c.get('customer');
  if (!customerRecord) {
    throw new Error('template source admin page reached without customer row');
  }

  return c.html(
    <DashboardShell
      title="Open Canvas - template source admin"
      crumbs={[{ href: '/dashboard', label: 'Dashboard' }, { label: 'Template source admin' }]}
      activePath="/dashboard"
      pageStyles={pageStyles}
      userMeta={{
        displayName: customerRecord.displayName ?? undefined,
        email: customerRecord.email,
      }}
      theme={readThemeCookie(c)}
      showAdminLink
    >
      <div class="admin-head">
        <h1>Template source admin</h1>
        <a
          id="sourcePreviewLink"
          href="/dashboard/admin/template-source/preview/starter-canvas"
          class="btn btn-secondary"
          target="_blank"
          rel="noreferrer"
        >
          Open preview
        </a>
      </div>
      <div class="source-admin" data-template-source-admin>
        <aside id="sourceTemplateList" class="source-sidebar" />
        <section class="source-panel">
          <div class="source-panel-head">
            <h2 id="sourceTemplateTitle">Loading</h2>
            <code id="sourceTemplateMeta" />
          </div>
          <div class="source-panel-body">
            <div class="source-fields">
              <div class="source-field">
                <label for="sourceSectionSelect">Section</label>
                <select id="sourceSectionSelect" />
              </div>
              <code id="sourceSectionPath" class="source-path" />
            </div>
            <textarea id="sourceSectionSource" class="source-editor" spellcheck={false} />
            <div class="source-actions">
              <button id="sourceCreatePr" class="btn btn-primary" type="button">
                Create pull request
              </button>
              <div id="sourceStatus" class="source-status">Loading source</div>
            </div>
          </div>
        </section>
      </div>
      <script>{raw(adminScript)}</script>
    </DashboardShell>,
  );
});

adminTemplateSourceRoute.get('/preview/:templateId', (c) => {
  try {
    return c.html(renderPreviewPage(c.req.param('templateId'), requireTurnstileSiteKey(c.env)));
  } catch (error) {
    return errorResponse(c, error);
  }
});

adminTemplateSourceRoute.get('/api/templates', (c) => {
  try {
    return c.json({ templates: getProductionTemplateSourceCatalog() });
  } catch (error) {
    return errorResponse(c, error);
  }
});

adminTemplateSourceRoute.get('/api/templates/:templateId', (c) => {
  try {
    return c.json(readProductionTemplateSourceDocument(c.req.param('templateId')));
  } catch (error) {
    return errorResponse(c, error);
  }
});

adminTemplateSourceRoute.post(
  '/api/templates/:templateId/sections/:sectionId/pull-request',
  async (c) => {
    try {
      const body = await readJsonObject(c);
      if (typeof body.source !== 'string') {
        throw new Error('source must be a string');
      }
      const result = await createTemplateSourcePullRequest(
        requireTemplateSourceGitHubConfig(c.env),
        {
          templateId: c.req.param('templateId'),
          sectionId: c.req.param('sectionId'),
          source: body.source,
        },
      );
      return c.json(result);
    } catch (error) {
      return errorResponse(c, error);
    }
  },
);

export default adminTemplateSourceRoute;
