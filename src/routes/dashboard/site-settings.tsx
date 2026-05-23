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
import { customer, site } from '../../db/schema';
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
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    margin-bottom: 18px;
  }
  .card h2 {
    margin: 0 0 6px;
    font-size: 18px;
    letter-spacing: -0.005em;
  }
  .card .sub {
    margin: 0 0 16px;
    color: var(--muted);
    font-size: 13.5px;
    line-height: 1.55;
  }
  .status-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 18px;
  }
  .badge {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 4px 8px;
    border-radius: 999px;
    border: 1px solid var(--line);
  }
  .badge.on {
    background: rgba(74, 222, 128, 0.1);
    border-color: rgba(74, 222, 128, 0.4);
    color: #86efac;
  }
  .badge.off {
    background: rgba(148, 163, 184, 0.1);
    border-color: rgba(148, 163, 184, 0.32);
    color: #cbd5e1;
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
  form.pw button {
    border: 0;
    border-radius: 6px;
    background: var(--accent);
    color: #05111a;
    padding: 11px 16px;
    font-weight: 700;
    cursor: pointer;
  }
  form.pw button[disabled] { opacity: 0.5; cursor: not-allowed; }
  .danger {
    margin-top: 14px;
  }
  .danger button {
    border: 1px solid rgba(248, 113, 113, 0.5);
    border-radius: 6px;
    background: transparent;
    color: #fca5a5;
    padding: 9px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  .danger button:hover {
    background: rgba(248, 113, 113, 0.08);
    color: #fda4a4;
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
          let detail = response.statusText;
          try {
            const body = await response.json();
            if (body && body.error) detail = body.error;
          } catch (_) { /* noop */ }
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
          let detail = response.statusText;
          try {
            const body = await response.json();
            if (body && body.error) detail = body.error;
          } catch (_) { /* noop */ }
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
        Per-site controls for the published address <code>{owned.subdomain}.rev01.aayushman.dev</code>.
      </p>

      <section class="card">
        <h2>Password protection</h2>
        <p class="sub">
          When enabled, visitors must enter a password before they see any page of this site.
          The same password applies to every page. Changing the password signs out everyone who
          previously unlocked the site — they'll have to re-enter the new password.
        </p>
        <div class="status-row">
          <span class={`badge ${enabled ? 'on' : 'off'}`}>
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
          <button type="submit">{enabled ? 'Update' : 'Enable'}</button>
        </form>
        <p class="err" role="alert" aria-live="polite"></p>
        <p class="ok" role="status" aria-live="polite"></p>
        {enabled ? (
          <div class="danger">
            <button type="button" data-action="disable">Disable password protection</button>
          </div>
        ) : null}
      </section>

      <script type="module">{raw(clientScript(siteId))}</script>
    </DashboardShell>,
  );
});

export default siteSettingsRoute;
