import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth } from '../../auth/middleware';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { isTemplateSourceAdminCustomer } from '../../auth/db-admin';
import { requireAuth } from '../../auth/require-auth';
import { readThemeCookie } from '../../ui';
import { DashboardShell } from './shell';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  ADMIN_CLERK_USER_IDS?: string;
  TURNSTILE_SITE_KEY?: string;
};

type AdminTemplatesEnv = {
  Bindings: Bindings;
  Variables: ClerkAuthVariables;
};

const adminTemplatesRoute = new Hono<AdminTemplatesEnv>();

adminTemplatesRoute.use('*', clerkAuth());
adminTemplatesRoute.use('*', requireAuth());
adminTemplatesRoute.use('*', async (c, next) => {
  const auth = c.get('auth');
  const customerRecord = c.get('customer');
  if (!customerRecord) {
    throw new Error('visual template admin reached with authenticated user but no customer row');
  }
  if (!isTemplateSourceAdminCustomer(customerRecord, auth.userId, c.env.ADMIN_CLERK_USER_IDS)) {
    return c.text('admin access required', 403);
  }
  await next();
});

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
  .visual-admin {
    display: grid;
    grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
    gap: 24px;
    align-items: start;
  }
  .admin-sidebar,
  .admin-panel {
    border: 1px solid var(--line);
    border-radius: var(--r);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .admin-sidebar {
    padding: 18px;
    display: grid;
    gap: 20px;
    max-height: 85vh;
    overflow: auto;
  }
  .curated-list {
    display: grid;
    gap: 8px;
    max-height: 320px;
    overflow-y: auto;
    border: 1px solid var(--line-2);
    border-radius: var(--r-xs);
    padding: 8px;
  }
  .curated-item {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
    background: var(--surface);
    color: var(--ink);
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .curated-item:hover {
    background: var(--surface-2);
  }
  .curated-item[aria-current="true"] {
    border-color: var(--red);
    box-shadow: 0 0 0 2px var(--red-tint);
    background: var(--surface-2);
  }
  .curated-item b {
    font-family: var(--display);
    font-size: 15px;
    line-height: 1.2;
  }
  .curated-item span {
    color: var(--ink-3);
    font-size: 11px;
    font-family: var(--mono);
  }
  .status-badge {
    align-self: flex-start;
    display: inline-block;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 700;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .status-badge[data-status="drafting"] { background: #fef3c7; color: #d97706; }
  .status-badge[data-status="published"] { background: #d1fae5; color: #059669; }
  .status-badge[data-status="unpublished"] { background: #f3f4f6; color: #4b5563; }
  
  .admin-panel {
    display: grid;
    overflow: hidden;
  }
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--line);
  }
  .panel-head h2 {
    margin: 0;
    font-size: 20px;
    letter-spacing: 0;
  }
  .panel-body {
    display: grid;
    gap: 20px;
    padding: 20px;
  }
  .creator-form {
    border-top: 1px solid var(--line);
    padding-top: 16px;
    display: grid;
    gap: 12px;
  }
  .creator-form h3 {
    margin: 0;
    font-size: 14px;
    color: var(--ink-2);
    font-weight: 700;
  }
  .field {
    display: grid;
    gap: 6px;
  }
  .field label {
    color: var(--ink-3);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .field input, .field select {
    min-height: 38px;
    border: 1px solid var(--line-2);
    border-radius: var(--r-xs);
    background: var(--surface);
    color: var(--ink);
    padding: 6px 10px;
    font-size: 14px;
  }
  .actions-grid {
    display: grid;
    gap: 16px;
    border-top: 1px solid var(--line);
    padding-top: 16px;
  }
  .actions-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  }
  .danger-zone {
    border-top: 1px solid var(--line-2);
    padding-top: 16px;
    margin-top: 8px;
    display: grid;
    gap: 12px;
  }
  .danger-zone h4 {
    margin: 0;
    font-size: 13px;
    color: var(--red-ink);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .loading-overlay {
    opacity: 0.55;
    pointer-events: none;
  }
  .status-banner {
    border-left: 4px solid var(--line-2);
    border-radius: var(--r-xs);
    background: var(--surface-2);
    color: var(--ink-2);
    min-height: 38px;
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.45;
  }
  .status-banner[data-kind="ok"] { border-left-color: #059669; color: #059669; background: #ecfdf5; }
  .status-banner[data-kind="bad"] { border-left-color: var(--red); color: var(--red-ink); background: var(--red-tint); }
  @media (max-width: 768px) {
    .visual-admin { grid-template-columns: 1fr; }
  }
`;

const adminScript = `
(() => {
  const apiBase = '/api/admin/custom-templates';
  const state = { templates: [], selectedTemplateId: null };
  const els = {
    root: document.querySelector('[data-visual-admin]'),
    curatedList: document.getElementById('curatedList'),
    detailPlaceholder: document.getElementById('detailPlaceholder'),
    detailContent: document.getElementById('detailContent'),
    templateTitle: document.getElementById('templateTitle'),
    templateTagline: document.getElementById('templateTagline'),
    templateStatus: document.getElementById('templateStatus'),
    templateUpdated: document.getElementById('templateUpdated'),
    editDraftBtn: document.getElementById('editDraftBtn'),
    publishBtn: document.getElementById('publishBtn'),
    unpublishBtn: document.getElementById('unpublishBtn'),
    duplicateDraftBtn: document.getElementById('duplicateDraftBtn'),
    deleteConfirmName: document.getElementById('deleteConfirmName'),
    deleteBtn: document.getElementById('deleteBtn'),
    renameName: document.getElementById('renameName'),
    renameTagline: document.getElementById('renameTagline'),
    renameBtn: document.getElementById('renameBtn'),
    statusBanner: document.getElementById('statusBanner'),
  };

  function api(path, options = {}) {
    return fetch(apiBase + path, options).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Request failed with status ' + response.status);
      return body;
    });
  }

  function setLoading(loading) {
    els.root.classList.toggle('loading-overlay', Boolean(loading));
  }

  function showStatus(kind, message) {
    els.statusBanner.dataset.kind = kind;
    els.statusBanner.textContent = message;
    els.statusBanner.hidden = !message;
  }

  function renderTemplates() {
    els.curatedList.textContent = '';

    if (state.templates.length === 0) {
      els.curatedList.innerHTML = '<div style="color:var(--ink-3);font-size:13px;padding:8px;">No custom templates found.</div>';
      return;
    }

    for (const tmpl of state.templates) {
      // Sidebar item
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'curated-item';
      item.setAttribute('aria-current', String(tmpl.id === state.selectedTemplateId));
      
      const title = document.createElement('b');
      title.textContent = tmpl.name;
      
      const badge = document.createElement('span');
      badge.className = 'status-badge';
      badge.dataset.status = tmpl.publicationStatus;
      badge.textContent = tmpl.publicationStatus;
      
      const meta = document.createElement('span');
      meta.textContent = tmpl.id + (tmpl.sourceTemplateId ? ' / overrides ' + tmpl.sourceTemplateId : '');
      
      item.append(title, badge, meta);
      item.addEventListener('click', () => selectTemplate(tmpl.id));
      els.curatedList.append(item);
    }
  }

  function selectTemplate(templateId) {
    state.selectedTemplateId = templateId;
    renderTemplates();
    
    const tmpl = state.templates.find(t => t.id === templateId);
    if (!tmpl) {
      els.detailContent.style.display = 'none';
      els.detailPlaceholder.style.display = 'block';
      return;
    }

    els.detailPlaceholder.style.display = 'none';
    els.detailContent.style.display = 'block';
    
    els.templateTitle.textContent = tmpl.name;
    els.templateTagline.textContent = tmpl.tagline || 'No tagline defined';
    els.templateStatus.textContent = tmpl.publicationStatus;
    els.templateStatus.className = 'status-badge';
    els.templateStatus.dataset.status = tmpl.publicationStatus;
    els.templateUpdated.textContent = new Date(tmpl.updatedAt).toLocaleString();

    // Inputs for edit details
    els.renameName.value = tmpl.name;
    els.renameTagline.value = tmpl.tagline || '';

    // Clear confirmation inputs
    els.deleteConfirmName.value = '';

    // The editor route calls ensureCuratedTemplateDraft, so migrated curated
    // templates with a null templateDraftSiteId can still be opened here.
    els.editDraftBtn.style.display = 'inline-flex';
    els.editDraftBtn.href = '/dashboard/admin/templates/' + encodeURIComponent(tmpl.id) + '/edit';

    if (tmpl.publicationStatus === 'published') {
      els.publishBtn.style.display = 'none';
      els.unpublishBtn.style.display = 'inline-flex';
    } else {
      els.publishBtn.style.display = 'inline-flex';
      els.unpublishBtn.style.display = 'none';
    }

    els.duplicateDraftBtn.style.display = 'inline-flex';
    showStatus('', '');
  }

  // Update details (PATCH)
  els.renameBtn.addEventListener('click', async () => {
    if (!state.selectedTemplateId) return;
    setLoading(true);
    showStatus('', 'Updating template details...');
    try {
      await api('/' + encodeURIComponent(state.selectedTemplateId), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: els.renameName.value,
          tagline: els.renameTagline.value,
        }),
      });
      showStatus('ok', 'Template details updated.');
      await refresh();
    } catch (err) {
      showStatus('bad', err.message);
    } finally {
      setLoading(false);
    }
  });

  // Publish
  els.publishBtn.addEventListener('click', async () => {
    if (!state.selectedTemplateId) return;
    setLoading(true);
    showStatus('', 'Publishing template draft...');
    try {
      await api('/' + encodeURIComponent(state.selectedTemplateId) + '/publish', {
        method: 'POST',
      });
      showStatus('ok', 'Template draft successfully published global.');
      await refresh();
    } catch (err) {
      showStatus('bad', err.message);
    } finally {
      setLoading(false);
    }
  });

  // Unpublish
  els.unpublishBtn.addEventListener('click', async () => {
    if (!state.selectedTemplateId) return;
    setLoading(true);
    showStatus('', 'Unpublishing template...');
    try {
      await api('/' + encodeURIComponent(state.selectedTemplateId) + '/unpublish', {
        method: 'POST',
      });
      showStatus('ok', 'Template successfully unpublished.');
      await refresh();
    } catch (err) {
      showStatus('bad', err.message);
    } finally {
      setLoading(false);
    }
  });

  // Duplicate draft
  els.duplicateDraftBtn.addEventListener('click', async () => {
    if (!state.selectedTemplateId) return;
    setLoading(true);
    showStatus('', 'Duplicating draft template...');
    try {
      const result = await api('/' + encodeURIComponent(state.selectedTemplateId) + '/duplicate', {
        method: 'POST',
      });
      showStatus('ok', 'Draft template successfully duplicated.');
      await refresh(result.templateId);
    } catch (err) {
      showStatus('bad', err.message);
    } finally {
      setLoading(false);
    }
  });

  // Delete
  els.deleteBtn.addEventListener('click', async () => {
    if (!state.selectedTemplateId) return;
    const confirmationName = els.deleteConfirmName.value.trim();
    if (!confirmationName) {
      showStatus('bad', 'Please type the template name exactly to confirm deletion.');
      return;
    }
    setLoading(true);
    showStatus('', 'Deleting template...');
    try {
      await api('/' + encodeURIComponent(state.selectedTemplateId), {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmationName }),
      });
      showStatus('ok', 'Template successfully deleted.');
      await refresh(null);
    } catch (err) {
      showStatus('bad', err.message);
    } finally {
      setLoading(false);
    }
  });

  async function refresh(targetId = state.selectedTemplateId) {
    const catalog = await api('/');
    state.templates = catalog.templates;
    if (targetId && state.templates.some(t => t.id === targetId)) {
      selectTemplate(targetId);
    } else if (state.templates.length > 0) {
      selectTemplate(state.templates[0].id);
    } else {
      state.selectedTemplateId = null;
      renderTemplates();
      els.detailContent.style.display = 'none';
      els.detailPlaceholder.style.display = 'block';
    }
  }

  async function boot() {
    setLoading(true);
    try {
      await refresh();
    } catch (err) {
      showStatus('bad', err.message);
    } finally {
      setLoading(false);
    }
  }

  boot();
})();
`;

adminTemplatesRoute.get('/', (c) => {
  const customerRecord = c.get('customer');
  if (!customerRecord) {
    throw new Error('visual template admin page reached without customer row');
  }

  return c.html(
    <DashboardShell
      title="Open Canvas - curated custom templates"
      crumbs={[{ href: '/dashboard', label: 'Dashboard' }, { label: 'Curated templates' }]}
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
        <h1>Curated templates</h1>
        <a href="/dashboard/admin/template-source" class="btn btn-secondary">
          Source editor
        </a>
      </div>

      <div class="visual-admin" data-visual-admin>
        {/* Sidebar */}
        <aside class="admin-sidebar">
          <div>
            <h2 style="font-size: 16px; margin-top: 0; margin-bottom: 12px;">Curated templates</h2>
            <div id="curatedList" class="curated-list">
              Loading curated templates…
            </div>
          </div>

          <p style="margin: 0; font-size: 12px; color: var(--ink-3); line-height: 1.5;">
            Built-in templates are imported automatically. Select one to edit and
            publish, or use <b>Duplicate</b> on any template to spin off a variant.
          </p>
        </aside>

        {/* Detail Panel */}
        <section class="admin-panel">
          <div class="panel-head">
            <h2>Template Details</h2>
            <div id="statusBanner" class="status-banner" hidden />
          </div>

          <div id="detailPlaceholder" class="panel-body" style="color:var(--ink-3);font-size:14px;padding:40px;text-align:center;">
            Select a custom template from the sidebar list to manage it.
          </div>

          <div id="detailContent" class="panel-body" style="display: none;">
            <div>
              <h2 id="templateTitle" style="margin-top: 0; margin-bottom: 8px;" />
              <p id="templateTagline" style="color: var(--ink-3); margin-top: 0; margin-bottom: 16px; font-size: 15px;" />
            </div>

            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:16px; border:1px solid var(--line-2); padding:14px; border-radius:var(--r-xs);">
              <div class="field">
                <label>Publication Status</label>
                <span id="templateStatus" />
              </div>
              <div class="field">
                <label>Last Updated</label>
                <span id="templateUpdated" style="font-size:13px; font-family:var(--mono);" />
              </div>
            </div>

            {/* Rename form details */}
            <div style="display: grid; gap: 12px; max-width: 500px; margin-top: 8px;">
              <h3 style="margin: 0; font-size: 14px; color: var(--ink-2); font-weight: 700;">Update Metadata</h3>
              <div class="field">
                <label for="renameName">Template Name</label>
                <input id="renameName" type="text" required />
              </div>
              <div class="field">
                <label for="renameTagline">Tagline</label>
                <input id="renameTagline" type="text" />
              </div>
              <button id="renameBtn" class="btn btn-secondary" type="button" style="align-self: flex-start;">
                Update details
              </button>
            </div>

            <div class="actions-grid">
              <h3 style="margin: 0; font-size: 14px; color: var(--ink-2); font-weight: 700;">Actions</h3>
              <div class="actions-row">
                <a id="editDraftBtn" class="btn btn-primary" style="display: none; align-items: center; justify-content: center;">
                  Edit draft
                </a>
                <button id="publishBtn" class="btn btn-secondary" type="button" style="display: none;">
                  Publish
                </button>
                <button id="unpublishBtn" class="btn btn-secondary" type="button" style="display: none;">
                  Unpublish
                </button>
                <button id="duplicateDraftBtn" class="btn btn-secondary" type="button" style="display: none;">
                  Duplicate draft
                </button>
              </div>
            </div>

            <div class="danger-zone">
              <h4>Danger Zone</h4>
              <p style="margin: 0; font-size: 13px; color: var(--ink-3);">
                Deleting a template removes it permanently. To delete, type the name of the template exactly as shown below:
              </p>
              <div style="display: flex; gap: 12px; align-items: center; max-width: 500px;">
                <input id="deleteConfirmName" type="text" placeholder="Type template name to confirm" style="flex: 1; min-height: 38px; border:1px solid var(--line-2); border-radius:var(--r-xs); padding:6px 10px; font-size:14px;" />
                <button id="deleteBtn" class="btn btn-danger" type="button">
                  Delete
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <script>{raw(adminScript)}</script>
    </DashboardShell>,
  );
});

export default adminTemplatesRoute;
