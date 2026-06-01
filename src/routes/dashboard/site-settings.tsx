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

import { and, eq, isNotNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { customer, site, siteCollaborator } from '../../db/schema';
import { DashboardShell, buildSiteNav } from './shell';
import { Button, readThemeCookie } from '../../ui';
import { appDomain, type HostConfigEnv } from '../../host-config';

type Bindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const siteSettingsRoute = new Hono<Env>();

siteSettingsRoute.use('*', clerkAuth());
siteSettingsRoute.use('*', requireAuth());

// Open Canvas chrome for the site-settings surface (MIGRATION.md §5d /
// settings.html). Sections render as `.set` cards with a `.set-h` header
// (icon + title + helper text + trailing action/switch) and a `.set-body`
// for the section's controls. The collaborator list and danger zone keep
// the same DOM hooks the inline client script + smoke test depend on
// (`form.pw`, `form.collab-form`, `ul.collab-list`, `.remove-btn`, etc.)
// but get restyled to match the design source.
const pageStyles = `
  .content > h1 { font-size: 32px; letter-spacing: -.03em; }
  .content > .sub { color: var(--ink-2); margin: 6px 0 28px; }
  .content { max-width: 760px; }

  .set {
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    margin-bottom: 16px;
    overflow: hidden;
    scroll-margin-top: 24px;
  }
  .set:target { border-color: var(--red-line); box-shadow: 0 0 0 3px var(--red-tint); }

  .set-h {
    padding: 20px 22px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }
  .set-h .ic {
    width: 38px;
    height: 38px;
    border-radius: 11px;
    background: var(--surface-2);
    color: var(--ink-2);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .set-h .tt { flex: 1; min-width: 0; }
  .set-h h2 {
    font-size: 17px;
    font-family: var(--display);
    color: var(--ink);
    margin: 0;
  }
  .set-h p {
    font-size: 13.5px;
    color: var(--ink-2);
    margin: 4px 0 0;
    line-height: 1.45;
  }
  .set-h code {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--ink);
    background: var(--surface-2);
    padding: 1px 6px;
    border-radius: var(--r-xs);
  }
  .set-body { padding: 0 22px 20px; }

  /* Section TOC — chip row at the top of the page that jump-scrolls to each
     settings card via #id anchors. Pure CSS; the .set { scroll-margin-top }
     above keeps the target's heading clear of the sticky shell chrome. */
  .set-toc {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 22px;
  }
  .set-toc a {
    font-size: 12.5px;
    color: var(--ink-2);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 5px 12px;
    text-decoration: none;
    transition: color 120ms, background 120ms, border-color 120ms;
  }
  .set-toc a:hover {
    color: var(--ink);
    background: var(--surface);
    border-color: var(--ink-3);
  }

  .row-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 14px 0;
    border-top: 1px solid var(--line);
  }
  .row-line:first-child { border-top: none; }
  .row-line .rt { flex: 1; min-width: 0; }
  .row-line .rt b { font-size: 14px; color: var(--ink); }
  .row-line .rt small {
    display: block;
    font-size: 12.5px;
    color: var(--ink-3);
    margin-top: 2px;
  }
  .row-line .rt code {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--ink);
  }

  /* danger zone — red-tinted card */
  .set.danger { border-color: var(--red-line); }
  .set.danger .set-h .ic { background: var(--red-soft); color: var(--red-ink); }

  /* status row — Enabled / Disabled badge + meta date */
  .status-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 0 18px;
  }
  .status-row .meta { color: var(--ink-3); font-size: 13px; }

  /* password set/change form: input + Update button */
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
    color: var(--ink-2);
  }
  form.pw input[type="password"] {
    font-family: var(--sans);
    font-size: 14.5px;
    color: var(--ink);
    background: var(--surface);
    border: 1.5px solid var(--line-2);
    border-radius: var(--r-sm);
    padding: 11px 14px;
    transition: border-color .15s ease, box-shadow .15s ease;
    outline: none;
  }
  form.pw input[type="password"]:focus {
    border-color: var(--red);
    box-shadow: var(--ring);
  }

  .err, .ok {
    margin-top: 8px;
    font-size: 13px;
    min-height: 18px;
  }
  .err { color: var(--red-ink); }
  .ok { color: var(--ok); }

  /* collaborator invite form: email + role + Invite button */
  form.collab-form {
    display: grid;
    grid-template-columns: 1fr 140px auto;
    gap: 10px;
    align-items: end;
  }
  form.collab-form label {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: var(--ink-2);
  }
  form.collab-form input[type="email"],
  form.collab-form select {
    font-family: var(--sans);
    font-size: 14.5px;
    color: var(--ink);
    background: var(--surface);
    border: 1.5px solid var(--line-2);
    border-radius: var(--r-sm);
    padding: 11px 14px;
    outline: none;
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  form.collab-form input[type="email"]:focus,
  form.collab-form select:focus {
    border-color: var(--red);
    box-shadow: var(--ring);
  }

  /* collaborator list — DOM hooks (.collab-list, .collab-item,
     .role-select, .remove-btn, .resend-btn) preserved for the inline
     client script + smoke test selectors. */
  ul.collab-list {
    list-style: none;
    padding: 0;
    margin: 16px 0 0;
  }
  .collab-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-top: 1px solid var(--line);
    font-size: 14px;
  }
  .collab-item:first-of-type { border-top: none; }
  .collab-item .email { flex: 1; color: var(--ink); min-width: 0; word-break: break-all; }
  .collab-item .role-select {
    border: 1.5px solid var(--line-2);
    background: var(--surface);
    color: var(--ink);
    border-radius: var(--r-sm);
    padding: 6px 10px;
    font-size: 12.5px;
    cursor: pointer;
    text-transform: capitalize;
    outline: none;
    transition: border-color .15s ease;
  }
  .collab-item .role-select:focus,
  .collab-item .role-select:hover { border-color: var(--ink); }
  .collab-item .role-select:disabled { opacity: 0.6; cursor: wait; }
  .collab-item .status-badge {
    font-size: 11px;
    padding: 3px 10px;
    border-radius: var(--r-pill);
    text-transform: capitalize;
    border: 1px solid transparent;
    font-weight: 600;
  }
  .collab-item .status-badge.pending {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .collab-item .status-badge.active {
    background: var(--ok-soft);
    color: var(--ok);
  }
  .collab-item button.resend-btn,
  .collab-item button.remove-btn {
    font-family: var(--sans);
    font-weight: 650;
    font-size: 12.5px;
    padding: 6px 12px;
    border-radius: var(--r-pill);
    cursor: pointer;
    border: 1.5px solid var(--line-2);
    background: var(--surface);
    color: var(--ink-2);
    transition: border-color .15s, color .15s, background .15s;
  }
  .collab-item button.resend-btn:hover { border-color: var(--ink); color: var(--ink); }
  .collab-item button.remove-btn {
    color: var(--red-ink);
    border-color: var(--red-line);
  }
  .collab-item button.remove-btn:hover {
    background: var(--red-soft);
    border-color: var(--red);
  }
  .collab-item button:disabled { opacity: 0.55; cursor: wait; }

  /* favicon picker — uses theme tokens for the dashed drop zone */
  .favicon-picker {
    display: grid;
    grid-template-columns: 48px 1fr auto;
    gap: 14px;
    align-items: center;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: var(--r);
    background: var(--surface-2);
    margin: 6px 0 4px;
  }
  .favicon-picker .fv-thumb {
    width: 48px;
    height: 48px;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px dashed var(--line-2);
    background-size: cover;
    background-position: center;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-3);
    font-size: 11px;
  }
  .favicon-picker .fv-thumb[data-has-image="true"] {
    border-style: solid;
    border-color: var(--line);
    background-color: var(--paper);
  }
  .favicon-picker .fv-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .favicon-picker .fv-label { font-size: 14px; color: var(--ink); font-weight: 600; }
  .favicon-picker .fv-state { font-size: 12.5px; color: var(--ink-2); }
  .favicon-picker .fv-actions { display: flex; gap: 8px; }
  .favicon-picker button {
    font-family: var(--sans);
    font-weight: 650;
    font-size: 12.5px;
    padding: 7px 14px;
    border-radius: var(--r-pill);
    cursor: pointer;
    background: var(--surface);
    border: 1.5px solid var(--line-2);
    color: var(--ink);
    transition: border-color .15s, color .15s;
  }
  .favicon-picker button:hover { border-color: var(--ink); }
  .favicon-picker button.clear {
    color: var(--red-ink);
    border-color: var(--red-line);
  }
  .favicon-picker button.clear:hover { background: var(--red-soft); border-color: var(--red); }
  .favicon-picker button:disabled { opacity: 0.55; cursor: wait; }

  .hint {
    margin: 10px 2px 0;
    font-size: 12.5px;
    color: var(--ink-3);
    line-height: 1.5;
  }
  .hint code {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--ink);
    background: var(--surface-2);
    padding: 1px 6px;
    border-radius: var(--r-xs);
  }

  /* shared asset picker modal — reskinned in Open Canvas surface colours */
  .picker-modal {
    position: fixed;
    inset: 0;
    background: rgba(26, 25, 23, 0.55);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 24px;
  }
  .picker-modal[data-open="true"] { display: flex; }
  .picker-sheet {
    width: min(900px, 100%);
    max-height: 86vh;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r);
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    color: var(--ink);
  }
  .picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--line);
  }
  .picker-head h3 {
    margin: 0;
    font-family: var(--display);
    font-size: 17px;
    color: var(--ink);
  }
  .picker-actions { display: flex; gap: 8px; align-items: center; }
  .picker-actions button,
  .picker-actions label {
    font-family: var(--sans);
    font-weight: 650;
    font-size: 13px;
    padding: 7px 14px;
    border-radius: var(--r-pill);
    cursor: pointer;
    background: var(--surface);
    border: 1.5px solid var(--line-2);
    color: var(--ink);
    transition: border-color .15s, color .15s;
  }
  .picker-actions button:hover,
  .picker-actions label:hover { border-color: var(--ink); }
  .picker-actions .close { color: var(--ink-2); }
  .picker-body { padding: 16px 20px; overflow: auto; flex: 1; }
  .picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
  }
  .picker-tile {
    aspect-ratio: 1 / 1;
    border-radius: var(--r-sm);
    border: 1px solid var(--line);
    background-size: cover;
    background-position: center;
    background-color: var(--surface-2);
    cursor: pointer;
    position: relative;
    transition: border-color .12s, transform .12s;
  }
  .picker-tile:hover { border-color: var(--ink); transform: translateY(-1px); }
  .picker-empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--ink-2);
    font-size: 14px;
  }
  .picker-status {
    padding: 8px 20px;
    color: var(--ink-2);
    font-size: 12.5px;
    border-top: 1px solid var(--line);
    min-height: 16px;
  }
  .picker-status.error { color: var(--red-ink); }
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
  visitorTheme: 'light' | 'dark' | 'toggleable';
  faviconAssetId: string | null;
}

async function lookupOwnedSite(
  env: Bindings,
  customerId: string,
  siteId: string,
): Promise<OwnedSite | null> {
  const database = db(env);
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
    visitorTheme: row.editableState.visitorTheme ?? 'light',
    faviconAssetId: row.editableState.faviconAssetId ?? null,
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

export function clientScript(siteId: string): string {
  const sid = JSON.stringify(siteId);
  return String.raw`
const rev01SiteSettingsConfig = (() => {
  const SITE_ID = ${sid};
  let configPatchChain = Promise.resolve();
  function queueConfigPatch(body, onSaved, onFailed) {
    const run = configPatchChain.then(async () => {
      try {
        const response = await fetch('/api/canvas/sites/' + encodeURIComponent(SITE_ID) + '/config', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const bodyText = (await response.text()).trim();
          onFailed('Could not save: ' + (bodyText || response.statusText));
          return;
        }
        onSaved(response);
      } catch (e) {
        onFailed('Network error: ' + (e && e.message ? e.message : String(e)));
      }
    });
    configPatchChain = run.catch((error) => {
      console.error('[site-settings] config patch queue failed', { error });
    });
    return run;
  }
  return { SITE_ID, queueConfigPatch };
})();

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
      if (!await __opencanvasModal.confirm('Disable password protection? Visitors will be able to view this site without a password.', { title: 'Disable protection' })) return;
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
  const collabForm = document.querySelector('form.collab-form');
  const collabErr = document.querySelector('p.collab-err');
  const collabOk = document.querySelector('p.collab-ok');
  const collabList = document.querySelector('ul.collab-list');

  function clearCollabStatus() {
    if (collabErr) collabErr.textContent = '';
    if (collabOk) collabOk.textContent = '';
  }
  async function responseDetail(response) {
    const bodyText = (await response.text()).trim();
    if (!bodyText) return response.statusText;
    try {
      const json = JSON.parse(bodyText);
      if (json && typeof json.error === 'string') return json.error;
    } catch {
      // not JSON — fall through and return raw body
    }
    return bodyText;
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
      const target = event.target;
      if (!(target instanceof Element)) return;
      const removeBtn = target.closest('button.remove-btn');
      const resendBtn = target.closest('button.resend-btn');
      if (removeBtn instanceof HTMLButtonElement) {
        const item = removeBtn.closest('.collab-item');
        const collabId =
          removeBtn.getAttribute('data-remove-collab') ||
          (item ? item.getAttribute('data-collab-id') : null);
        if (!collabId) return;
        if (!await __opencanvasModal.confirm('Remove this collaborator?', { title: 'Remove collaborator', confirmLabel: 'Remove', danger: true })) return;
        removeBtn.disabled = true;
        clearCollabStatus();
        try {
          const response = await fetch('/api/sites/' + encodeURIComponent(SITE_ID) + '/collaborators/' + encodeURIComponent(collabId), {
            method: 'DELETE',
            headers: { 'accept': 'application/json' },
          });
          if (!response.ok) {
            const detail = await responseDetail(response);
            if (collabErr) collabErr.textContent = detail;
            removeBtn.disabled = false;
            return;
          }
          if (item) item.remove();
        } catch (e) {
          if (collabErr) collabErr.textContent = 'Network error: ' + (e && e.message ? e.message : String(e));
          removeBtn.disabled = false;
        }
        return;
      }
      if (resendBtn instanceof HTMLButtonElement) {
        const collabId = resendBtn.getAttribute('data-resend-collab');
        if (!collabId) return;
        resendBtn.disabled = true;
        clearCollabStatus();
        try {
          const response = await fetch('/api/sites/' + encodeURIComponent(SITE_ID) + '/collaborators/' + encodeURIComponent(collabId) + '/resend', {
            method: 'POST',
            headers: { 'accept': 'application/json' },
          });
          if (!response.ok) {
            const detail = await responseDetail(response);
            if (collabErr) collabErr.textContent = detail;
            resendBtn.disabled = false;
            return;
          }
          if (collabOk) collabOk.textContent = 'Invitation resent.';
        } catch (e) {
          if (collabErr) collabErr.textContent = 'Network error: ' + (e && e.message ? e.message : String(e));
        } finally {
          resendBtn.disabled = false;
        }
        return;
      }
    });

    // Role change — fires PATCH on each change. On failure, revert to the
    // previously persisted value (stashed in data-prev-role) so the dropdown
    // doesn't visually claim a state the server didn't accept.
    collabList.addEventListener('change', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (!target.classList.contains('role-select')) return;
      const collabId = target.getAttribute('data-role-collab');
      if (!collabId) return;
      const newRole = target.value;
      const prevRole = target.getAttribute('data-prev-role') || 'editor';
      if (newRole === prevRole) return;
      target.disabled = true;
      clearCollabStatus();
      try {
        const response = await fetch('/api/sites/' + encodeURIComponent(SITE_ID) + '/collaborators/' + encodeURIComponent(collabId), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify({ role: newRole }),
        });
        if (!response.ok) {
          const detail = await responseDetail(response);
          if (collabErr) collabErr.textContent = detail;
          target.value = prevRole;
          return;
        }
        target.setAttribute('data-prev-role', newRole);
        if (collabOk) collabOk.textContent = 'Role updated.';
      } catch (e) {
        if (collabErr) collabErr.textContent = 'Network error: ' + (e && e.message ? e.message : String(e));
        target.value = prevRole;
      } finally {
        target.disabled = false;
      }
    });
  }
})();

