// src/routes/dashboard/site-settings.tsx
//
// Dashboard route — GET /dashboard/sites/:siteId/settings
//
// Surfaces site-level settings the Owner can flip without entering the
// canvas editor. Today the only setting is the **password gate** (wishlist
// #9); future site-level toggles dock here.
//
// Page layout:
//   - Card: "Password protection"
//     - Status row: enabled / disabled badge + `passwordSetAt`.
//     - Set / change form: single password input + Save.
//     - Disable button (only visible when enabled).
//
// The inline client script handles both forms via `fetch` to the
// `/api/sites/:siteId/password` endpoints. Page reload on success keeps
// the rendered surface in sync with the DB — no client-side state
// machine.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { customer, site, siteCollaborator } from '../../db/schema';
import { DashboardShell, buildSiteNav } from './shell';
import { Button, Badge, Card } from '../../ui';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const siteSettingsRoute = new Hono<Env>();

siteSettingsRoute.use('*', clerkAuth());
siteSettingsRoute.use('*', requireAuth());

const pageStyles = `
  h1 { font-size: 26px; letter-spacing: -0.01em; margin: 0 0 4px; }
  .lede { margin: 6px 0 28px; color: var(--muted); max-width: 640px; line-height: 1.55; font-size: 14px; }
  .lede code {
    background: rgba(125, 211, 252, 0.10);
    color: var(--accent);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12.5px;
  }

  /* Section-anchor highlight: when arriving via /settings#password etc.,
     pulse the target card briefly so the user sees the destination. */
  .rev01-ui-card { scroll-margin-top: 24px; transition: border-color 0.4s, box-shadow 0.4s; }
  .rev01-ui-card:target {
    border-color: rgba(125, 211, 252, 0.55);
    box-shadow: 0 0 0 3px rgba(125, 211, 252, 0.12);
  }

  /* --- Hosting summary grid -------------------------------------------- */
  .hosting-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-top: 4px;
  }
  .hosting-cell {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
  }
  .hosting-cell .hosting-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--faint);
  }
  .hosting-cell code {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12.5px;
    color: var(--text);
    word-break: break-all;
  }

  /* --- Toggle switch --------------------------------------------------- */
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
  }
  .toggle-text { display: flex; flex-direction: column; gap: 2px; }
  .toggle-text .toggle-label { font-size: 14px; color: var(--text); font-weight: 500; }
  .toggle-text .toggle-state { font-size: 12.5px; color: var(--muted); }
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
    flex-shrink: 0;
  }
  .toggle-switch input {
    position: absolute;
    opacity: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    cursor: pointer;
    z-index: 2;
  }
  .toggle-switch .slider {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--line);
    transition: background 0.16s, border-color 0.16s;
  }
  .toggle-switch .slider::before {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #cbd5f5;
    transition: transform 0.18s ease, background 0.18s;
  }
  .toggle-switch input:checked + .slider {
    background: rgba(125, 211, 252, 0.30);
    border-color: var(--accent);
  }
  .toggle-switch input:checked + .slider::before {
    transform: translateX(20px);
    background: var(--accent);
  }
  .toggle-switch input:focus-visible + .slider {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .toggle-switch input:disabled { cursor: wait; }
  .toggle-switch input:disabled + .slider { opacity: 0.55; }
  .hint {
    margin: 10px 2px 0;
    font-size: 12.5px;
    color: var(--faint);
    line-height: 1.5;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 18px;
  }
  .status-row .meta { color: var(--muted); font-size: 13px; }

  form.pw {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px;
    align-items: end;
  }
  form.pw label {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
  }
  form.pw input[type="password"] {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    padding: 10px 12px;
    font-size: 15px;
    outline: none;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  form.pw input[type="password"]:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(125, 211, 252, 0.15);
  }

  .err, .ok {
    margin-top: 8px;
    font-size: 13px;
    min-height: 18px;
  }
  .err { color: #fca5a5; }
  .ok { color: #86efac; }

  .collab-form {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 10px;
    align-items: end;
  }
  .collab-form label {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
  }
  .collab-form input[type="email"],
  .collab-form select {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    padding: 10px 12px;
    font-size: 14px;
    outline: none;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .collab-form input[type="email"]:focus,
  .collab-form select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(125, 211, 252, 0.15);
  }

  .collab-list { list-style: none; padding: 0; margin: 16px 0 0; }
  .collab-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
    font-size: 14px;
    margin-bottom: 8px;
  }
  .collab-item:last-child { margin-bottom: 0; }
  .collab-item .email { flex: 1; color: var(--text); }
  .collab-item .role-badge {
    font-size: 11px;
    padding: 3px 9px;
    border-radius: 10px;
    background: rgba(34,211,238,0.15);
    color: #22d3ee;
    text-transform: capitalize;
  }
  .collab-item .status-badge {
    font-size: 11px;
    padding: 3px 9px;
    border-radius: 10px;
    text-transform: capitalize;
  }
  .collab-item .status-badge.pending {
    background: rgba(250,204,21,0.15);
    color: #facc15;
  }
  .collab-item .status-badge.active {
    background: rgba(134,239,172,0.15);
    color: #86efac;
  }
  .collab-item .remove-btn {
    background: transparent;
    border: 1px solid rgba(252,165,165,0.30);
    color: #fca5a5;
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .collab-item .remove-btn:hover {
    background: rgba(248, 113, 113, 0.08);
    color: #fda4a4;
    border-color: rgba(248, 113, 113, 0.55);
  }
`;

