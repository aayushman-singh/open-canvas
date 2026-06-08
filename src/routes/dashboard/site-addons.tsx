// src/routes/dashboard/site-addons.tsx
//
// Per-site add-on management at `/dashboard/sites/:siteId/addons`. Renders
// every add-on in the registry as an `.addon` card under the per-site
// sidebar chrome (MIGRATION.md §5f / shop.html).
//
// State surfaced per card:
//   - Entitled & enabled  → `.chip .chip-ok` "Installed" + config form +
//                          Save button. Saves PUT to
//                          `/api/addons/sites/:siteId/:id`.
//   - Entitled & disabled → `.chip` "Not on this site" + config form +
//                          Save button (toggling the switch flips state).
//   - Not entitled        → empty-state notice + link to the catalogue.
//
// Coming-soon catalogue from shop.html also renders as static
// `.addon.soon` cards under a "Coming soon" group.
//
// DOM hooks preserved for the inline client script + smoke selectors:
//   - data-addon-form="<addonId>"   — config form root
//   - name="enabled"                — enable/disable checkbox
//   - data-config-key="<fieldKey>"  — config inputs
//   - data-save="true"              — save button
//   - p.addon-msg                   — inline status / error message

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { addonEntitlement, site, siteAddon } from '../../db/schema';
import { DashboardShell, buildSiteNav } from './shell';
import { readThemeCookie } from '../../ui';
import { allAddons } from '../../addons/registry';
import { EDITOR_CLIENT_MANIFEST } from '../../_assets/manifest.generated';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const siteAddonsRoute = new Hono<Env>();

siteAddonsRoute.use('*', clerkAuth());
siteAddonsRoute.use('*', requireAuth());

// Open Canvas chrome for the per-site add-on surface. `.addon` cards stay
// shape-consistent with the root catalogue (shop.html); the per-site card
// adds an inline config block + Save button beneath the foot row.
const pageStyles = `
  .content > h1 { font-size: 32px; letter-spacing: -.03em; }
  .content > .sub {
    color: var(--ink-2);
    font-size: 15px;
    margin: 6px 0 28px;
    max-width: 60ch;
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
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
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
  }
  .addon .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 16px;
  }

  /* config block under each entitled card */
  .addon-config {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13.5px;
    color: var(--ink);
  }
  .toggle-row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--red);
    cursor: pointer;
  }
  .field-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field-block label {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .field-block input[type="text"].field {
    font-family: var(--sans);
    font-size: 14px;
    color: var(--ink);
    background: var(--surface);
    border: 1.5px solid var(--line-2);
    border-radius: var(--r-sm);
    padding: 9px 12px;
    width: 100%;
    outline: none;
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  .field-block input[type="text"].field:focus {
    border-color: var(--red);
    box-shadow: var(--ring);
  }
  .field-hint {
    font-size: 12px;
    color: var(--ink-3);
    margin: 0;
  }
  .field-hint.field-hint-err {
    color: var(--red-ink);
  }
  .save-row {
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
  .addon-msg.msg-ok { color: var(--ok); }
  .addon-msg.msg-err { color: var(--red-ink); }

  .not-purchased {
    margin-top: 16px;
    padding: 14px 16px;
    border: 1px dashed var(--line-2);
    border-radius: var(--r);
    background: var(--surface-2);
    font-size: 13px;
    color: var(--ink-2);
  }
  .not-purchased a { color: var(--red-ink); font-weight: 600; }

  /* ADR 0046 — Owner-facing warning above the addon_custom_scripts config.
     The addon ships raw Owner-authored JavaScript into the visitor's browser
     by design; the security boundary is the entitlement check, not script
     content. The warning is the Owner's only signal that they own the
     consequences of what they paste. Visual treatment is intentionally loud
     (red-tinted surface, bold label) because the consequence is real. */
  .custom-scripts-warning {
    margin-top: 16px;
    margin-bottom: 14px;
    padding: 12px 14px;
    border: 1px solid var(--red-ink);
    border-left-width: 4px;
    border-radius: var(--r);
    background: color-mix(in oklch, var(--red-ink) 6%, var(--surface));
    font-size: 13px;
    line-height: 1.45;
    color: var(--ink);
  }
  .custom-scripts-warning strong { color: var(--red-ink); }
`;

// ADR 0021 — migrated to dashboard-client bundle. Save-button validation
// + PUT logic now live in `src/dashboard-client/site-addons.ts` and ship
// in the shared dashboard bundle
// (`EDITOR_CLIENT_MANIFEST.dashboardClientUrl`). The route emits a tiny
// boot blob with `route: 'site-addons'` and the per-request `siteId`;
// the bundle's dispatcher reads it and calls `mountSiteAddons()`. DOM
// contract unchanged — same `[data-addon-form]`, `[name="enabled"]`,
// `[data-config-key]`, `[data-save]`, `.addon-msg`, `.field-hint`. API
// contract unchanged — same PUT
// `/api/addons/sites/:siteId/:addonId`. `siteId` flows through the boot
// blob via `JSON.stringify`, so quotes / braces in the value cannot
// break out of the inline script.
function clientBoot(siteId: string) {
  return raw(
    '<script>window.__opencanvasDashboardBoot = ' +
      JSON.stringify({ route: 'site-addons', siteId }) +
      ';</script>' +
      '<script src="' +
      EDITOR_CLIENT_MANIFEST.dashboardClientUrl +
      '" defer></script>',
  );
}

