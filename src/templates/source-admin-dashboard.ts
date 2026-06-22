import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Hono } from 'hono';
import type { Context } from 'hono';

import { canvasPublishedStyles } from '../canvas/public-styles.js';
import { getSeedAsset } from '../canvas/seed-assets.js';
import { renderBuiltInTemplatePreviewBodyHtml } from './built-in-preview.js';
import {
  getTemplateSourceCatalog,
  readTemplateSourceDocument,
  writeTemplateMetadataSource,
  writeTemplateSectionSource,
  type MetadataWriteInput,
  type TemplateSourceAdminPaths,
} from './source-admin.js';
import { getTemplateSeed } from './registry.js';

export interface TemplateSourceAdminAppOptions {
  paths?: TemplateSourceAdminPaths;
  turnstileSiteKey?: string | undefined;
}

type TemplateSourceAdminEnv = {
  Bindings: Record<string, never>;
};

type TemplateSourceAdminContext = Context<TemplateSourceAdminEnv>;

const LOCAL_PREVIEW_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
const previewStyles = `
  html, body { margin: 0; overflow: hidden; background: var(--paper); }
`;

function errorStatus(error: Error): 400 | 404 | 500 {
  const message = error.message;
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
  return 500;
}

function errorResponse(c: TemplateSourceAdminContext, error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error('[template-source-admin] request failed', {
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    message: err.message,
    stack: err.stack,
  });
  return c.json(
    {
      error: err.message,
      stack: err.stack,
    },
    errorStatus(err),
  );
}