interface OwnedSite {
  id: string;
  name: string;
  subdomain: string;
  passwordEnabled: boolean;
  passwordSetAt: Date | null;
  styleKit: string;
  publishedVersion: number;
  siteNoIndex: boolean;
  darkModeEnabled: boolean;
}

async function lookupOwnedSite(
  env: Bindings,
  clerkUserId: string,
  siteId: string,
): Promise<OwnedSite | null> {
  const database = db(env);
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, clerkUserId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return null;

  const rows = await database
    .select({
      id: site.id,
      name: site.name,
      subdomain: site.subdomain,
      passwordEnabled: site.passwordEnabled,
      passwordSetAt: site.passwordSetAt,
      styleKit: site.styleKit,
      publishedVersion: site.publishedVersion,
      editableState: site.editableState,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    passwordEnabled: row.passwordEnabled,
    passwordSetAt: row.passwordSetAt,
    styleKit: row.styleKit,
    publishedVersion: row.publishedVersion,
    siteNoIndex: row.editableState.siteNoIndex ?? false,
    darkModeEnabled: row.editableState.darkModeEnabled ?? false,
  };
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function clientScript(siteId: string): string {
  const sid = JSON.stringify(siteId);
  return String.raw`
(() => {
  const SITE_ID = ${sid};
  const form = document.querySelector('form.pw');
  const disableBtn = document.querySelector('button[data-action="disable"]');
  const err = document.querySelector('.err');
  const ok = document.querySelector('.ok');
  function clearStatus() {
    if (err) err.textContent = '';
    if (ok) ok.textContent = '';
  }
  function showError(msg) { clearStatus(); if (err) err.textContent = msg; }
  function showOk(msg) { clearStatus(); if (ok) ok.textContent = msg; }
  async function responseDetail(response) {
    const bodyText = (await response.text()).trim();
    return bodyText || response.statusText;
  }
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = form.querySelector('input[name="password"]');
      const button = form.querySelector('button[type="submit"]');
      const password = (input && input.value) ? input.value : '';
      if (password.length < 4) {
        showError('Password must be at least 4 characters');
        return;
      }
      clearStatus();
      if (button) button.disabled = true;
      try {
        const response = await fetch('/api/sites/' + encodeURIComponent(SITE_ID) + '/password', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (!response.ok) {
          const detail = await responseDetail(response);
          showError(detail);
          if (button) button.disabled = false;
          return;
        }
        showOk('Password updated.');
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        showError('Network error: ' + (e && e.message ? e.message : String(e)));
        if (button) button.disabled = false;
      }
    });
  }
  if (disableBtn) {
    disableBtn.addEventListener('click', async () => {
      if (!await __rev01Modal.confirm('Disable password protection? Visitors will be able to view this site without a password.', { title: 'Disable protection' })) return;
      disableBtn.disabled = true;
      try {
        const response = await fetch('/api/sites/' + encodeURIComponent(SITE_ID) + '/password', {
          method: 'DELETE',
          headers: { 'accept': 'application/json' },
        });
        if (!response.ok) {
          const detail = await responseDetail(response);
          showError('Could not disable: ' + detail);
          disableBtn.disabled = false;
          return;
        }
        showOk('Password protection disabled.');
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        showError('Network error: ' + (e && e.message ? e.message : String(e)));
        disableBtn.disabled = false;
      }
    });
  }
})();

(() => {
  const SITE_ID = ${sid};
  const collabForm = document.querySelector('[data-collab-form]');
  const collabErr = document.querySelector('[data-collab-err]');
  const collabOk = document.querySelector('[data-collab-ok]');
  const collabList = document.querySelector('[data-collab-list]');

  function clearCollabStatus() {
    if (collabErr) collabErr.textContent = '';
    if (collabOk) collabOk.textContent = '';
  }
  async function responseDetail(response) {
    const bodyText = (await response.text()).trim();
    return bodyText || response.statusText;
  }

  if (collabForm) {
    collabForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const emailInput = collabForm.querySelector('input[name="email"]');
      const roleSelect = collabForm.querySelector('select[name="role"]');
      const submitBtn = collabForm.querySelector('button[type="submit"]');
      const email = emailInput ? emailInput.value.trim() : '';
      const role = roleSelect ? roleSelect.value : 'editor';
      if (!email) return;
      clearCollabStatus();
      if (submitBtn) submitBtn.disabled = true;
      try {
        const response = await fetch('/api/sites/' + encodeURIComponent(SITE_ID) + '/collaborators', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify({ email, role }),
        });
        if (!response.ok) {
          const detail = await responseDetail(response);
          if (collabErr) collabErr.textContent = detail;
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        if (collabOk) collabOk.textContent = 'Invitation sent to ' + email;
        if (emailInput) emailInput.value = '';
        setTimeout(() => location.reload(), 1200);
      } catch (e) {
        if (collabErr) collabErr.textContent = 'Network error: ' + (e && e.message ? e.message : String(e));
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  if (collabList) {
    collabList.addEventListener('click', async (event) => {
      const btn = event.target instanceof Element ? event.target.closest('[data-remove-collab]') : null;
      if (!btn) return;
      const collabId = btn.getAttribute('data-remove-collab');
      if (!collabId) return;
      if (!await __rev01Modal.confirm('Remove this collaborator?', { title: 'Remove collaborator', confirmLabel: 'Remove', danger: true })) return;
      btn.disabled = true;
      clearCollabStatus();
      try {
        const response = await fetch('/api/sites/' + encodeURIComponent(SITE_ID) + '/collaborators/' + encodeURIComponent(collabId), {
          method: 'DELETE',
          headers: { 'accept': 'application/json' },
        });
        if (!response.ok) {
          const detail = await responseDetail(response);
          if (collabErr) collabErr.textContent = detail;
          btn.disabled = false;
          return;
        }
        const item = btn.closest('.collab-item');
        if (item) item.remove();
      } catch (e) {
        if (collabErr) collabErr.textContent = 'Network error: ' + (e && e.message ? e.message : String(e));
        btn.disabled = false;
      }
    });
  }
})();

// Site-config toggles (search indexing, visitor dark mode). Each toggle
// checkbox carries data-config-key (the API field) and an optional
// data-invert=true for the SEO case (UI shows indexable, API stores noindex).
// Failures revert the checkbox and surface a status message.
(() => {
  const SITE_ID = ${sid};
  const toggles = document.querySelectorAll('input[data-config-key]');
  toggles.forEach((cb) => {
    cb.addEventListener('change', async () => {
      const key = cb.getAttribute('data-config-key');
      const inverted = cb.getAttribute('data-invert') === 'true';
      const apiValue = inverted ? !cb.checked : cb.checked;
      const stateEl = cb.closest('.toggle-row')?.querySelector('[data-toggle-state]');
      const stateOn = cb.getAttribute('data-on-label') ?? 'On';
      const stateOff = cb.getAttribute('data-off-label') ?? 'Off';
      const prevDisabled = cb.disabled;
      cb.disabled = true;
      try {
        const response = await fetch('/api/canvas/sites/' + encodeURIComponent(SITE_ID) + '/config', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify({ [key]: apiValue }),
        });
        if (!response.ok) {
          const bodyText = (await response.text()).trim();
          cb.checked = !cb.checked;
          alert('Could not save: ' + (bodyText || response.statusText));
          return;
        }
        if (stateEl) stateEl.textContent = cb.checked ? stateOn : stateOff;
      } catch (e) {
        cb.checked = !cb.checked;
        alert('Network error: ' + (e && e.message ? e.message : String(e)));
      } finally {
        cb.disabled = prevDisabled;
      }
    });
  });
})();
`;
}

siteSettingsRoute.get('/sites/:siteId/settings', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('site-settings route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.text('site not found', 404);
  }
  const owned = await lookupOwnedSite(c.env, auth.userId, siteId);
  if (!owned) {
    return c.text('site not found', 404);
  }

  const enabled = owned.passwordEnabled;
  const setAtLine = owned.passwordSetAt
    ? `Last changed ${owned.passwordSetAt.toISOString()}`
    : 'Never set';

  const database = db(c.env);
  const collaborators = await database
    .select({
      id: siteCollaborator.id,
      email: siteCollaborator.invitedEmail,
      role: siteCollaborator.role,
      acceptedAt: siteCollaborator.acceptedAt,
    })
    .from(siteCollaborator)
    .where(eq(siteCollaborator.siteId, siteId));

  return c.html(
    <DashboardShell
      title={`${owned.name} — settings`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${esc(siteId)}/edit`, label: owned.name },
        { label: 'Settings' },
      ]}
      pageStyles={pageStyles}
      siteNav={buildSiteNav(owned.id, owned.name, `/dashboard/sites/${owned.id}/settings`)}
    >
      <h1>Settings</h1>
      <p class="lede">
        Per-site controls for the published address{' '}
        <code>{owned.subdomain}.rev01.aayushman.dev</code>.
      </p>

      <Card class="hosting-card" id="hosting">
        <h2>Hosting</h2>
        <p class="sub">
          Where this site lives and how visitors reach it. Plan, region, and CDN are managed by
          rev01; the publish status and address are yours to change.
        </p>
        <div class="hosting-grid">
          <div class="hosting-cell">
            <span class="hosting-label">Plan</span>
            <Badge variant="info">Starter</Badge>
          </div>
          <div class="hosting-cell">
            <span class="hosting-label">CDN</span>
            <Badge variant="info">Cloudflare Edge</Badge>
          </div>
          <div class="hosting-cell">
            <span class="hosting-label">Style kit</span>
            <Badge variant="neutral">{owned.styleKit}</Badge>
          </div>
          <div class="hosting-cell">
            <span class="hosting-label">Status</span>
            {owned.publishedVersion > 0 ? (
              <Badge variant="success">Live · v{String(owned.publishedVersion)}</Badge>
            ) : (
              <Badge variant="warning">Draft</Badge>
            )}
          </div>
          <div class="hosting-cell" style="grid-column: 1 / -1">
            <span class="hosting-label">Address</span>
            <code>{owned.subdomain}.rev01.aayushman.dev</code>
          </div>
        </div>
      </Card>

      <Card id="password">
        <h2>Password protection</h2>
        <p class="sub">
          When enabled, visitors must enter a password before they see any page of this site. The
          same password applies to every page. Changing the password signs out everyone who
          previously unlocked the site — they'll have to re-enter the new password.
        </p>
        <div class="status-row">
          <Badge variant={enabled ? 'success' : 'neutral'}>
            {enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <span class="meta">{setAtLine}</span>
        </div>
        <form class="pw" autocomplete="off">
          <label>
            <span>{enabled ? 'Change password' : 'Set password'}</span>
            <input
              type="password"
              name="password"
              autocomplete="new-password"
              placeholder="At least 4 characters"
              minlength={4}
              maxlength={200}
              required
            />
          </label>
          <Button variant="primary" type="submit">
            {enabled ? 'Update' : 'Enable'}
          </Button>
        </form>
        <p class="err" role="alert" aria-live="polite"></p>
        <p class="ok" role="status" aria-live="polite"></p>
        {enabled ? (
          <Button variant="danger" data-action="disable">
            Disable password protection
          </Button>
        ) : null}
      </Card>

      <Card id="seo">
        <h2>Search indexing</h2>
        <p class="sub">
          Allow search engines like Google and Bing to index this site and surface it in results.
          Turn this off if you're publishing privately or want to delay public discovery.
        </p>
        <div class="toggle-row">
          <div class="toggle-text">
            <span class="toggle-label">Allow search engines to index this site</span>
            <span class="toggle-state" data-toggle-state>
              {owned.siteNoIndex ? 'Hidden from search' : 'Visible in search'}
            </span>
          </div>
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={!owned.siteNoIndex}
              data-config-key="siteNoIndex"
              data-invert="true"
              data-on-label="Visible in search"
              data-off-label="Hidden from search"
              aria-label="Allow search engines to index this site"
            />
            <span class="slider" aria-hidden="true"></span>
          </label>
        </div>
        <p class="hint">Takes effect at the next publish — emits <code>&lt;meta name="robots"&gt;</code> across every page.</p>
      </Card>

      <Card id="dark-mode">
        <h2>Visitor dark mode</h2>
        <p class="sub">
          When on, the public site exposes a light/dark toggle to visitors and ships both token
          blocks. When off, your site is locked to the Style Kit's default mode.
        </p>
        <div class="toggle-row">
          <div class="toggle-text">
            <span class="toggle-label">Let visitors switch between light and dark</span>
            <span class="toggle-state" data-toggle-state>
              {owned.darkModeEnabled ? 'Toggleable by visitors' : 'Locked to default mode'}
            </span>
          </div>
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={owned.darkModeEnabled}
              data-config-key="darkModeEnabled"
              data-on-label="Toggleable by visitors"
              data-off-label="Locked to default mode"
              aria-label="Let visitors switch between light and dark"
            />
            <span class="slider" aria-hidden="true"></span>
          </label>
        </div>
        <p class="hint">Takes effect at the next publish — adds the visitor-mode CSS and toggle script to the published site.</p>
      </Card>

      <Card id="collaborators">
        <h2>Collaborators</h2>
        <p class="sub">
          Add people by email to let them edit this site. They must have a rev01 account. An
          invitation email will be sent when you add them.
        </p>
        <form class="collab-form" data-collab-form autocomplete="off">
          <label>
            <span>Email address</span>
            <input type="email" name="email" placeholder="collaborator@example.com" required />
          </label>
          <label>
            <span>Role</span>
            <select name="role">
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <Button variant="primary" type="submit">
            Invite
          </Button>
        </form>
        <p class="err" data-collab-err role="alert" aria-live="polite"></p>
        <p class="ok" data-collab-ok role="status" aria-live="polite"></p>
        <ul class="collab-list" data-collab-list>
          {collaborators.map((collab) => (
            <li class="collab-item" data-collab-id={collab.id}>
              <span class="email">{collab.email}</span>
              <span class="role-badge">{collab.role}</span>
              <span class={`status-badge ${collab.acceptedAt ? 'active' : 'pending'}`}>
                {collab.acceptedAt ? 'active' : 'pending'}
              </span>
              <button type="button" class="remove-btn" data-remove-collab={collab.id}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <script type="module">{raw(clientScript(siteId))}</script>
    </DashboardShell>,
  );
});

export default siteSettingsRoute;
