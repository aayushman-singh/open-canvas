import { Hono } from 'hono';
import { raw } from 'hono/html';
import { eq, count, sum } from 'drizzle-orm';
import { siteLimitForPlan, storageLimitForPlan } from '../../billing/plan-limits';
import { db } from '../../db/client';
import { customer, site, ownerAsset } from '../../db/schema';
import { clerkAuth } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { upsertCustomerFromClerk } from '../../auth/customer-upsert';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { DashboardShell } from './shell';
import { Button, readThemeCookie } from '../../ui';

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

// Per ADR 0042 (which supersedes ADR 0037), settings.tsx renders a
// metering-only Account page — Sites + Storage usage meters, plus the
// Notifications and Account profile tabs. The original layout (plan
// tiles, fake invoices, "Coming soon" alerts) was removed because the
// billing engine itself isn't being implemented; rendering an
// engine-less billing surface would be a no-fallback violation.
//
// Naming kept stable for deep-link continuity: the first tab still
// uses panel id 'tab-billing' (now visually labelled 'Usage'), and
// the .settings-tab / .settings-panel / data-tab / data-active hooks
// the inline tab-switch script reads are unchanged.
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

  /* current-plan summary card (account.html .plan-now) */
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

const tabScript = raw(`<script>
(function() {
  var tabs = document.querySelectorAll('.settings-tab');
  var panels = document.querySelectorAll('.settings-panel');
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      tabs.forEach(function(t) { t.setAttribute('aria-selected', 'false'); });
      panels.forEach(function(p) { p.setAttribute('data-active', 'false'); });
      tab.setAttribute('aria-selected', 'true');
      var target = document.getElementById(tab.getAttribute('data-tab'));
      if (target) target.setAttribute('data-active', 'true');
    });
  });
})();
</script>`);

settingsRoute.get('/settings', async (c) => {
  const user = c.get('user');
  if (!user) {
    throw new Error('settings page reached without a resolved user');
  }

  const database = db(c.env);
  const { email: primaryEmail } = await upsertCustomerFromClerk(database, user);

  const customerRow = await database
    .select({ id: customer.id, displayName: customer.displayName, plan: customer.plan })
    .from(customer)
    .where(eq(customer.clerkUserId, user.id))
    .limit(1);
  const customerRecord = customerRow[0];
  const customerId = customerRecord?.id;
  // Per ADR 0042: the customer.plan column still exists (cohorts seeded
  // by ADR 0009 / migration 0007), but the Account surface no longer
  // exposes billing — no plan tiles, no invoices, no upgrade prompts.
  // We still read the plan to drive the *limits* the meters render
  // against (siteLimitForPlan / storageLimitForPlan), because the
  // limit is a real product constraint enforced at write time.
  const customerPlan = customerRecord?.plan ?? 'free';

  let siteCount = 0;
  let storageBytes = 0;
  if (customerId) {
    const sc = await database
      .select({ count: count() })
      .from(site)
      .where(eq(site.customerId, customerId));
    siteCount = sc[0]?.count ?? 0;

    const sb = await database
      .select({ total: sum(ownerAsset.byteSize) })
      .from(ownerAsset)
      .where(eq(ownerAsset.customerId, customerId));
    storageBytes = Number(sb[0]?.total ?? 0);
  }

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
  const displayName = customerRow[0]?.displayName ?? user.firstName ?? undefined;
  const initial = (displayName ?? primaryEmail ?? '?').charAt(0).toUpperCase();

  return c.html(
    <DashboardShell
      title="Open Canvas — settings"
      crumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Settings' }]}
      activePath="/dashboard/settings"
      pageStyles={settingsStyles}
      userMeta={{ avatarUrl, displayName, email: primaryEmail }}
      theme={readThemeCookie(c)}
    >
      <h1>Settings</h1>
      <p class="sub">Track how much of your account you're using and manage your profile.</p>

      <div class="settings-tabs" role="tablist">
        <button class="settings-tab" role="tab" aria-selected="true" data-tab="tab-billing">
          Usage
        </button>
        <button class="settings-tab" role="tab" aria-selected="false" data-tab="tab-notifications">
          Notifications
        </button>
        <button class="settings-tab" role="tab" aria-selected="false" data-tab="tab-account">
          Account
        </button>
      </div>

      <div class="settings-panel" id="tab-billing" data-active="true">
        {/* ADR 0042: usage meters only. The previous plan-tiles + invoices
            block was removed alongside the billing-engine deferral. The
            customer.plan column still drives the *limits* the meters
            render against (the limit is a real product constraint
            enforced at write time), but no plan-change UX or invoice
            history is exposed. */}
        <div class="meters">
          <div class="mtr">
            <div class="k">
              <span>Sites</span>
              <span>{String(siteCount)} / {siteLimitLabel}</span>
            </div>
            <div class="bar">
              <i class={sitesTone} style={`width:${sitesFillPct}%`} />
            </div>
          </div>
          <div class="mtr">
            <div class="k">
              <span>Storage</span>
              <span>{formatBytes(storageBytes)} / {storageLimitLabel}</span>
            </div>
            <div class="bar">
              <i class={storageTone} style={`width:${storageFillPct}%`} />
            </div>
          </div>
        </div>
      </div>

      <div class="settings-panel" id="tab-notifications" data-active="false">
        <div class="card acc-card">
          <h2>Email notifications</h2>
          <p class="ch-sub">
            Per-event email preferences aren't wired up in this build. You'll receive
            transactional account emails (sign-in, publish receipts) regardless; everything
            else lands here once the notifications service ships.
          </p>
        </div>
      </div>

      <div class="settings-panel" id="tab-account" data-active="false">
        <div class="card acc-card">
          <h2>Account</h2>
          <p class="ch-sub">Manage your Open Canvas identity. Profile details live on a dedicated page.</p>
          <div class="acc-user-row">
            <div class="ava-small">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" width="48" height="48" />
              ) : (
                initial
              )}
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
            onclick="__rev01Modal.alert('Account deletion is not available in the demo.', 'Not available')"
          >
            Delete account
          </button>
        </div>
      </div>

      {tabScript}
    </DashboardShell>,
  );
});

export default settingsRoute;