async function readJsonObject(c: TemplateSourceAdminContext) {
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

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  <title>${escapeHtmlText(template.name)} preview</title>
  <style>${canvasPublishedStyles}</style>
  <style>${previewStyles}</style>
</head>
<body>${html}</body>
</html>`;
}

function decodeBase64Bytes(source: string): Uint8Array {
  const binary = atob(source.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function localSeedAssetResponse(
  assetId: string,
  paths: TemplateSourceAdminPaths,
): Promise<Response | null> {
  const asset = getSeedAsset(assetId);
  if (!asset) return null;
  const repoRoot = paths.repoRoot ?? process.cwd();
  const filePath = join(repoRoot, 'src', 'assets', 'seed-source', asset.sourcePath);
  const source = await readFile(filePath, 'utf8');
  return new Response(decodeBase64Bytes(source), {
    headers: {
      'content-type': asset.mediaType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}

function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Template source admin</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #f7f5f0;
      --ink: #1c1b19;
      --muted: #6d6860;
      --line: #d9d2c5;
      --line-strong: #b9afa0;
      --surface: #fffdfa;
      --surface-2: #eee7db;
      --accent: #be3a2b;
      --accent-ink: #7f1e16;
      --ok: #256f4a;
      --bad: #9d2626;
      --code: #111827;
      --code-ink: #f8fafc;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      min-height: 100vh;
    }
    button, input, textarea, select { font: inherit; }
    .app {
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      min-height: 100vh;
    }
    aside {
      border-right: 1px solid var(--line);
      background: var(--surface);
      padding: 22px 18px;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: auto;
    }
    main {
      padding: 26px;
      display: grid;
      gap: 18px;
      align-content: start;
    }
    h1 {
      font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
      font-size: 26px;
      margin: 0 0 18px;
      letter-spacing: 0;
    }
    h2 {
      font-size: 16px;
      margin: 0;
      letter-spacing: 0;
    }
    .template-list {
      display: grid;
      gap: 8px;
    }
    .template-button {
      width: 100%;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      border-radius: 6px;
      padding: 11px 12px;
      text-align: left;
      cursor: pointer;
      display: grid;
      gap: 4px;
    }
    .template-button:hover,
    .template-button[aria-current="true"] {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(190, 58, 43, 0.12);
    }
    .template-button b { font-size: 14px; }
    .template-button span { color: var(--muted); font-size: 12px; }
    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 10px 30px rgba(45, 35, 20, 0.06);
    }
    .panel-head {
      border-bottom: 1px solid var(--line);
      padding: 15px 18px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .panel-head .path {
      margin-left: auto;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      color: var(--muted);
      font-size: 12px;
    }
    .panel-body {
      padding: 18px;
      display: grid;
      gap: 14px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
      gap: 14px;
    }
    label {
      display: grid;
      gap: 7px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      background: #fff;
      color: var(--ink);
      padding: 10px 11px;
      outline: none;
    }
    input:focus, textarea:focus, select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(190, 58, 43, 0.14);
    }
    textarea {
      min-height: 58vh;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 12.5px;
      line-height: 1.55;
      background: var(--code);
      color: var(--code-ink);
      border-color: #111827;
      white-space: pre;
      overflow-wrap: normal;
      overflow-x: auto;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .btn {
      border: 1px solid transparent;
      border-radius: 999px;
      padding: 9px 15px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      gap: 8px;
      align-items: center;
      justify-content: center;
      text-decoration: none;
    }
    .btn-primary {
      background: var(--accent);
      color: #fff;
    }
    .btn-secondary {
      background: var(--surface);
      color: var(--ink);
      border-color: var(--line-strong);
    }
    .btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .status {
      border-left: 4px solid var(--line-strong);
      padding: 10px 12px;
      color: var(--muted);
      background: var(--surface-2);
      border-radius: 4px;
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-wrap;
    }
    .status.ok { border-left-color: var(--ok); color: var(--ok); }
    .status.bad { border-left-color: var(--bad); color: var(--bad); }
    .hidden { display: none; }
    @media (max-width: 880px) {
      .app { grid-template-columns: 1fr; }
      aside { position: static; height: auto; }
      .grid-2 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app" data-template-source-admin>
    <aside>
      <h1>Template source admin</h1>
      <div id="templateList" class="template-list"></div>
    </aside>
    <main>
      <section class="panel">
        <div class="panel-head">
          <h2 id="templateTitle">Loading</h2>
          <span class="path" id="templateMeta"></span>
        </div>
        <div class="panel-body">
          <div class="grid-2">
            <label>Name
              <input id="templateName" type="text" autocomplete="off" />
            </label>
            <label>Tagline
              <input id="templateTagline" type="text" autocomplete="off" />
            </label>
          </div>
          <div class="actions">
            <button id="saveMetadata" class="btn btn-primary" type="button">Save metadata</button>
            <a id="previewLink" class="btn btn-secondary" target="_blank" rel="noreferrer">Open preview</a>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Section source</h2>
          <span class="path" id="sectionPath"></span>
        </div>
        <div class="panel-body">
          <label>Section
            <select id="sectionSelect"></select>
          </label>
          <textarea id="sectionSource" spellcheck="false"></textarea>
          <div class="actions">
            <button id="saveSection" class="btn btn-primary" type="button">Save section JSON</button>
          </div>
        </div>
      </section>

      <div id="status" class="status hidden"></div>
    </main>
  </div>
  <script>
    const state = {
      templates: [],
      selectedTemplateId: null,
      document: null,
      selectedSectionId: null,
    };
    const els = {
      templateList: document.getElementById('templateList'),
      templateTitle: document.getElementById('templateTitle'),
      templateMeta: document.getElementById('templateMeta'),
      templateName: document.getElementById('templateName'),
      templateTagline: document.getElementById('templateTagline'),
      previewLink: document.getElementById('previewLink'),
      sectionSelect: document.getElementById('sectionSelect'),
      sectionSource: document.getElementById('sectionSource'),
      sectionPath: document.getElementById('sectionPath'),
      saveMetadata: document.getElementById('saveMetadata'),
      saveSection: document.getElementById('saveSection'),
      status: document.getElementById('status'),
    };
    function displayPath(path) {
      return String(path || '').replace(/\\\\/g, '/');
    }
    function showStatus(kind, message) {
      els.status.className = 'status ' + kind;
      els.status.textContent = message;
      els.status.classList.remove('hidden');
    }
    function hideStatus() {
      els.status.className = 'status hidden';
      els.status.textContent = '';
    }
    async function api(path, options = {}) {
      const response = await fetch(path, options);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || ('Request failed: ' + response.status));
      }
      return body;
    }
    function renderTemplateList() {
      els.templateList.innerHTML = '';
      for (const template of state.templates) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'template-button';
        button.setAttribute('aria-current', String(template.id === state.selectedTemplateId));
        button.innerHTML = '<b></b><span></span>';
        button.querySelector('b').textContent = template.name;
        button.querySelector('span').textContent = template.id + ' · ' + template.sectionCount + ' sections';
        button.addEventListener('click', () => selectTemplate(template.id));
        els.templateList.append(button);
      }
    }
    function currentSection() {
      if (!state.document) return null;
      return state.document.sections.find((section) => section.sectionId === state.selectedSectionId) || null;
    }
    function renderDocument() {
      const doc = state.document;
      if (!doc) return;
      els.templateTitle.textContent = doc.template.name;
      els.templateMeta.textContent = doc.template.id + ' · ' + doc.template.styleKit;
      els.templateName.value = doc.template.name;
      els.templateTagline.value = doc.template.tagline;
      els.previewLink.href = '/preview/' + encodeURIComponent(doc.template.id);
      els.sectionSelect.innerHTML = '';
      for (const section of doc.sections) {
        const option = document.createElement('option');
        option.value = section.sectionId;
        option.textContent = section.slot + ' · ' + section.baseSlug;
        els.sectionSelect.append(option);
      }
      if (!state.selectedSectionId || !doc.sections.some((section) => section.sectionId === state.selectedSectionId)) {
        state.selectedSectionId = doc.sections[0]?.sectionId || null;
      }
      els.sectionSelect.value = state.selectedSectionId || '';
      renderSection();
    }
    function renderSection() {
      const section = currentSection();
      if (!section) {
        els.sectionSource.value = '';
        els.sectionPath.textContent = '';
        return;
      }
      els.sectionSource.value = section.source;
      els.sectionPath.textContent = displayPath(section.filePath);
    }
    async function selectTemplate(templateId) {
      hideStatus();
      state.selectedTemplateId = templateId;
      state.selectedSectionId = null;
      renderTemplateList();
      try {
        state.document = await api('/api/templates/' + encodeURIComponent(templateId));
        renderDocument();
      } catch (error) {
        showStatus('bad', error.message);
      }
    }
    async function saveMetadata() {
      if (!state.selectedTemplateId) return;
      els.saveMetadata.disabled = true;
      try {
        const result = await api('/api/templates/' + encodeURIComponent(state.selectedTemplateId) + '/metadata', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: els.templateName.value,
            tagline: els.templateTagline.value,
          }),
        });
        showStatus('ok', 'Saved ' + displayPath(result.filePath) + '. Restart the app/admin server to reload imported template metadata.');
      } catch (error) {
        showStatus('bad', error.message);
      } finally {
        els.saveMetadata.disabled = false;
      }
    }
    async function saveSection() {
      if (!state.selectedTemplateId || !state.selectedSectionId) return;
      els.saveSection.disabled = true;
      try {
        const result = await api(
          '/api/templates/' + encodeURIComponent(state.selectedTemplateId) + '/sections/' + encodeURIComponent(state.selectedSectionId),
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: els.sectionSource.value }),
          },
        );
        const section = currentSection();
        if (section) section.source = els.sectionSource.value;
        showStatus('ok', 'Saved ' + displayPath(result.filePath) + '. Re-run template smokes before committing.');
      } catch (error) {
        showStatus('bad', error.message);
      } finally {
        els.saveSection.disabled = false;
      }
    }
    els.sectionSelect.addEventListener('change', () => {
      state.selectedSectionId = els.sectionSelect.value;
      renderSection();
    });
    els.saveMetadata.addEventListener('click', saveMetadata);
    els.saveSection.addEventListener('click', saveSection);
    async function boot() {
      try {
        const catalog = await api('/api/templates');
        state.templates = catalog.templates;
        state.selectedTemplateId = state.templates[0]?.id || null;
        renderTemplateList();
        if (state.selectedTemplateId) await selectTemplate(state.selectedTemplateId);
      } catch (error) {
        showStatus('bad', error.message);
      }
    }
    boot();
  </script>
</body>
</html>`;
}

