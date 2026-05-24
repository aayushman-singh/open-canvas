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
import { DashboardShell } from './shell';

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
  .lede { margin: 8px 0 24px; color: var(--muted); max-width: 640px; line-height: 1.55; }
  .card {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    padding: 22px;
    margin-bottom: 18px;
  }
  .card h2 {
    margin: 0 0 8px;
    font-size: 18px;
    letter-spacing: 0;
  }
  .card .sub {
    margin: 0 0 18px;
    color: var(--muted);
    max-width: 760px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 600;
  }
  .badge.success {
    background: rgba(74, 222, 128, 0.1);
    border-color: rgba(74, 222, 128, 0.35);
    color: #86efac;
  }
  .badge.neutral {
    background: rgba(148, 163, 184, 0.12);
    border-color: rgba(148, 163, 184, 0.28);
    color: #cbd5e1;
  }
  .button {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 10px 14px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .button.primary {
    border-color: #7dd3fc;
    background: #7dd3fc;
    color: #082f49;
  }
  .button.danger {
    margin-top: 10px;
    border-color: rgba(248, 113, 113, 0.35);
    background: rgba(248, 113, 113, 0.1);
    color: #fca5a5;
  }
  .button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
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
    gap: 8px;
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
    background: #0c1220;
    color: var(--text);
    padding: 10px 12px;
    font-size: 15px;
  }
  .err {
    margin-top: 8px;
    color: #fca5a5;
    font-size: 13px;
    min-height: 18px;
  }
  .ok {
    margin-top: 8px;
    color: #86efac;
    font-size: 13px;
    min-height: 18px;
  }
  .collab-form {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 8px;
    align-items: end;
  }
  .collab-form label {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
  }
  .collab-form input[type="email"] {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #0c1220;
    color: var(--text);
    padding: 10px 12px;
    font-size: 15px;
  }
  .collab-form select {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #0c1220;
    color: var(--text);
    padding: 10px 12px;
    font-size: 14px;
  }
  .collab-list { list-style: none; padding: 0; margin: 16px 0 0; }
  .collab-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
    font-size: 14px;
  }
  .collab-item .email { flex: 1; }
  .collab-item .role-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(34,211,238,0.15);
    color: #22d3ee;
  }
  .collab-item .status-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
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
    background: none;
    border: 1px solid rgba(252,165,165,0.3);
    color: #fca5a5;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }
`;

interface OwnedSite {
  id: string;
  name: string;
  subdomain: string;
  passwordEnabled: boolean;
  passwordSetAt: Date | null;
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
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  return rows[0] ?? null;
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
      if (!confirm('Disable password protection? Visitors will be able to view this site without a password.')) return;
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
      if (!confirm('Remove this collaborator?')) return;
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
    >
      <h1>Settings</h1>
      <p class="lede">
        Per-site controls for the published address{' '}
        <code>{owned.subdomain}.rev01.aayushman.dev</code>.
      </p>

      <section class="card">
        <h2>Password protection</h2>
        <p class="sub">
          When enabled, visitors must enter a password before they see any page of this site. The
          same password applies to every page. Changing the password signs out everyone who
          previously unlocked the site — they'll have to re-enter the new password.
        </p>
        <div class="status-row">
          <span class={`badge ${enabled ? 'success' : 'neutral'}`}>
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
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
          <button class="button primary" type="submit">
            {enabled ? 'Update' : 'Enable'}
          </button>
        </form>
        <p class="err" role="alert" aria-live="polite"></p>
        <p class="ok" role="status" aria-live="polite"></p>
        {enabled ? (
          <button class="button danger" type="button" data-action="disable">
            Disable password protection
          </button>
        ) : null}
      </section>

      <section class="card">
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
          <button class="button primary" type="submit">
            Invite
          </button>
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
      </section>

      <script type="module">{raw(clientScript(siteId))}</script>
    </DashboardShell>,
  );
});

export default siteSettingsRoute;