// Favicon picker — loads owner-scoped assets into a modal, lets the user pick
// or upload one, and persists the choice via PATCH /config { faviconAssetId }.
// Same pattern as the per-page OG picker in dashboard/page-settings.tsx; kept
// inline here so site-settings remains a single-file route.
(() => {
  const SITE_ID = rev01SiteSettingsConfig.SITE_ID;
  const queueConfigPatch = rev01SiteSettingsConfig.queueConfigPatch;
  function assetUrl(id) {
    return '/api/canvas/sites/' + encodeURIComponent(SITE_ID) + '/assets/' + encodeURIComponent(id);
  }
  const picker = document.querySelector('[data-asset-picker="favicon"]');
  if (!picker) return;
  const modal = document.querySelector('[data-picker-modal]');
  const modalGrid = document.querySelector('[data-picker-grid]');
  const modalEmpty = document.querySelector('[data-picker-empty]');
  const modalStatus = document.querySelector('[data-picker-status]');
  const modalClose = document.querySelector('[data-picker-close]');
  const modalUpload = document.querySelector('[data-picker-upload]');
  const okMsg = document.querySelector('[data-favicon-status]');
  const errMsg = document.querySelector('[data-favicon-err]');
  function setStatus(msg, isError) {
    if (!modalStatus) return;
    modalStatus.textContent = msg || '';
    modalStatus.classList.toggle('error', !!isError);
  }
  function showOk(msg) { if (okMsg) okMsg.textContent = msg; if (errMsg) errMsg.textContent = ''; }
  function showErr(msg) { if (errMsg) errMsg.textContent = msg; if (okMsg) okMsg.textContent = ''; }
  async function loadAssets() {
    setStatus('Loading…', false);
    try {
      const r = await fetch('/api/owner/assets', { headers: { accept: 'application/json' } });
      if (!r.ok) { setStatus('Could not load assets (' + r.status + ')', true); return; }
      const body = await r.json();
      const assets = Array.isArray(body.assets) ? body.assets : [];
      const images = assets.filter((a) => (a.kind === 'image') || (typeof a.mediaType === 'string' && a.mediaType.startsWith('image/')));
      if (!modalGrid || !modalEmpty) return;
      modalGrid.innerHTML = '';
      if (images.length === 0) { modalEmpty.hidden = false; setStatus('', false); return; }
      modalEmpty.hidden = true;
      for (const a of images) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'picker-tile';
        tile.style.backgroundImage = 'url(' + assetUrl(a.id) + ')';
        tile.title = a.alt || a.id;
        tile.addEventListener('click', () => commit(a.id));
        modalGrid.appendChild(tile);
      }
      setStatus(images.length + ' image' + (images.length === 1 ? '' : 's') + ' available', false);
    } catch (e) {
      setStatus('Network error: ' + (e && e.message ? e.message : String(e)), true);
    }
  }
  async function commit(assetIdOrNull) {
    showOk('Saving…');
    await queueConfigPatch({ faviconAssetId: assetIdOrNull }, () => {
      const thumb = picker.querySelector('[data-picker-thumb]');
      const meta = picker.querySelector('[data-picker-meta]');
      const clearBtn = picker.querySelector('[data-picker-clear]');
      const chooseBtn = picker.querySelector('[data-picker-choose]');
      picker.setAttribute('data-asset-id', assetIdOrNull || '');
      if (thumb) {
        if (assetIdOrNull) {
          thumb.style.backgroundImage = 'url(' + assetUrl(assetIdOrNull) + ')';
          thumb.setAttribute('data-has-image', 'true');
          thumb.textContent = '';
        } else {
          thumb.style.backgroundImage = '';
          thumb.setAttribute('data-has-image', 'false');
          thumb.textContent = 'none';
        }
      }
      if (meta) {
        meta.textContent = assetIdOrNull
          ? 'Set — emitted as <link rel="icon"> on every page.'
          : 'Not set — browsers will show the default tab icon.';
      }
      if (clearBtn) clearBtn.hidden = !assetIdOrNull;
      if (chooseBtn) chooseBtn.textContent = assetIdOrNull ? 'Change' : 'Choose image';
      showOk('Saved.');
      if (modal) modal.removeAttribute('data-open');
    }, showErr);
  }
  const chooseBtn = picker.querySelector('[data-picker-choose]');
  const clearBtn = picker.querySelector('[data-picker-clear]');
  if (chooseBtn) chooseBtn.addEventListener('click', () => {
    if (modal) modal.setAttribute('data-open', 'true');
    loadAssets();
  });
  if (clearBtn) clearBtn.addEventListener('click', () => commit(null));
  if (modalClose) modalClose.addEventListener('click', () => modal && modal.removeAttribute('data-open'));
  if (modal) modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.removeAttribute('data-open'); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && modal && modal.getAttribute('data-open') === 'true') {
      modal.removeAttribute('data-open');
    }
  });
  if (modalUpload) {
    modalUpload.addEventListener('change', async () => {
      const file = modalUpload.files && modalUpload.files[0];
      if (!file) return;
      setStatus('Uploading ' + file.name + '…', false);
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await fetch('/api/owner/assets', { method: 'POST', body: fd });
        if (!r.ok) {
          let detail = r.statusText;
          try { const b = await r.json(); if (b && b.error) detail = b.error; } catch (_) {}
          setStatus('Upload failed: ' + detail, true);
          modalUpload.value = '';
          return;
        }
        const body = await r.json();
        modalUpload.value = '';
        if (body && body.id) await commit(body.id);
      } catch (e) {
        setStatus('Network error: ' + (e && e.message ? e.message : String(e)), true);
        modalUpload.value = '';
      }
    });
  }
})();

