import { Hono } from 'hono';
import { raw } from 'hono/html';
import { eq, count, sum } from 'drizzle-orm';
import { siteLimitForPlan, storageLimitForPlan } from '../../billing/plan-limits';
import { PlanTiles, planTilesStyles } from '../../billing/plan-tiles';
import { db } from '../../db/client';
import { site, ownerAsset } from '../../db/schema';
import { clerkAuth, getClerkUser } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { DashboardShell } from './shell';
import { Button, readThemeCookie } from '../../ui';
import { EDITOR_CLIENT_MANIFEST } from '../../_assets/manifest.generated';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
  DEV_PUBLIC_HOST?: string;
  DATABASE_URL: string;
};

const settingsRoute = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

settingsRoute.use('*', clerkAuth());
settingsRoute.use('*', requireAuth());

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Per ADR 0042 (2026-06-04 amendment), settings.tsx renders a four-tab
// Account page: Plan (mock-billing plan picker), Usage (Sites + Storage
// meters), Notifications, Account. The 2026-05-30 metering-only framing
// dead-ended the dashboard's "Upgrade to add sites" CTA at a surface
// with no upgrade affordance; the Plan tab re-introduces tiles + a
// Switch button that flips customer.plan via PATCH /api/profile. The
// mock is the cost (no payment is processed); the DB write is real.
//
// The Usage panel keeps its 'tab-billing' panel id for deep-link
// continuity with prior smoke tests. The .settings-tab / .settings-panel
// / data-tab / data-active hooks the bundled tab-switch handler reads
// (see `src/dashboard-client/settings.ts`) are unchanged.
const settingsStyles = `
  .content { max-width: 820px; padding-bottom: 70px; }
  .content > h1 { font-size: 32px; letter-spacing: -.03em; margin-bottom: 4px; }
  .content > .sub { color: var(--ink-2); margin: 6px 0 0; font-size: 14.5px; }

  .settings-tabs {
    display: flex;
    gap: 4px;
    margin: 22px 0 26px;
    border-bottom: 1px solid var(--line);
  }
  .settings-tab {
    font-family: var(--sans);
    font-size: 15px;
    font-weight: 650;
    padding: 12px 4px;
    margin-right: 22px;
    border: none;
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    position: relative;
    white-space: nowrap;
  }
  .settings-tab:hover { color: var(--ink-2); }
  .settings-tab[aria-selected="true"] { color: var(--ink); }
  .settings-tab[aria-selected="true"]::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 3px;
    background: var(--red);
    border-radius: 99px;
  }
  .settings-panel { display: none; }
  .settings-panel[data-active="true"] { display: block; }

  /* usage meters (.mtr) — ADR 0042: only Sites + Storage ship. */
  .meters {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
    margin-bottom: 22px;
  }
  .mtr {
    padding: 16px 18px;
    border: 1px solid var(--line);
    border-radius: var(--r);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .mtr .k {
    font-size: 12.5px;
    color: var(--ink-2);
    font-weight: 600;
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .mtr .bar {
    height: 6px;
    border-radius: 99px;
    background: var(--surface-3);
    margin-top: 10px;
    overflow: hidden;
  }
  .mtr .bar i {
    display: block;
    height: 100%;
    background: var(--red);
    border-radius: 99px;
    transition: width .35s ease;
  }
  .mtr .bar i.warn { background: var(--warn); }
  .mtr .bar i.ok { background: var(--ok); }

  /* notifications + account panes (sparse, but use card surface) */
  .acc-card { padding: 24px; margin-bottom: 16px; }
  .acc-card h2 {
    font-family: var(--display);
    font-size: 18px;
    font-weight: 700;
    margin: 0 0 4px;
    color: var(--ink);
  }
  .acc-card .ch-sub {
    font-size: 13.5px;
    color: var(--ink-2);
    margin: 0 0 18px;
    line-height: 1.5;
  }
  .acc-card.danger { border-color: var(--red-line); }
  .acc-card.danger h2 { color: var(--red-ink); }

  /* notification kinds list — per ADR 0043 + email-policy.ts.
     Read-only: surfaces what's wired so users don't wonder if the bell
     is fake; per-user channel preferences are not in scope yet. */
  .notif-kinds {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: 1px;
    background: var(--line);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .notif-kind {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 14px;
    align-items: center;
    padding: 14px 16px;
    background: var(--surface);
  }
  .notif-kind .nk-label { min-width: 0; }
  .notif-kind .nk-label b {
    display: block;
    font-size: 14px;
    color: var(--ink);
    font-weight: 650;
    margin-bottom: 2px;
  }
  .notif-kind .nk-label small {
    display: block;
    font-size: 12.5px;
    color: var(--ink-3);
    line-height: 1.45;
  }
  .nk-pill {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 4px 9px;
    border-radius: var(--r-pill);
    white-space: nowrap;
  }
  .nk-pill.on  { background: var(--ok-soft); color: var(--ok); }
  .nk-pill.off { background: var(--surface-2); color: var(--ink-3); }
  .nk-pill.cond { background: var(--warn-soft); color: var(--warn); }
  .notif-channel-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface);
    margin-bottom: 18px;
  }
  .notif-channel-row .ch-icon {
    width: 32px; height: 32px;
    border-radius: var(--r-xs);
    background: var(--surface-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-2);
    flex-shrink: 0;
  }
  .notif-channel-row .ch-body { flex: 1; min-width: 0; }
  .notif-channel-row .ch-body b {
    display: block;
    font-size: 13.5px;
    color: var(--ink);
    font-weight: 650;
  }
  .notif-channel-row .ch-body small {
    display: block;
    font-size: 12px;
    color: var(--ink-3);
    margin-top: 1px;
  }
  .notif-preferences-note {
    font-size: 12.5px;
    color: var(--ink-3);
    margin: 14px 0 0;
    line-height: 1.5;
  }

  .acc-user-row {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .acc-user-row .ava-small {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, #E9837A, #C5332F);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 18px;
    font-family: var(--display);
    flex-shrink: 0;
    overflow: hidden;
  }
  .acc-user-row .ava-small img {
    width: 100%; height: 100%; object-fit: cover;
  }
  .acc-user-row .who { flex: 1; min-width: 0; }
  .acc-user-row .who b { font-size: 15px; color: var(--ink); font-family: var(--display); }
  .acc-user-row .who small {
    display: block;
    color: var(--ink-3);
    font-size: 13px;
    margin-top: 2px;
    word-break: break-all;
  }

  @media (max-width: 760px) {
    .meters { grid-template-columns: 1fr; }
  }
`;

