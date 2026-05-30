// src/routes/dashboard/addon-shop.tsx
//
// Root add-on catalogue at `/dashboard/addons` (sidebar: primary nav).
// Surfaces every add-on in the registry as an `.addon` card under the
// Open Canvas chrome (MIGRATION.md §5f / shop.html):
//
//   - Owned add-ons render with a `.chip .chip-ok` "Owned" badge and an
//     inline config panel: site selector + Enabled switch + config
//     fields + Save. Saves PUT to `/api/addons/sites/:siteId/:id`.
//   - Unowned add-ons render with the "Free" price + a `.btn .btn-primary`
//     "Get add-on" CTA that POSTs to `/api/addons/:id/acquire`.
//
// Coming-soon variants live as static cards rendered from the design
// reference (newsletter / online-store / bookings) — they have no entry
// in the registry yet, so they're rendered inline with `.addon.soon` +
// a disabled "Notify me" button.
//
// `/dashboard/shop` remains a 301 redirect so old bookmarks still land.
//
// DOM hooks preserved for the inline client script + API:
//   - data-acquire="<addonId>"        — acquire flow
//   - data-addon-config="<addonId>"   — per-site config form root
//   - data-site-select                — site selector inside config form
//   - data-addon-enable               — enable/disable checkbox
//   - data-config-key="<fieldKey>"    — text/textarea config inputs
//   - data-save                       — save button
//   - id="addon-state" + <script type="application/json">  — state seed

import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { addonEntitlement, site, siteAddon } from '../../db/schema';
import { DashboardShell } from './shell';
import { readThemeCookie } from '../../ui';
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

