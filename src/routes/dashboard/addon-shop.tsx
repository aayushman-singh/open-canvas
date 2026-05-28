// src/routes/dashboard/addon-shop.tsx
//
// Top-level addon catalogue at `/dashboard/addons`. Surfaces every addon in
// the registry as a card:
//
//   - Not owned        → "Get addon" button (POST /api/addons/:id/acquire).
//   - Owned            → inline config panel with a site selector. Picking a
//                        site swaps the visible enabled-state + config fields
//                        for that site, sourced from the embedded JSON state
//                        block. Saving PUTs to /api/addons/sites/:siteId/:id.
//
// `/dashboard/shop` is kept as a 301 alias so old links keep working.

import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { customer, addonEntitlement, site, siteAddon } from '../../db/schema';
import { DashboardShell } from './shell';
import { Badge } from '../../ui';
import { allAddons } from '../../addons/registry';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const addonShopRoute = new Hono<Env>();

addonShopRoute.use('*', clerkAuth());
addonShopRoute.use('*', requireAuth());

const pageStyles = `
  .shop-lede {
    margin: 4px 0 28px;
    color: var(--muted);
    max-width: 560px;
    line-height: 1.55;
    font-size: 14px;
  }
  .addon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 20px;
  }
  .addon-card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .addon-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .addon-card-header h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }
  .addon-card-tagline {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.5;
    margin: 0;
  }
  .addon-card-desc {
    color: var(--faint);
    font-size: 12px;
    line-height: 1.55;
    margin: 0;
  }
  .addon-card-footer {
    margin-top: 4px;
    padding-top: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid rgba(255,255,255,0.05);
  }
  .addon-price {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .btn-acquire {
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
  .btn-acquire:hover { filter: brightness(0.88); }
  .btn-acquire:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: none;
  }

  /* --- Inline config panel (owned addons) ----------------------------- */
  .addon-config {
    border-top: 1px solid rgba(255,255,255,0.05);
    padding-top: 14px;
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .addon-config-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .addon-config select {
    padding: 7px 10px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    flex: 1;
    min-width: 0;
  }
  .addon-config select:focus {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 2px rgba(125,211,252,0.15);
  }
  .addon-config-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text);
  }
  .addon-config-toggle input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .addon-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .addon-field label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    font-weight: 500;
  }
  .addon-field input[type="text"],
  .addon-field textarea {
    padding: 9px 12px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    font-family: ui-monospace, 'JetBrains Mono', SFMono-Regular, Consolas, monospace;
    outline: none;
    box-sizing: border-box;
    resize: vertical;
  }
  .addon-field textarea { min-height: 70px; }
  .addon-field input[type="text"]:focus,
  .addon-field textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(125,211,252,0.15);
  }
  .addon-field-hint {
    font-size: 11px;
    color: var(--faint);
  }
  .addon-save-row {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 2px;
  }
  .btn-save {
    padding: 7px 16px;
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
  .btn-save:disabled { opacity: 0.55; cursor: wait; filter: none; }
  .addon-msg {
    font-size: 12.5px;
    min-height: 14px;
  }
  .addon-msg-ok { color: #4ade80; }
  .addon-msg-err { color: #ef4444; }
  .addon-empty-sites {
    font-size: 12.5px;
    color: var(--faint);
    line-height: 1.55;
  }
  .addon-empty-sites a { color: var(--accent); }
`;

