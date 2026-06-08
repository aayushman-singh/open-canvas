// src/dashboard-client/index.ts
//
// ADR 0021 — dashboard-client bundle entrypoint.
//
// Each dashboard route emits a tiny inline boot blob:
//
//   window.__opencanvasDashboardBoot = { route: 'profile', /* per-route data */ };
//
// Then loads this bundle:
//
//   <script src="/_assets/dashboard-<hash>.js" defer></script>
//
// On parse the entry reads the boot blob and dispatches to the per-page
// mount function. Pages that have not migrated yet stay on their inline
// scripts; this dispatcher only fires when a route emits the boot blob.
//
// The dispatcher fails loud on an unknown route — a typo in the route
// string would otherwise be a silent no-op the Owner only notices when
// the page's interactivity is gone.

import { mountProfile } from './profile.js';
import { mountAddonShop } from './addon-shop.js';
import { mountDomains } from './domains.js';
import { mountVersionTimeline } from './version-timeline.js';
import { mountSiteAddons } from './site-addons.js';
import { mountPageSettings } from './page-settings.js';
import { mountSettings } from './settings.js';

interface DashboardBoot {
  route:
    | 'profile'
    | 'addon-shop'
    | 'domains'
    | 'version-timeline'
    | 'site-addons'
    | 'page-settings'
    | 'settings';
  // Per-request keys — present only for routes that need them. The
  // `domains`, `version-timeline`, and `site-addons` routes ship the
  // site id whose resources they are editing so the mount module can
  // address `/api/sites/:siteId/...` (or `/api/addons/sites/:siteId/...`)
  // without a closure capture. `page-settings` ships BOTH `siteId` and
  // `pageId` since the SEO + metadata APIs are page-scoped. Other routes
  // (profile, addon-shop) leave this unset; addon-shop instead seeds
  // `#addon-state` JSON on the page.
  siteId?: string;
  pageId?: string;
}

declare global {
  interface Window {
    __opencanvasDashboardBoot?: DashboardBoot;
  }
}

const DISPATCH: { [K in DashboardBoot['route']]: () => void } = {
  profile: mountProfile,
  'addon-shop': mountAddonShop,
  domains: mountDomains,
  'version-timeline': mountVersionTimeline,
  'site-addons': mountSiteAddons,
  'page-settings': mountPageSettings,
  settings: mountSettings,
};

function run(): void {
  const boot = window.__opencanvasDashboardBoot;
  if (!boot) return;
  const mount = DISPATCH[boot.route];
  if (!mount) {
    console.error(
      `[dashboard-client] unknown route "${String(boot.route)}" in boot blob — no mount handler`,
    );
    return;
  }
  mount();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', run, { once: true });
} else {
  run();
}