export function createTemplateSourceAdminApp(options: TemplateSourceAdminAppOptions = {}) {
  const app = new Hono<TemplateSourceAdminEnv>();
  const paths = options.paths ?? {};
  const turnstileSiteKey = options.turnstileSiteKey ?? LOCAL_PREVIEW_TURNSTILE_SITE_KEY;

  app.get('/', (c) => c.html(renderPage()));

  app.get('/preview/:templateId', (c) => {
    try {
      return c.html(renderPreviewPage(c.req.param('templateId'), turnstileSiteKey));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get('/dashboard/templates/:templateId/assets/:assetId', async (c) => {
    try {
      if (!getTemplateSeed(c.req.param('templateId'))) {
        throw new Error(
          `template-source-admin: unknown template '${c.req.param('templateId')}'`,
        );
      }
      const response = await localSeedAssetResponse(c.req.param('assetId'), paths);
      if (!response) {
        return c.text('template asset not found', 404);
      }
      return response;
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get('/api/templates', (c) => {
    try {
      return c.json({ templates: getTemplateSourceCatalog() });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get('/api/templates/:templateId', async (c) => {
    try {
      return c.json(await readTemplateSourceDocument(c.req.param('templateId'), paths));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.put('/api/templates/:templateId/metadata', async (c) => {
    try {
      const body = await readJsonObject(c);
      const input: MetadataWriteInput = {};
      if (typeof body.name === 'string') input.name = body.name;
      if (typeof body.tagline === 'string') input.tagline = body.tagline;
      return c.json(await writeTemplateMetadataSource(c.req.param('templateId'), input, paths));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.put('/api/templates/:templateId/sections/:sectionId', async (c) => {
    try {
      const body = await readJsonObject(c);
      if (typeof body.source !== 'string') {
        throw new Error('source must be a string');
      }
      return c.json(
        await writeTemplateSectionSource(
          c.req.param('templateId'),
          c.req.param('sectionId'),
          body.source,
          paths,
        ),
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return app;
}