function clientScript(): string {
  return String.raw`
(function() {
  // -- Acquire flow (unowned addons) --------------------------------------
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-acquire]');
    if (!btn) return;
    var addonId = btn.getAttribute('data-acquire');
    btn.disabled = true;
    btn.textContent = 'Acquiring...';
    fetch('/api/addons/' + addonId + '/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(result) {
      if (!result.ok) throw new Error(result.data.error || 'Failed');
      location.reload();
    })
    .catch(function() {
      btn.textContent = 'Failed — retry';
      btn.disabled = false;
    });
  });

  // -- Per-site config form (owned addons) --------------------------------
  // Embedded state shape:
  //   stateByAddon[addonId][siteId] = { enabled: bool, config: { key: value } }
  // The site selector switches the form to whichever site's saved state.
  var stateNode = document.getElementById('addon-state');
  if (!stateNode) return;
  var stateByAddon;
  try { stateByAddon = JSON.parse(stateNode.textContent || '{}'); }
  catch (_) { stateByAddon = {}; }

  function loadSite(form, addonId, siteId) {
    var stateForAddon = stateByAddon[addonId] || {};
    var s = stateForAddon[siteId] || { enabled: false, config: {} };
    var toggle = form.querySelector('[data-addon-enable]');
    if (toggle) toggle.checked = !!s.enabled;
    form.querySelectorAll('[data-config-key]').forEach(function(input) {
      var key = input.getAttribute('data-config-key');
      input.value = (s.config && s.config[key] !== undefined) ? s.config[key] : '';
    });
    var msg = form.querySelector('.addon-msg');
    if (msg) { msg.textContent = ''; msg.className = 'addon-msg'; }
  }

  document.querySelectorAll('[data-addon-config]').forEach(function(form) {
    var addonId = form.getAttribute('data-addon-config');
    var siteSelect = form.querySelector('[data-site-select]');
    var saveBtn = form.querySelector('[data-save]');
    var msg = form.querySelector('.addon-msg');
    if (!siteSelect || !saveBtn) return;

    // Prime the form with the first site's state.
    loadSite(form, addonId, siteSelect.value);

    siteSelect.addEventListener('change', function() {
      loadSite(form, addonId, siteSelect.value);
    });

    saveBtn.addEventListener('click', function() {
      var siteId = siteSelect.value;
      var enabledEl = form.querySelector('[data-addon-enable]');
      var enabled = enabledEl ? enabledEl.checked : false;
      var config = {};
      form.querySelectorAll('[data-config-key]').forEach(function(input) {
        config[input.getAttribute('data-config-key')] = input.value;
      });
      saveBtn.disabled = true;
      var prev = saveBtn.textContent;
      saveBtn.textContent = 'Saving…';
      if (msg) { msg.textContent = ''; msg.className = 'addon-msg'; }
      fetch('/api/addons/sites/' + siteId + '/' + addonId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabled, config: config }),
      })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(result) {
        saveBtn.disabled = false;
        saveBtn.textContent = prev;
        if (!result.ok) throw new Error(result.data.error || 'Save failed');
        if (msg) { msg.textContent = 'Saved. Publish to apply.'; msg.className = 'addon-msg addon-msg-ok'; }
        // Refresh the in-memory state so the user's next site-switch
        // reflects what they just saved instead of resetting to the
        // server-rendered baseline.
        if (!stateByAddon[addonId]) stateByAddon[addonId] = {};
        stateByAddon[addonId][siteId] = { enabled: enabled, config: config };
      })
      .catch(function(err) {
        saveBtn.disabled = false;
        saveBtn.textContent = prev;
        if (msg) { msg.textContent = err.message; msg.className = 'addon-msg addon-msg-err'; }
      });
    });
  });
})();
`;
}

// Old /shop path redirects to /addons so existing bookmarks keep working.
addonShopRoute.get('/shop', (c) => c.redirect('/dashboard/addons', 301));