// Icon palette aligned with the root /dashboard/addons catalogue so a
// user moving between the two surfaces sees the same glyph per add-on.
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

// Coming-soon catalogue from shop.html — static cards under their own group.
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

siteAddonsRoute.get('/sites/:siteId/addons', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('addons page reached without authenticated user');

  const siteId = c.req.param('siteId');
  const database = db(c.env);

  // clerkAuth() middleware already loaded the customer row.
  const customerId = c.get('customer')?.id;
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
      title={`${owned.name} — Add-ons`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${siteId}/edit`, label: owned.name },
        { label: 'Add-ons' },
      ]}
      siteNav={buildSiteNav(siteId, owned.name, `/dashboard/sites/${siteId}/addons`)}
      pageStyles={pageStyles}
      theme={readThemeCookie(c)}
    >
      <h1>Add-ons</h1>
      <p class="sub">
        Turn add-ons on or off for <b>{owned.name}</b>. Changes take effect on the
        next publish.
      </p>

      <div class="secttl">Catalogue</div>
      <div class="addon-grid">
        {allAddons.map((addon) => {
          const glyph = ADDON_GLYPHS[addon.id] ?? DEFAULT_GLYPH;
          const hasEntitlement = entitled.has(addon.id);
          const sa = siteAddonMap.get(addon.id);
          const isEnabled = sa?.enabled ?? false;
          const config: Record<string, string> = sa?.config ?? {};

          return (
            // Real <form> (not a <div>) so form.checkValidity() in
            // clientScript() has a working validator. Pass-7 retest hit
            // this: the previous div-with-data-addon-form was a no-op for
            // the HTML5 validity API and bad measurementIds slipped through
            // to "Saved." Real form preserves the same selector behaviour
            // (querySelector('[data-addon-form]')) and adds working
            // checkValidity/reportValidity. The Save button is
            // type="button" so submit-on-Enter is suppressed; the existing
            // JS click handler stays the canonical save path.
            <form
              class="addon"
              data-addon-form={addon.id}
              onsubmit="event.preventDefault();return false;"
            >
              <AddonIcon glyph={glyph} />
              <h3>{addon.name}</h3>
              <p class="tag">{addon.tagline}</p>
              <div class="foot">
                {hasEntitlement ? (
                  isEnabled ? (
                    <span class="chip chip-ok">
                      <span class="dot" />
                      Installed
                    </span>
                  ) : (
                    <span class="chip">
                      <span class="dot" style="background:var(--ink-3)" />
                      Not on this site
                    </span>
                  )
                ) : (
                  <span class="chip">
                    <span class="dot" style="background:var(--ink-3)" />
                    Not acquired
                  </span>
                )}
              </div>

              {!hasEntitlement ? (
                <p class="not-purchased">
                  You haven't acquired this add-on yet.{' '}
                  <a href="/dashboard/addons">Visit Add-ons</a> to get it.
                </p>
              ) : (
                <div class="addon-config">
                  <label class="opencanvas-toggle" for={`toggle-${addon.id}`}>
                    <input
                      type="checkbox"
                      class="opencanvas-toggle-input"
                      name="enabled"
                      id={`toggle-${addon.id}`}
                      checked={isEnabled}
                    />
                    <span class="opencanvas-toggle-track" aria-hidden="true" />
                    <span class="opencanvas-toggle-text">Enable on this site</span>
                  </label>

                  {addon.id === 'addon_custom_scripts' && (
                    <div class="custom-scripts-warning" role="note">
                      <strong>Code you paste here runs in every visitor's browser on your site.</strong>{' '}
                      Only paste code you have read and trust. A snippet from an
                      untrusted source can compromise your visitors' privacy,
                      steal their input, or redirect them off your site.
                    </div>
                  )}

                  {addon.configFields.map((field) => (
                    <div class="field-block">
                      <label for={`field-${addon.id}-${field.key}`}>{field.label}</label>
                      <input
                        class="field"
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

                  <div class="save-row">
                    <button type="button" class="btn btn-primary btn-sm" data-save="true">
                      Save
                    </button>
                    <p class="addon-msg" role="status" aria-live="polite"></p>
                  </div>
                </div>
              )}
            </form>
          );
        })}
      </div>

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
              <span class="price" style="font-size:13px;font-weight:600;color:var(--ink-3)">
                Soon
              </span>
              <button type="button" class="btn btn-ghost btn-sm" disabled>
                Notify me
              </button>
            </div>
          </div>
        ))}
      </div>

      {clientBoot(siteId)}
    </DashboardShell>,
  );
});

export default siteAddonsRoute;