// ADR 0021 — migrated to dashboard-client bundle. The tab-switcher and
// the ADR 0042 plan-picker click handler now live in
// `src/dashboard-client/settings.ts` and ship in the shared dashboard
// bundle (`EDITOR_CLIENT_MANIFEST.dashboardClientUrl`). The route emits
// a tiny boot blob with `route: 'settings'` (no per-request keys —
// both handlers operate purely on DOM hooks); the bundle's dispatcher
// reads it and calls `mountSettings()`. DOM contract unchanged —
// `.settings-tab` / `.settings-panel` / `[data-tab]` / `[data-active]`
// for tabs, `#tab-plan .plan-switch-btn[data-plan]` for the plan
// picker. API contract unchanged — same PATCH `/api/profile` with
// `{ plan }` from the plan switch.
const clientBoot = raw(
  '<script>window.__opencanvasDashboardBoot = ' +
    JSON.stringify({ route: 'settings' }) +
    ';</script>' +
    '<script src="' +
    EDITOR_CLIENT_MANIFEST.dashboardClientUrl +
    '" defer></script>',
);

settingsRoute.get('/settings', async (c) => {
  const user = await getClerkUser(c);
  if (!user) {
    throw new Error('settings page reached without a resolved user');
  }
  // clerkAuth() middleware already upserted + loaded the customer row; reading
  // it from context saves the upsert round trip and the redundant SELECT that
  // used to live here.
  const customerRecord = c.get('customer');
  if (!customerRecord) {
    throw new Error('settings page reached without a resolved customer');
  }

  const database = db(c.env);
  const primaryEmail = customerRecord.email;
  const customerId = customerRecord.id;
  // Per ADR 0042's 2026-06-04 amendment, customer.plan now drives both
  // the Plan tab picker and the Usage meters. The picker writes the same
  // column the site/storage limit checks read; no payment engine is implied.
  const customerPlan = customerRecord.plan;

  // Sites count + storage sum are independent; running them in parallel halves
  // the Neon round trips this page pays. Over the HTTP driver each query is a
  // fresh HTTPS request, so serial waits stack visibly in the page open time.
  const [sc, sb] = await Promise.all([
    database.select({ count: count() }).from(site).where(eq(site.customerId, customerId)),
    database
      .select({ total: sum(ownerAsset.byteSize) })
      .from(ownerAsset)
      .where(eq(ownerAsset.customerId, customerId)),
  ]);
  const siteCount = sc[0]?.count ?? 0;
  const storageBytes = Number(sb[0]?.total ?? 0);

  const siteLimit = siteLimitForPlan(customerPlan);
  const storageBytesLimit = storageLimitForPlan(customerPlan);
  const siteLimitLabel = siteLimit === null ? '∞' : String(siteLimit);
  const storageLimitLabel = formatBytes(storageBytesLimit);
  const sitesFillPct = siteLimit === null ? 0 : Math.min(100, (siteCount / siteLimit) * 100);
  const storageFillPct = Math.min(100, (storageBytes / storageBytesLimit) * 100);

  // Usage band tint — green under 60%, warn under 90%, red at/above.
  function fillTone(pct: number): string {
    if (pct >= 90) return '';
    if (pct >= 60) return 'warn';
    return 'ok';
  }
  const sitesTone = fillTone(sitesFillPct);
  const storageTone = fillTone(storageFillPct);

  const avatarUrl = user.imageUrl;
  const displayName = customerRecord.displayName ?? user.firstName ?? undefined;
  const initial = (displayName ?? primaryEmail ?? '?').charAt(0).toUpperCase();

  return c.html(
    <DashboardShell
      title="Open Canvas — settings"
      crumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Settings' }]}
      activePath="/dashboard/settings"
      pageStyles={settingsStyles + planTilesStyles}
      userMeta={{ avatarUrl, displayName, email: primaryEmail }}
      theme={readThemeCookie(c)}
    >
      <h1>Settings</h1>
      <p class="sub">Track how much of your account you're using and manage your profile.</p>

      <div class="settings-tabs" role="tablist">
        <button class="settings-tab" role="tab" aria-selected="true" data-tab="tab-plan">
          Plan
        </button>
        <button class="settings-tab" role="tab" aria-selected="false" data-tab="tab-billing">
          Usage
        </button>
        <button class="settings-tab" role="tab" aria-selected="false" data-tab="tab-notifications">
          Notifications
        </button>
        <button class="settings-tab" role="tab" aria-selected="false" data-tab="tab-account">
          Account
        </button>
      </div>

      <div class="settings-panel" id="tab-plan" data-active="true">
        {/* ADR 0042 (2026-06-04 amendment). The plan picker is the
            canonical upgrade affordance and the destination of the
            dashboard's "Upgrade to add sites" CTA / Plan-stat-card
            Upgrade link. The "Switch to X" button on each tile flips
            customer.plan via PATCH /api/profile. The cost is mocked
            (no payment is processed); the DB write and its consequence
            (per-plan site/storage caps re-enforced on the next request)
            are real. The click handler lives in `src/dashboard-client/settings.ts`
            (`wirePlanSwitch`); see `clientBoot` below. */}
        <PlanTiles currentPlan={customerPlan} />
        <p class="plan-mock-note">
          Switching plans is instant and free in this build — no card needed, no charges made. Your
          plan choice is what the per-plan site and storage caps are checked against.
        </p>
      </div>

      <div class="settings-panel" id="tab-billing" data-active="false">
        {/* ADR 0042 (2026-06-04 amendment). The Usage meters survived
            the metering-only → plan-picker reframe; they're still the
            canonical telemetry display for the per-plan caps. The Plan
            tab above is the upgrade affordance. */}
        <div class="meters">
          <div class="mtr">
            <div class="k">
              <span>Sites</span>
              <span>
                {String(siteCount)} / {siteLimitLabel}
              </span>
            </div>
            <div class="bar">
              <i class={sitesTone} style={`width:${sitesFillPct}%`} />
            </div>
          </div>
          <div class="mtr">
            <div class="k">
              <span>Storage</span>
              <span>
                {formatBytes(storageBytes)} / {storageLimitLabel}
              </span>
            </div>
            <div class="bar">
              <i class={storageTone} style={`width:${storageFillPct}%`} />
            </div>
          </div>
        </div>
      </div>

      <div class="settings-panel" id="tab-notifications" data-active="false">
        <div class="card acc-card">
          <h2>Delivery channels</h2>
          <p class="ch-sub">
            Open Canvas delivers notifications two ways. The bell shows everything in real time;
            email goes out for the events most likely to need attention away from the dashboard.
          </p>
          <div class="notif-channel-row">
            <span class="ch-icon" aria-hidden="true">
              {raw(
                `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
              )}
            </span>
            <div class="ch-body">
              <b>In-app bell</b>
              <small>
                Top-bar bell on the dashboard and in the editor. Live updates over WebSocket.
              </small>
            </div>
            <span class="nk-pill on">On</span>
          </div>
          <div class="notif-channel-row">
            <span class="ch-icon" aria-hidden="true">
              {raw(
                `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6" stroke-linecap="round"/></svg>`,
              )}
            </span>
            <div class="ch-body">
              <b>Email to {primaryEmail}</b>
              <small>Sent for the events flagged below. Goes to your Clerk primary address.</small>
            </div>
            <span class="nk-pill on">On</span>
          </div>
        </div>

        <div class="card acc-card">
          <h2>What you get notified about</h2>
          <p class="ch-sub">
            Every event below lands in the bell. The right column shows whether it also generates an
            email.
          </p>
          <ul class="notif-kinds">
            <li class="notif-kind">
              <div class="nk-label">
                <b>Form submissions</b>
                <small>A visitor submits a form on one of your sites.</small>
              </div>
              <span class="nk-pill on">Bell</span>
              <span class="nk-pill on">Email</span>
            </li>
            <li class="notif-kind">
              <div class="nk-label">
                <b>Publish failures</b>
                <small>A publish attempt couldn't finish — surfaces the failure reason.</small>
              </div>
              <span class="nk-pill on">Bell</span>
              <span class="nk-pill on">Email</span>
            </li>
            <li class="notif-kind">
              <div class="nk-label">
                <b>Successful publishes</b>
                <small>Confirmation that a publish landed cleanly with its new version.</small>
              </div>
              <span class="nk-pill on">Bell</span>
              <span class="nk-pill off">No email</span>
            </li>
            <li class="notif-kind">
              <div class="nk-label">
                <b>Access changes to your account</b>
                <small>Your role on a site changed or your access was revoked.</small>
              </div>
              <span class="nk-pill on">Bell</span>
              <span class="nk-pill on">Email</span>
            </li>
            <li class="notif-kind">
              <div class="nk-label">
                <b>Invites and joins addressed to you</b>
                <small>You were invited to a site, or your invitation was accepted.</small>
              </div>
              <span class="nk-pill on">Bell</span>
              <span class="nk-pill on">Email</span>
            </li>
            <li class="notif-kind">
              <div class="nk-label">
                <b>Teammate activity on shared sites</b>
                <small>Other collaborators joining, leaving, or having their role changed.</small>
              </div>
              <span class="nk-pill on">Bell</span>
              <span class="nk-pill off">No email</span>
            </li>
          </ul>
          <p class="notif-preferences-note">
            Per-event opt-outs aren't customizable yet. The channels above match the policy enforced
            server-side; if any address an issue, the bell will catch it.
          </p>
        </div>
      </div>

      <div class="settings-panel" id="tab-account" data-active="false">
        <div class="card acc-card">
          <h2>Account</h2>
          <p class="ch-sub">
            Manage your Open Canvas identity. Profile details live on a dedicated page.
          </p>
          <div class="acc-user-row">
            <div class="ava-small">
              {avatarUrl ? <img src={avatarUrl} alt="" width="48" height="48" /> : initial}
            </div>
            <div class="who">
              <b>{displayName ?? primaryEmail.split('@')[0]}</b>
              <small>{primaryEmail}</small>
            </div>
            <Button variant="secondary" href="/dashboard/profile">
              Edit profile
            </Button>
          </div>
        </div>

        <div class="card acc-card danger">
          <h2>Danger zone</h2>
          <p class="ch-sub">
            Permanently delete your account and all associated data. This cannot be undone.
          </p>
          <button
            class="btn btn-outline"
            style="color:var(--red-ink);border-color:var(--red-line)"
            onclick="__opencanvasModal.alert('Account deletion is not available in the demo.', 'Not available')"
          >
            Delete account
          </button>
        </div>
      </div>

      {clientBoot}
    </DashboardShell>,
  );
});

export default settingsRoute;