// Site-config controls (search indexing, visitor theme). Each control
// input carries data-config-key (the API field).
//   - Checkbox controls (siteNoIndex): boolean. data-invert=true for the
//     SEO case where the UI shows indexable but the API stores noindex.
//   - Radio-group controls (visitorTheme per ADR 0035): string enum.
//     The selected radio's value attribute is the API value.
// Failures revert the input and surface a status message.
//
// PATCH requests are serialized through a single promise chain because the
// server's /config handler is read-modify-write: two concurrent PATCHes load
// the same prior state, each apply their own diff, and the second write
// silently overwrites the first. Queueing here keeps each control's effect.
(() => {
  const queueConfigPatch = rev01SiteSettingsConfig.queueConfigPatch;
  const inputs = document.querySelectorAll('input[data-config-key]');
  // Group radios by name so the "saved value" / revert is shared across
  // the group rather than per-input.
  const radioGroups = new Map();
  inputs.forEach((cb) => {
    const key = cb.getAttribute('data-config-key');
    if (!key) return;
    if (cb.type === 'radio') {
      const groupName = cb.name || key;
      if (!radioGroups.has(groupName)) {
        radioGroups.set(groupName, { key, inputs: [], savedValue: '', stateEl: null });
      }
      const group = radioGroups.get(groupName);
      group.inputs.push(cb);
      if (cb.checked) group.savedValue = cb.value;
      if (!group.stateEl) {
        group.stateEl = cb.closest('.set-head')?.querySelector('[data-theme-state]');
      }
      return;
    }
    // Checkbox path (unchanged behaviour for the boolean controls).
    const inverted = cb.getAttribute('data-invert') === 'true';
    const stateEl = cb.closest('.toggle-row')?.querySelector('[data-toggle-state]');
    const stateOn = cb.getAttribute('data-on-label') ?? 'On';
    const stateOff = cb.getAttribute('data-off-label') ?? 'Off';
    function apiValueFromChecked(checked) { return inverted ? !checked : checked; }
    function checkedFromApiValue(value) { return inverted ? !value : value; }
    function renderSavedState(apiValue) {
      if (stateEl) stateEl.textContent = checkedFromApiValue(apiValue) ? stateOn : stateOff;
    }
    let savedApiValue = apiValueFromChecked(cb.checked);
    let nextQueueId = 0;
    let latestQueueId = 0;
    cb.addEventListener('change', () => {
      const apiValue = apiValueFromChecked(cb.checked);
      const queueId = nextQueueId + 1;
      nextQueueId = queueId;
      latestQueueId = queueId;
      queueConfigPatch(
        { [key]: apiValue },
        () => {
          savedApiValue = apiValue;
          if (latestQueueId === queueId) renderSavedState(apiValue);
        },
        (message) => {
          if (latestQueueId === queueId) {
            cb.checked = checkedFromApiValue(savedApiValue);
            renderSavedState(savedApiValue);
          }
          alert(message);
        },
      );
    });
  });
  // Wire each radio group's change handler once. Only the newly-selected
  // radio fires 'change'; on failure, restore the previously-saved value
  // and re-check the corresponding radio.
  radioGroups.forEach((group) => {
    function renderSavedStateRadio(value) {
      if (!group.stateEl) return;
      group.stateEl.textContent =
        value === 'dark' ? 'Dark theme, no toggle.'
        : value === 'toggleable' ? 'Toggleable by visitors, defaults to their OS preference.'
        : 'Light theme, no toggle.';
    }
    let nextQueueId = 0;
    let latestQueueId = 0;
    group.inputs.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        const apiValue = radio.value;
        const queueId = nextQueueId + 1;
        nextQueueId = queueId;
        latestQueueId = queueId;
        queueConfigPatch(
          { [group.key]: apiValue },
          () => {
            group.savedValue = apiValue;
            if (latestQueueId === queueId) renderSavedStateRadio(apiValue);
          },
          (message) => {
            if (latestQueueId === queueId) {
              group.inputs.forEach((r) => { r.checked = r.value === group.savedValue; });
              renderSavedStateRadio(group.savedValue);
            }
            alert(message);
          },
        );
      });
    });
  });
})();

