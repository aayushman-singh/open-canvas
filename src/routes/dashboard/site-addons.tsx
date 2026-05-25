// src/routes/dashboard/site-addons.tsx

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { addonEntitlement, customer, site, siteAddon } from '../../db/schema';
import { DashboardShell } from './shell';
import { Badge, Pill } from '../../ui';
import { allAddons } from '../../addons/registry';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const siteAddonsRoute = new Hono<Env>();

siteAddonsRoute.use('*', clerkAuth());
siteAddonsRoute.use('*', requireAuth());

const pageStyles = `
  .lede {
    margin: 8px 0 24px;
    color: var(--muted);
    max-width: 640px;
    line-height: 1.55;
  }
  .addon-section {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 20px;
  }
  .addon-section-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
  }
  .addon-section-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .addon-section-desc {
    color: var(--muted);
    font-size: 13px;
    margin: 0 0 20px;
  }
  .not-purchased {
    color: var(--faint);
    font-size: 13px;
  }
  .not-purchased a {
    color: var(--accent);
  }
  .field-group {
    margin-bottom: 16px;
  }
  .field-group label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--muted);
    margin-bottom: 5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .field-group input[type="text"] {
    width: 100%;
    max-width: 360px;
    padding: 9px 12px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    outline: none;
    box-sizing: border-box;
  }
  .field-group input[type="text"]:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(125,211,252,0.15);
  }
  .field-hint {
    font-size: 11px;
    color: var(--faint);
    margin-top: 4px;
  }
  .toggle-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .toggle-label {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
  }
  .addon-actions {
    display: flex;
    gap: 8px;
    margin-top: 20px;
  }
  .btn-save {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    font-family: inherit;
    background: var(--accent);
    color: var(--bg);
    transition: filter 0.12s;
  }
  .btn-save:hover { filter: brightness(0.88); }
  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: none;
  }
  .msg {
    font-size: 13px;
    margin-top: 12px;
  }
  .msg-ok { color: #4ade80; }
  .msg-err { color: #ef4444; }
`;

function clientScript(siteId: string): string {
  const sid = JSON.stringify(siteId);
  return String.raw`
(function() {
  var SITE_ID = ${sid};

  document.querySelectorAll('[data-addon-form]').forEach(function(form) {
    var addonId = form.getAttribute('data-addon-form');
    var msgEl = form.querySelector('.addon-msg');
    var saveBtn = form.querySelector('[data-save]');
    if (!saveBtn) return;

    saveBtn.addEventListener('click', function() {
      var enabledEl = form.querySelector('[name="enabled"]');
      var enabled = enabledEl ? enabledEl.checked : false;
      var config = {};
      form.querySelectorAll('[data-config-key]').forEach(function(input) {
        config[input.getAttribute('data-config-key')] = input.value.trim();
      });

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      if (msgEl) { msgEl.textContent = ''; msgEl.className = 'addon-msg msg'; }

      fetch('/api/addons/sites/' + SITE_ID + '/' + addonId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabled, config: config }),
      })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(result) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        if (!result.ok) throw new Error(result.data.error || 'Save failed');
        if (msgEl) { msgEl.textContent = 'Saved. Publish your site to apply changes.'; msgEl.className = 'addon-msg msg msg-ok'; }
      })
      .catch(function(err) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        if (msgEl) { msgEl.textContent = err.message; msgEl.className = 'addon-msg msg msg-err'; }
      });
    });
  });
})();
`;
}

siteAddonsRoute.get('/sites/:siteId/addons', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('addons page reached without authenticated user');

  const siteId = c.req.param('siteId');
  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return c.text('not found', 404);

  const siteRow = await database
    .select({ id: site.id, name: site.name })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  if (siteRow.length === 0) return c.text('site not found', 404);
  const owned = siteRow[0]!;

  const entRows = await database
    .select({ addonId: addonEntitlement.addonId })
    .from(addonEntitlement)
    .where(eq(addonEntitlement.customerId, customerId));
  const entitled = new Set(entRows.map((r) => r.addonId));

  const saRows = await database
    .select()
    .from(siteAddon)
    .where(eq(siteAddon.siteId, siteId));
  const siteAddonMap = new Map(saRows.map((r) => [r.addonId, r]));

  return c.html(
    <DashboardShell
      title={`${owned.name} — addons`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${siteId}/edit`, label: owned.name },
        { label: 'Addons' },
      ]}
      pageStyles={pageStyles}
    >
      <h1>Addons</h1>
      <p class="lede">
        Enable and configure addons for this site. Changes take effect on the next publish.
      </p>

      {allAddons.map((addon) => {
        const hasEntitlement = entitled.has(addon.id);
        const sa = siteAddonMap.get(addon.id);
        const isEnabled = sa?.enabled ?? false;
        const config: Record<string, string> = sa?.config ?? {};

        return (
          <div class="addon-section" data-addon-form={addon.id}>
            <div class="addon-section-header">
              <h2>{addon.name}</h2>
              {hasEntitlement && <Badge variant="success">Owned</Badge>}
              {hasEntitlement && (
                <Pill variant={isEnabled ? 'on' : 'off'}>
                  {isEnabled ? 'Enabled' : 'Disabled'}
                </Pill>
              )}
            </div>
            <p class="addon-section-desc">{addon.tagline}</p>

            {!hasEntitlement ? (
              <p class="not-purchased">
                You haven't acquired this addon yet.{' '}
                <a href="/dashboard/shop">Visit the Shop</a> to get it.
              </p>
            ) : (
              <>
                <div class="toggle-row">
                  <input
                    type="checkbox"
                    name="enabled"
                    id={`toggle-${addon.id}`}
                    checked={isEnabled}
                  />
                  <label class="toggle-label" for={`toggle-${addon.id}`}>
                    Enable on this site
                  </label>
                </div>

                {addon.configFields.map((field) => (
                  <div class="field-group">
                    <label for={`field-${addon.id}-${field.key}`}>{field.label}</label>
                    <input
                      type="text"
                      id={`field-${addon.id}-${field.key}`}
                      data-config-key={field.key}
                      value={config[field.key] ?? ''}
                      placeholder={field.placeholder}
                      pattern={field.pattern}
                    />
                    {field.patternHint && <p class="field-hint">{field.patternHint}</p>}
                  </div>
                ))}

                <div class="addon-actions">
                  <button type="button" class="btn-save" data-save="true">
                    Save
                  </button>
                </div>
                <p class="addon-msg msg"></p>
              </>
            )}
          </div>
        );
      })}

      <script>{raw(clientScript(siteId))}</script>
    </DashboardShell>,
  );
});

export default siteAddonsRoute;