addonShopRoute.get('/addons', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('addons reached without authenticated user');

  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;

  let ownedAddonIds = new Set<string>();
  let sites: Array<{ id: string; name: string }> = [];
  // stateByAddon[addonId][siteId] = { enabled, config }
  const stateByAddon: Record<string, Record<string, { enabled: boolean; config: Record<string, string> }>> = {};

  if (customerId) {
    const entRows = await database
      .select({ addonId: addonEntitlement.addonId })
      .from(addonEntitlement)
      .where(eq(addonEntitlement.customerId, customerId));
    ownedAddonIds = new Set(entRows.map((r) => r.addonId));

    const siteRows = await database
      .select({ id: site.id, name: site.name })
      .from(site)
      .where(eq(site.customerId, customerId));
    sites = siteRows.map((r) => ({ id: r.id, name: r.name }));

    if (sites.length > 0 && ownedAddonIds.size > 0) {
      const siteIds = sites.map((s) => s.id);
      const saRows = await database
        .select()
        .from(siteAddon)
        .where(inArray(siteAddon.siteId, siteIds));
      for (const row of saRows) {
        if (!ownedAddonIds.has(row.addonId)) continue;
        const perAddon = stateByAddon[row.addonId] ?? (stateByAddon[row.addonId] = {});
        perAddon[row.siteId] = {
          enabled: row.enabled,
          config: (row.config as Record<string, string>) ?? {},
        };
      }
    }
  }

  // JSON-LD-style script-injection guard: escape any `</` inside the JSON
  // so a malicious config string can't close the script tag early.
  const stateJson = JSON.stringify(stateByAddon).replace(/</g, '\\u003c');

  return c.html(
    <DashboardShell
      title="rev01 — addons"
      crumbs={[{ href: '/dashboard', label: 'Dashboard' }, { label: 'Addons' }]}
      activePath="/dashboard/addons"
      pageStyles={pageStyles}
    >
      <h1>Addons</h1>
      <p class="shop-lede">
        Extend your sites with integrations. Acquire an addon once, then configure it per site —
        each site gets its own settings.
      </p>

      <div class="addon-grid">
        {allAddons.map((addon) => {
          const owned = ownedAddonIds.has(addon.id);
          return (
            <div class="addon-card">
              <div class="addon-card-header">
                <h3>{addon.name}</h3>
                {owned && <Badge variant="success">Owned</Badge>}
              </div>
              <p class="addon-card-tagline">{addon.tagline}</p>
              <p class="addon-card-desc">{addon.description}</p>

              {owned ? (
                sites.length === 0 ? (
                  <div class="addon-config">
                    <p class="addon-empty-sites">
                      Create a site first to configure this addon.{' '}
                      <a href="/dashboard">Go to your sites →</a>
                    </p>
                  </div>
                ) : (
                  <div class="addon-config" data-addon-config={addon.id}>
                    <div class="addon-config-row">
                      <label
                        for={`site-select-${addon.id}`}
                        style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;"
                      >
                        Site
                      </label>
                      <select id={`site-select-${addon.id}`} data-site-select>
                        {sites.map((s) => (
                          <option value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <label class="addon-config-toggle">
                      <input type="checkbox" data-addon-enable />
                      <span>Enabled on this site</span>
                    </label>
                    {addon.configFields.map((field) => (
                      <div class="addon-field">
                        <label for={`f-${addon.id}-${field.key}`}>{field.label}</label>
                        {field.key === 'headScripts' || field.key === 'bodyScripts' ? (
                          <textarea
                            id={`f-${addon.id}-${field.key}`}
                            data-config-key={field.key}
                            placeholder={field.placeholder}
                          ></textarea>
                        ) : (
                          <input
                            type="text"
                            id={`f-${addon.id}-${field.key}`}
                            data-config-key={field.key}
                            placeholder={field.placeholder}
                            {...(field.pattern ? { pattern: field.pattern } : {})}
                          />
                        )}
                        {field.patternHint && (
                          <span class="addon-field-hint">{field.patternHint}</span>
                        )}
                      </div>
                    ))}
                    <div class="addon-save-row">
                      <button type="button" class="btn-save" data-save>Save</button>
                      <p class="addon-msg" role="status" aria-live="polite"></p>
                    </div>
                  </div>
                )
              ) : (
                <div class="addon-card-footer">
                  <span class="addon-price">Free</span>
                  <button type="button" class="btn-acquire" data-acquire={addon.id}>
                    Get addon
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <script type="application/json" id="addon-state">{raw(stateJson)}</script>
      <script>{raw(clientScript())}</script>
    </DashboardShell>,
  );
});

export default addonShopRoute;
