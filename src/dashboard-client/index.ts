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

interface DashboardBoot {
  route: 'profile';
}

declare global {
  interface Window {
    __opencanvasDashboardBoot?: DashboardBoot;
  }
}

const DISPATCH: { [K in DashboardBoot['route']]: () => void } = {
  profile: mountProfile,
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