// Delete-site confirmation — types-the-name gate, DELETE /api/sites/:id,
// then redirects to /dashboard. Failures stay in the modal so the owner
// can retry without losing the typed confirmation.
(() => {
  const SITE_ID = rev01SiteSettingsConfig.SITE_ID;
  const trigger = document.querySelector('[data-delete-trigger]');
  const modal = document.querySelector('[data-delete-confirm-modal]');
  if (!trigger || !modal) return;
  const siteName = modal.getAttribute('data-site-name') || '';
  const input = modal.querySelector('[data-delete-confirm-input]');
  const confirmBtn = modal.querySelector('[data-delete-confirm]');
  const cancelBtn = modal.querySelector('[data-delete-cancel]');
  const errEl = modal.querySelector('[data-delete-confirm-error]');
  function reset() {
    if (input) input.value = '';
    if (confirmBtn) confirmBtn.disabled = true;
    if (errEl) errEl.textContent = '';
  }
  function close() {
    modal.removeAttribute('data-open');
    reset();
  }
  trigger.addEventListener('click', () => {
    reset();
    modal.setAttribute('data-open', 'true');
    if (input) setTimeout(() => input.focus(), 60);
  });
  if (cancelBtn) cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && modal.getAttribute('data-open') === 'true') close();
  });
  if (input && confirmBtn) {
    input.addEventListener('input', () => {
      confirmBtn.disabled = input.value.trim() !== siteName;
    });
  }
  if (confirmBtn) confirmBtn.addEventListener('click', async () => {
    if (input && input.value.trim() !== siteName) return;
    confirmBtn.disabled = true;
    if (errEl) errEl.textContent = '';
    try {
      const r = await fetch('/api/sites/' + encodeURIComponent(SITE_ID), {
        method: 'DELETE',
        headers: { accept: 'application/json' },
      });
      if (r.ok) {
        window.location.href = '/dashboard';
        return;
      }
      let msg = 'Delete failed (' + r.status + ').';
      try {
        const b = await r.json();
        if (b && typeof b.error === 'string') msg = 'Delete failed: ' + b.error;
      } catch (_) {}
      if (errEl) errEl.textContent = msg;
      confirmBtn.disabled = false;
    } catch (e) {
      if (errEl) errEl.textContent = 'Network error: ' + (e && e.message ? e.message : String(e));
      confirmBtn.disabled = false;
    }
  });
})();
`;
}

// Section header icons. Each one is a 19px stroked SVG sized to fit the
// 38px `.ic` rounded square; they consume `currentColor` so the icon
// rides the theme tokens for hue (.set-h .ic colour pair).
function HostingIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" stroke-linecap="round" />
    </svg>
  );
}

function FaviconIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0M16 5a3.5 3.5 0 0 1 0 6M21 20a6 6 0 0 0-3-5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </svg>
  );
}

/**
 * For a customer who is NOT the owner of `siteId`, check whether they're an
 * accepted collaborator. Returns the site name + owner's email so the
 * "you're a collaborator, not the owner" page can name the owner the
 * collaborator should ask. Returns null when there's no relationship.
 *
 * Three-way join: siteCollaborator (the access record) → site (for name +
 * the owner's customerId) → customer (for the owner's email). All in one
 * Neon round trip so the 403 page open doesn't pay multiple network hops.
 */
async function collaboratorHitForSite(
  env: Bindings,
  collabCustomerId: string,
  siteId: string,
): Promise<{ siteName: string; ownerEmail: string | null } | null> {
  const database = db(env);
  const rows = await database
    .select({
      siteName: site.name,
      ownerEmail: customer.email,
    })
    .from(siteCollaborator)
    .innerJoin(site, eq(site.id, siteCollaborator.siteId))
    .innerJoin(customer, eq(customer.id, site.customerId))
    .where(
      and(
        eq(siteCollaborator.siteId, siteId),
        eq(siteCollaborator.customerId, collabCustomerId),
        isNotNull(siteCollaborator.acceptedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { siteName: row.siteName, ownerEmail: row.ownerEmail };
}

/**
 * 403 surface for an accepted collaborator who navigates to a site's
 * Settings page. Reuses the DashboardShell so the chrome stays consistent
 * — same nav, theme, brand mark — and gives the collaborator two ways
 * out: back to the editor (their actual workspace) and back to the
 * dashboard. The owner's email is surfaced so the collaborator knows
 * who to ask if they really do need a settings change.
 *
 * Why a polite 403 and not a redirect: the link the collaborator
 * followed comes from the editor chrome itself, and silently bouncing
 * them back to the editor would feel buggy. Surfacing the constraint
 * makes the "owner-only" boundary discoverable so they don't try
 * again from a different entry point.
 */
function NotSiteOwnerPage(props: {
  siteId: string;
  siteName: string;
  ownerEmail: string | null;
  theme: ReturnType<typeof readThemeCookie>;
}) {
  const editorHref = `/dashboard/sites/${encodeURIComponent(props.siteId)}/edit`;
  const ownerLine = props.ownerEmail
    ? `Ask the site owner (${props.ownerEmail}) to change settings on your behalf.`
    : 'Ask the site owner to change settings on your behalf.';
  return (
    <DashboardShell
      title={`${props.siteName} — settings unavailable`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: editorHref, label: props.siteName },
        { label: 'Settings' },
      ]}
      activePath="/dashboard"
      theme={props.theme}
    >
      <section style="max-width: 560px; margin: 60px auto; padding: 0 24px;">
        <h1 style="font-size: 22px; margin: 0 0 12px;">Settings are owner-only</h1>
        <p style="color: var(--ink-2); margin: 0 0 12px; line-height: 1.5;">
          You're a collaborator on <strong>{props.siteName}</strong>, not the
          owner. Site settings — password protection, custom domain, favicon,
          collaborators, and deletion — can only be changed by the owner.
        </p>
        <p style="color: var(--ink-2); margin: 0 0 24px; line-height: 1.5;">
          {ownerLine}
        </p>
        <div style="display: flex; gap: 12px;">
          <Button href={editorHref} variant="primary">Back to editor</Button>
          <Button href="/dashboard" variant="ghost">All sites</Button>
        </div>
      </section>
    </DashboardShell>
  );
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
  const customerId = c.get('customer')?.id;
  if (!customerId) {
    return c.text('site not found', 404);
  }
  const owned = await lookupOwnedSite(c.env, customerId, siteId);
  if (!owned) {
    // Distinguish "you're a collaborator on this site, not the owner" from
    // "this site doesn't exist for you at all" so the dashboard can show a
    // friendly explanation instead of a bare 404 — collaborators following
    // the Settings link in the editor chrome hit this path otherwise.
    const collabHit = await collaboratorHitForSite(c.env, customerId, siteId);
    if (collabHit) {
      return c.html(
        <NotSiteOwnerPage
          siteId={siteId}
          siteName={collabHit.siteName}
          ownerEmail={collabHit.ownerEmail}
          theme={readThemeCookie(c)}
        />,
        403,
      );
    }
    return c.text('site not found', 404);
  }

  const apex = appDomain(c.env);
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
      theme={readThemeCookie(c)}
    >
      <h1>Settings</h1>
      <p class="sub">
        Manage how <b>{owned.name}</b> is hosted, secured, and shared.
      </p>

      <nav class="set-toc" aria-label="Settings sections">
        <a href="#hosting">Hosting</a>
        <a href="#password">Password</a>
        <a href="#seo">Search engines</a>
        <a href="#favicon">Favicon</a>
        <a href="#dark-mode">Dark mode</a>
        <a href={`/dashboard/sites/${owned.id}/a11y`}>Accessibility</a>
        <a href="#collaborators">Collaborators</a>
        <a href="#danger">Delete site</a>
      </nav>

      {/* Hosting card — read-only summary of plan/CDN/style-kit/status + the
          public address. Mirrors settings.html § Hosting. */}
      <div class="set" id="hosting">
        <div class="set-h">
          <span class="ic">
            <HostingIcon />
          </span>
          <div class="tt">
            <h2>Hosting</h2>
            <p>
              Your site is live. Share the address or connect your own domain.
            </p>
          </div>
          {owned.publishedVersion > 0 ? (
            <span class="chip chip-ok">
              <span class="dot" />
              Published
            </span>
          ) : (
            <span class="chip">
              <span class="dot" />
              Draft
            </span>
          )}
        </div>
        <div class="set-body">
          <div class="row-line">
            <div class="rt">
              <b>Public address</b>
              <small>Anyone with this link can view your site</small>
            </div>
            <span class="chip chip-url">
              {owned.subdomain}.{apex}
            </span>
          </div>
          <div class="row-line">
            <div class="rt">
              <b>Custom domain</b>
              <small>Use a domain you already own</small>
            </div>
            <Button
              variant="secondary"
              size="sm"
              href={`/dashboard/sites/${esc(siteId)}/domains`}
            >
              Connect domain
            </Button>
          </div>
          <div class="row-line">
            <div class="rt">
              <b>Style kit</b>
              <small>The visual language applied across every page</small>
            </div>
            <span class="chip">{owned.styleKit}</span>
          </div>
          <div class="row-line">
            <div class="rt">
              <b>Published version</b>
              <small>
                {owned.publishedVersion > 0
                  ? `Latest publish: v${String(owned.publishedVersion)}`
                  : 'Not published yet — open the editor and click Publish.'}
              </small>
            </div>
            {owned.publishedVersion > 0 ? (
              <span class="chip chip-ok">v{String(owned.publishedVersion)}</span>
            ) : (
              <span class="chip">draft</span>
            )}
          </div>
        </div>
      </div>

      {/* Password protection — `.switch` from components.css toggles the
          inline form below. The form selectors (`form.pw`, .err, .ok,
          [data-action="disable"]) are consumed by the inline client
          script — do not rename. */}
      <div class="set" id="password">
        <div class="set-h">
          <span class="ic">
            <LockIcon />
          </span>
          <div class="tt">
            <h2>Password protection</h2>
            <p>Ask visitors for a password before they can see the site.</p>
          </div>
          <span
            class={`chip ${enabled ? 'chip-ok' : ''}`}
            title={setAtLine}
          >
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div class="set-body">
          <div class="status-row">
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
            <div style="margin-top:14px;">
              <Button variant="secondary" size="sm" data-action="disable">
                Disable password protection
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Search engines — single switch, no body. `.toggle-row` is kept as
          the wrapper because the inline script reads
          `cb.closest('.toggle-row')?.querySelector('[data-toggle-state]')`
          when rendering the saved-state label. */}
      <div class="set" id="seo">
        <div class="set-h">
          <span class="ic">
            <SearchIcon />
          </span>
          <div class="tt">
            <h2>Search engines</h2>
            <p>
              Let Google and others find and list your site.{' '}
              <span data-toggle-state>
                {owned.siteNoIndex ? 'Hidden from search.' : 'Visible in search.'}
              </span>
            </p>
          </div>
          <label class="switch toggle-row" aria-label="Allow search engines to index this site">
            <input
              type="checkbox"
              checked={!owned.siteNoIndex}
              data-config-key="siteNoIndex"
              data-invert="true"
              data-on-label="Visible in search"
              data-off-label="Hidden from search"
            />
            <span class="track" />
          </label>
        </div>
        <div class="set-body">
          <p class="hint">
            Takes effect at the next publish — emits{' '}
            <code>&lt;meta name=&quot;robots&quot;&gt;</code> across every page.
          </p>
        </div>
      </div>

      {/* Favicon — owner-scoped asset picker, modal opens via the inline
          script. DOM hooks (data-asset-picker, data-picker-*) are required
          by the client script. */}
      <div class="set" id="favicon">
        <div class="set-h">
          <span class="ic">
            <FaviconIcon />
          </span>
          <div class="tt">
            <h2>Favicon</h2>
            <p>
              The small icon shown in browser tabs, bookmarks, and Google search results. PNG or SVG
              works well — square images render best.
            </p>
          </div>
        </div>
        <div class="set-body">
          <div
            class="favicon-picker"
            data-asset-picker="favicon"
            data-asset-id={owned.faviconAssetId ?? ''}
          >
            <div
              class="fv-thumb"
              data-picker-thumb
              data-has-image={owned.faviconAssetId ? 'true' : 'false'}
              style={owned.faviconAssetId ? `background-image:url(/api/canvas/sites/${encodeURIComponent(owned.id)}/assets/${encodeURIComponent(owned.faviconAssetId)})` : ''}
            >
              {owned.faviconAssetId ? '' : 'none'}
            </div>
            <div class="fv-meta">
              <span class="fv-label">Site favicon</span>
              <span class="fv-state" data-picker-meta>
                {owned.faviconAssetId
                  ? 'Set — emitted as <link rel="icon"> on every page.'
                  : 'Not set — browsers will show the default tab icon.'}
              </span>
            </div>
            <div class="fv-actions">
              <button type="button" data-picker-choose>
                {owned.faviconAssetId ? 'Change' : 'Choose image'}
              </button>
              <button
                type="button"
                class="clear"
                data-picker-clear
                hidden={!owned.faviconAssetId}
              >
                Remove
              </button>
            </div>
          </div>
          <p class="hint">
            Takes effect at the next publish.{' '}
            <span class="ok" data-favicon-status role="status" aria-live="polite"></span>
            <span class="err" data-favicon-err role="alert" aria-live="polite"></span>
          </p>
        </div>
      </div>

      {/* Visitor dark mode toggle. Same `.switch` + `.toggle-row` wrapper
          pattern as Search engines. */}
      <div class="set" id="dark-mode">
        <div class="set-h">
          <span class="ic">
            <MoonIcon />
          </span>
          <div class="tt">
            <h2>Visitor dark mode</h2>
            <p>
              Choose how the site renders for visitors.{' '}
              <span data-theme-state>
                {owned.visitorTheme === 'dark'
                  ? 'Dark theme, no toggle.'
                  : owned.visitorTheme === 'toggleable'
                    ? 'Toggleable by visitors, defaults to their OS preference.'
                    : 'Light theme, no toggle.'}
              </span>
            </p>
          </div>
          <div class="theme-radio-group" role="radiogroup" aria-label="Visitor theme">
            <label class="theme-radio">
              <input
                type="radio"
                name="visitorTheme"
                value="light"
                checked={owned.visitorTheme === 'light'}
                data-config-key="visitorTheme"
              />
              <span>Light</span>
            </label>
            <label class="theme-radio">
              <input
                type="radio"
                name="visitorTheme"
                value="dark"
                checked={owned.visitorTheme === 'dark'}
                data-config-key="visitorTheme"
              />
              <span>Dark</span>
            </label>
            <label class="theme-radio">
              <input
                type="radio"
                name="visitorTheme"
                value="toggleable"
                checked={owned.visitorTheme === 'toggleable'}
                data-config-key="visitorTheme"
              />
              <span>Toggleable</span>
            </label>
          </div>
        </div>
        <div class="set-body">
          <p class="hint">
            Takes effect at the next publish — adds the visitor-mode CSS and toggle script to the
            published site.
          </p>
        </div>
      </div>

      {/* Collaborators — invite form + per-row role select + Remove/Resend.
          DOM hooks (form.collab-form, ul.collab-list, .role-select,
          .remove-btn, .resend-btn, data-collab-id) are consumed by the
          inline client script + smoke test — do not rename. */}
      <div class="set" id="collaborators">
        <div class="set-h">
          <span class="ic">
            <PeopleIcon />
          </span>
          <div class="tt">
            <h2>Collaborators</h2>
            <p>Invite people to help edit. They&apos;ll get an email invitation.</p>
          </div>
        </div>
        <div class="set-body">
          <form class="collab-form" autocomplete="off">
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
          <p class="err collab-err" role="alert" aria-live="polite"></p>
          <p class="ok collab-ok" role="status" aria-live="polite"></p>
          <ul class="collab-list">
            {collaborators.length === 0 ? (
              <li
                class="collab-item"
                style="color:var(--ink-3); font-size:13.5px; justify-content:center;"
              >
                <span class="email" style="text-align:center;">
                  No collaborators yet. Invite someone above to start sharing this site.
                </span>
              </li>
            ) : (
              collaborators.map((collab) => (
                <li class="collab-item" data-collab-id={collab.id}>
                  <span class="email">{collab.email}</span>
                  <select
                    class="role-select"
                    data-role-collab={collab.id}
                    data-prev-role={collab.role}
                    aria-label="Role"
                  >
                    <option value="editor" selected={collab.role === 'editor'}>
                      Editor
                    </option>
                    <option value="viewer" selected={collab.role === 'viewer'}>
                      Viewer
                    </option>
                  </select>
                  <span class={`status-badge ${collab.acceptedAt ? 'active' : 'pending'}`}>
                    {collab.acceptedAt ? 'active' : 'pending'}
                  </span>
                  {collab.acceptedAt ? null : (
                    <button type="button" class="resend-btn" data-resend-collab={collab.id}>
                      Resend
                    </button>
                  )}
                  <button type="button" class="remove-btn" data-remove-collab={collab.id}>
                    Remove
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {/* Danger zone — destructive actions live here so they're visually
          quarantined from routine controls. The Delete site CTA opens the
          typed-confirmation modal below; the actual DELETE call is wired
          in the client script IIFE. */}
      <div class="set danger" id="danger">
        <div class="set-h">
          <span class="ic">
            <TrashIcon />
          </span>
          <div class="tt">
            <h2>Delete this site</h2>
            <p>
              Permanently remove {owned.name} and everything in it. This can&apos;t be undone.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            class="opencanvas-danger-cta"
            style="color:var(--red-ink); border-color:var(--red-line);"
            data-delete-trigger
          >
            Delete site
          </Button>
        </div>
      </div>

      {/* Delete-site confirmation modal — typed confirmation gate. Reuses
          the `picker-modal` class so the existing fixed-overlay + data-open
          CSS applies; the inner sheet content is destruction-specific. */}
      <div class="picker-modal" data-delete-confirm-modal data-site-name={owned.name}>
        <div
          class="picker-sheet"
          role="alertdialog"
          aria-label="Delete this site"
          style="max-width:480px;"
        >
          <div class="picker-head">
            <h3>Delete this site?</h3>
          </div>
          <div class="picker-body" style="padding:20px 24px;">
            <p style="margin:0 0 14px;">
              This permanently removes <strong>{owned.name}</strong> and everything in
              it &mdash; pages, snapshots, forms, collaborators, addons. It can&apos;t
              be undone.
            </p>
            <p style="margin:0 0 6px;font-size:13px;color:var(--ink-2);">
              Type <code>{owned.name}</code> to confirm.
            </p>
            <input
              type="text"
              data-delete-confirm-input
              autocomplete="off"
              spellcheck={false}
              style="width:100%;padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--surface-2);color:var(--ink);box-sizing:border-box;"
            />
            <p
              class="picker-status"
              data-delete-confirm-error
              role="alert"
              aria-live="polite"
              style="margin:8px 0 0;min-height:18px;color:var(--red-ink);"
            ></p>
          </div>
          <div
            class="picker-head"
            style="border-top:1px solid var(--line);justify-content:flex-end;gap:8px;"
          >
            <button type="button" class="close" data-delete-cancel>
              Cancel
            </button>
            <button
              type="button"
              data-delete-confirm
              disabled
              style="padding:6px 14px;border:1px solid var(--red-line);background:var(--red-soft);color:var(--red-ink);border-radius:6px;cursor:pointer;font-weight:600;"
            >
              Delete site
            </button>
          </div>
        </div>
      </div>

      {/* Shared asset picker modal (favicon + any future picker on this page). */}
      <div class="picker-modal" data-picker-modal>
        <div class="picker-sheet" role="dialog" aria-label="Choose image">
          <div class="picker-head">
            <h3>Choose an image</h3>
            <div class="picker-actions">
              <label>
                Upload new
                <input
                  type="file"
                  data-picker-upload
                  accept="image/*"
                  style="display:none"
                />
              </label>
              <button type="button" class="close" data-picker-close>Close</button>
            </div>
          </div>
          <div class="picker-body">
            <div class="picker-grid" data-picker-grid></div>
            <div class="picker-empty" data-picker-empty hidden>
              No images yet. Click "Upload new" to add one.
            </div>
          </div>
          <p class="picker-status" data-picker-status></p>
        </div>
      </div>

      <script type="module">{raw(clientScript(siteId))}</script>
    </DashboardShell>,
  );
});

export default siteSettingsRoute;