// Open Canvas chrome for the add-on catalogue. `.addon` cards, `.secttl`
// group labels, inline config panel — all variables come from theme.css.
const pageStyles = `
  .content > h1 { font-size: 32px; letter-spacing: -.03em; }
  .content > .sub {
    color: var(--ink-2);
    font-size: 16px;
    margin: 6px 0 30px;
    max-width: 56ch;
    line-height: 1.55;
  }

  .secttl {
    font-family: var(--display);
    font-size: 18px;
    margin: 28px 0 14px;
    color: var(--ink);
  }
  .secttl:first-of-type { margin-top: 8px; }

  .addon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .addon {
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    padding: 22px;
    display: flex;
    flex-direction: column;
    transition: transform .16s ease, box-shadow .2s ease;
  }
  .addon:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
  .addon.soon { opacity: .75; }
  .addon.soon:hover { transform: none; box-shadow: var(--shadow-sm); }

  .addon .ic {
    width: 48px;
    height: 48px;
    border-radius: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 14px;
  }
  .addon h3 {
    font-family: var(--display);
    font-size: 18px;
    margin: 0;
    color: var(--ink);
  }
  .addon .tag {
    font-size: 13.5px;
    color: var(--ink-2);
    margin: 7px 0 0;
    line-height: 1.5;
    flex: 1;
  }
  .addon .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 18px;
  }
  .addon .price {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-3);
  }

  /* inline config panel — slides under the head row for owned add-ons */
  .addon-config {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .addon-config .row {
    display: grid;
    grid-template-columns: 88px 1fr;
    gap: 12px;
    align-items: center;
  }
  .addon-config label.lbl-inline {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .addon-config select.field,
  .addon-config input[type="text"].field,
  .addon-config textarea.field {
    font-family: var(--sans);
    font-size: 14px;
    color: var(--ink);
    background: var(--surface);
    border: 1.5px solid var(--line-2);
    border-radius: var(--r-sm);
    padding: 9px 12px;
    width: 100%;
    transition: border-color .15s ease, box-shadow .15s ease;
    outline: none;
  }
  .addon-config textarea.field {
    font-family: var(--mono);
    font-size: 12.5px;
    min-height: 80px;
    resize: vertical;
  }
  .addon-config select.field:focus,
  .addon-config input[type="text"].field:focus,
  .addon-config textarea.field:focus {
    border-color: var(--red);
    box-shadow: var(--ring);
  }
  .addon-config .toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13.5px;
    color: var(--ink);
  }
  .addon-config .toggle-row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--red);
    cursor: pointer;
  }
  .addon-config .field-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .addon-config .field-block label {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .addon-config .field-hint {
    font-size: 12px;
    color: var(--ink-3);
  }
  .addon-config .save-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 2px;
  }
  .addon-msg {
    font-size: 13px;
    color: var(--ink-2);
    min-height: 16px;
    margin: 0;
  }
  .addon-msg-ok { color: var(--ok); }
  .addon-msg-err { color: var(--red-ink); }

  .empty-sites {
    margin: 18px 0 0;
    padding: 14px 16px;
    border: 1px dashed var(--line-2);
    border-radius: var(--r);
    background: var(--surface-2);
    font-size: 13px;
    color: var(--ink-2);
  }
  .empty-sites a { color: var(--red-ink); font-weight: 600; }
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
    var prev = btn.textContent;
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
      btn.textContent = prev + ' — retry';
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
        config[input.getAttribute('data-config-key')] = input.value.trim();
      });

      // Client-side pattern validation (mirrors addons.ts server-side check).
      // When the toggle is enabled, every input carrying a [pattern] attribute
      // must match before we PUT to /api/addons/...; we surface the field's
      // .field-hint as the error message so the failure is self-explanatory.
      if (enabled) {
        var inputs = form.querySelectorAll('[data-config-key]');
        for (var i = 0; i < inputs.length; i++) {
          var input = inputs[i];
          var pattern = input.getAttribute('pattern');
          if (!pattern) continue;
          var value = input.value.trim();
          if (value.length === 0 || !new RegExp('^(?:' + pattern + ')$').test(value)) {
            if (msg) {
              var hintBlock = input.parentNode ? input.parentNode.querySelector('.field-hint') : null;
              var hint = hintBlock ? hintBlock.textContent : 'Value does not match required format';
              msg.textContent = hint;
              msg.className = 'addon-msg addon-msg-err';
            }
            input.focus();
            return;
          }
        }
      }

      saveBtn.disabled = true;
      var prev = saveBtn.textContent;
      saveBtn.textContent = 'Saving...';
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

// Icon palette for each registry add-on. Matches the visual style of
// shop.html where every card has a tinted square icon.
type AddonGlyph = { bg: string; fg: string; path: string };
const ADDON_GLYPHS: Record<string, AddonGlyph> = {
  addon_google_analytics: {
    bg: '#fef0e6',
    fg: '#E8710A',
    path: '<path d="M4 19V10M10 19V5M16 19v-6M22 19H2" stroke-linecap="round"/>',
  },
  addon_custom_scripts: {
    bg: 'var(--surface-2)',
    fg: 'var(--ink)',
    path: '<path d="M8 9l-3 3 3 3M16 9l3 3-3 3M13 5l-2 14" stroke-linecap="round" stroke-linejoin="round"/>',
  },
};
const DEFAULT_GLYPH: AddonGlyph = {
  bg: 'var(--surface-2)',
  fg: 'var(--ink-2)',
  path: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8M12 8v8" stroke-linecap="round"/>',
};

function AddonIcon({ glyph }: { glyph: AddonGlyph }) {
  return raw(
    `<span class="ic" style="background:${glyph.bg};color:${glyph.fg}">` +
      `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${glyph.path}</svg>` +
      `</span>`,
  );
}

// Coming-soon catalogue from shop.html — these have no registry entry yet,
// so they render as static, non-interactive cards in the bottom group.
const COMING_SOON: Array<{ name: string; tag: string; iconPath: string }> = [
  {
    name: 'Newsletter',
    tag: 'Collect emails and send updates without leaving Open Canvas.',
    iconPath:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h6" stroke-linecap="round"/>',
  },
  {
    name: 'Online Store',
    tag: 'Sell products and take payments with a simple checkout.',
    iconPath:
      '<path d="M6 2h9l3 3v17H6z"/><path d="M9 12h6M9 16h6" stroke-linecap="round"/>',
  },
  {
    name: 'Bookings',
    tag: 'Let customers schedule appointments straight from your site.',
    iconPath:
      '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4" stroke-linecap="round"/>',
  },
];

// Old /shop path redirects to /addons so existing bookmarks keep working.
addonShopRoute.get('/shop', (c) => c.redirect('/dashboard/addons', 301));

addonShopRoute.get('/addons', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('addons reached without authenticated user');

  const database = db(c.env);

  // clerkAuth() middleware already loaded the customer row.
  const customerId = c.get('customer')?.id;

  let ownedAddonIds = new Set<string>();
  let sites: Array<{ id: string; name: string }> = [];
  // stateByAddon[addonId][siteId] = { enabled, config }
  const stateByAddon: Record<
    string,
    Record<string, { enabled: boolean; config: Record<string, string> }>
  > = {};

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
          config: row.config ?? {},
        };
      }
    }
  }

  // JSON-LD-style script-injection guard: escape any `</` inside the JSON
  // so a malicious config string can't close the script tag early.
  const stateJson = JSON.stringify(stateByAddon).replace(/</g, '\\u003c');

  // Group registry add-ons: Owned (with inline config) → Available (CTA).
  const ownedAddons = allAddons.filter((a) => ownedAddonIds.has(a.id));
  const availableAddons = allAddons.filter((a) => !ownedAddonIds.has(a.id));

  return c.html(
    <DashboardShell
      title="Open Canvas — Add-ons"
      crumbs={[{ href: '/dashboard', label: 'Dashboard' }, { label: 'Add-ons' }]}
      activePath="/dashboard/addons"
      pageStyles={pageStyles}
      theme={readThemeCookie(c)}
    >
      <h1>Add-ons</h1>
      <p class="sub">
        Bolt on extra powers — analytics, tracking, and more. Turn them on per site,
        no code required.
      </p>

      {ownedAddons.length > 0 && (
        <>
          <div class="secttl">Installed</div>
          <div class="addon-grid">
            {ownedAddons.map((addon) => {
              const glyph = ADDON_GLYPHS[addon.id] ?? DEFAULT_GLYPH;
              return (
                <div class="addon">
                  <AddonIcon glyph={glyph} />
                  <h3>{addon.name}</h3>
                  <p class="tag">{addon.tagline}</p>
                  <div class="foot">
                    <span class="chip chip-ok">
                      <span class="dot" />
                      Owned
                    </span>
                  </div>

                  {sites.length === 0 ? (
                    <p class="empty-sites">
                      Create a site first to configure this add-on.{' '}
                      <a href="/dashboard">Go to your sites →</a>
                    </p>
                  ) : (
                    <div class="addon-config" data-addon-config={addon.id}>
                      <div class="row">
                        <label
                          class="lbl-inline"
                          for={`site-select-${addon.id}`}
                        >
                          Site
                        </label>
                        <select
                          class="field"
                          id={`site-select-${addon.id}`}
                          data-site-select
                        >
                          {sites.map((s) => (
                            <option value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                      <label class="toggle-row">
                        <input type="checkbox" data-addon-enable />
                        <span>Enabled on this site</span>
                      </label>
                      {addon.configFields.map((field) => (
                        <div class="field-block">
                          <label for={`f-${addon.id}-${field.key}`}>{field.label}</label>
                          {field.key === 'headScripts' || field.key === 'bodyScripts' ? (
                            <textarea
                              class="field"
                              id={`f-${addon.id}-${field.key}`}
                              data-config-key={field.key}
                              placeholder={field.placeholder}
                            ></textarea>
                          ) : (
                            <input
                              class="field"
                              type="text"
                              id={`f-${addon.id}-${field.key}`}
                              data-config-key={field.key}
                              placeholder={field.placeholder}
                              {...(field.pattern ? { pattern: field.pattern } : {})}
                            />
                          )}
                          {field.patternHint && (
                            <span class="field-hint">{field.patternHint}</span>
                          )}
                        </div>
                      ))}
                      <div class="save-row">
                        <button type="button" class="btn btn-primary btn-sm" data-save>
                          Save
                        </button>
                        <p class="addon-msg" role="status" aria-live="polite"></p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {availableAddons.length > 0 && (
        <>
          <div class="secttl">Available</div>
          <div class="addon-grid">
            {availableAddons.map((addon) => {
              const glyph = ADDON_GLYPHS[addon.id] ?? DEFAULT_GLYPH;
              return (
                <div class="addon">
                  <AddonIcon glyph={glyph} />
                  <h3>{addon.name}</h3>
                  <p class="tag">{addon.tagline}</p>
                  <div class="foot">
                    <span class="price">Free</span>
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      data-acquire={addon.id}
                    >
                      Get add-on
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div class="secttl">Coming soon</div>
      <div class="addon-grid">
        {COMING_SOON.map((entry) => (
          <div class="addon soon">
            <AddonIcon
              glyph={{
                bg: 'var(--surface-2)',
                fg: 'var(--ink-2)',
                path: entry.iconPath,
              }}
            />
            <h3>{entry.name}</h3>
            <p class="tag">{entry.tag}</p>
            <div class="foot">
              <span class="price">Soon</span>
              <button type="button" class="btn btn-ghost btn-sm" disabled>
                Notify me
              </button>
            </div>
          </div>
        ))}
      </div>

      <script type="application/json" id="addon-state">
        {raw(stateJson)}
      </script>
      <script>{raw(clientScript())}</script>
    </DashboardShell>,
  );
});

export default addonShopRoute;
