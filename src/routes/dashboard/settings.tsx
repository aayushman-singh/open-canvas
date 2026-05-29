import { Hono } from 'hono';
import { raw } from 'hono/html';
import { eq, count, sum } from 'drizzle-orm';
import {
  billingPlanInvoiceAmount,
  billingPlanLabel,
  siteLimitForPlan,
  storageLimitForPlan,
} from '../../billing/plan-limits';
import { db } from '../../db/client';
import { customer, site, ownerAsset, type BillingPlan } from '../../db/schema';
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

// MIGRATION.md §5e — settings.tsx is account/billing (NOT site-settings).
// Layout matches account.html's Billing pane: 820px column, the current
// plan summary card, three usage meters (`.mtr`), three plan cards
// (`.plan`/.plan.feat for the highlighted upgrade slot) and the invoice
// list (`.inv`). The Notifications + Account tabs reuse the same `.tabs`
// affordance from account.html so all three are visible under one header.
//
// DOM hooks preserved through the restyle: `.settings-tab` /
// `.settings-panel` / `data-tab` / `data-active` / `data-plan-card`
// remain the IDs the inline tab-switch script reads, and the
// `tab-billing` / `tab-notifications` / `tab-account` panel IDs stay
// stable so deep-links keep working.
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
  .plan-now {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 22px 24px;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    margin-bottom: 18px;
  }
  .plan-now .pn { flex: 1; min-width: 0; }
  .plan-now .pn b {
    font-family: var(--display);
    font-size: 20px;
    color: var(--ink);
  }
  .plan-now .pn small {
    display: block;
    color: var(--ink-2);
    font-size: 13.5px;
    margin-top: 3px;
    line-height: 1.45;
  }

  /* usage meters (.mtr) */
  .meters {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
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

  /* plan tier cards (.plan) */
  .plans {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    margin-bottom: 24px;
  }
  .plan {
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    padding: 22px;
    position: relative;
    box-shadow: var(--shadow-sm);
  }
  .plan.feat {
    border-color: var(--red);
    box-shadow: var(--shadow);
  }
  .plan .tag {
    position: absolute;
    top: -10px;
    left: 22px;
  }
  .plan h3 {
    font-family: var(--display);
    font-size: 18px;
    margin: 0 0 8px;
    color: var(--ink);
  }
  .plan .price {
    font-family: var(--display);
    font-weight: 700;
    font-size: 32px;
    margin: 8px 0 2px;
    color: var(--ink);
    line-height: 1;
  }
  .plan .price small {
    font-size: 14px;
    color: var(--ink-3);
    font-weight: 500;
    font-family: var(--sans);
    margin-left: 2px;
  }
  .plan ul {
    list-style: none;
    padding: 0;
    margin: 14px 0 18px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .plan li {
    font-size: 13.5px;
    color: var(--ink-2);
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .plan li svg { color: var(--ok); flex-shrink: 0; margin-top: 2px; }

  /* invoice list (.inv) */
  .inv-heading {
    font-family: var(--display);
    font-size: 18px;
    font-weight: 700;
    margin: 18px 0 12px;
    color: var(--ink);
  }
  .invoices {
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
  }
  .inv {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 20px;
    border-top: 1px solid var(--line);
    font-size: 13.5px;
    color: var(--ink-2);
  }
  .inv:first-child { border-top: none; }
  .inv .sp { flex: 1; }
  .inv .muted { color: var(--ink-3); }
  .inv a {
    color: var(--red-ink);
    font-weight: 650;
    text-decoration: none;
    border-bottom: 1px solid transparent;
    padding-bottom: 1px;
  }
  .inv a:hover { border-bottom-color: currentColor; }

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
    .meters, .plans { grid-template-columns: 1fr; }
    .plan-now { flex-direction: column; align-items: flex-start; gap: 14px; }
    .plan-now .btn { width: 100%; justify-content: center; }
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

// Inline SVG used in plan-feature rows. Kept in JSX (not Wordmark / not
// brand) because it's pure ornamentation specific to the plan cards.
function CheckIcon() {
  return raw(
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`,
  );
}

const PLANS: Array<{
  id: BillingPlan;
  name: string;
  price: string;
  period: string;
  features: string[];
  highlight?: boolean;
}> = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '/mo',
    features: ['3 sites', 'Community templates', 'Open Canvas address', '100 MB storage'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$19',
    period: '/mo',
    features: ['Unlimited sites', 'Custom domains', 'Remove branding', '10 GB storage'],
    highlight: true,
  },
  {
    id: 'team',
    name: 'Team',
    price: '$49',
    period: '/mo',
    features: ['Everything in Pro', '5 team seats', 'Shared asset library', 'Priority support', '50 GB storage'],
  },
];

const INVOICES = [
  { date: 'May 2026' },
  { date: 'April 2026' },
  { date: 'March 2026' },
];

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
  const customerPlan = customerRecord?.plan ?? 'free';
  const currentPlan = PLANS.find((p) => p.id === customerPlan) ?? PLANS[0]!;

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
  const planName = billingPlanLabel(customerPlan);
  const currentInvoiceAmount = billingPlanInvoiceAmount(customerPlan);
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
      <h1>Plan &amp; billing</h1>
      <p class="sub">Track usage on the current billing cycle, change plans, and download invoices.</p>

      <div class="settings-tabs" role="tablist">
        <button class="settings-tab" role="tab" aria-selected="true" data-tab="tab-billing">
          Plan &amp; billing
        </button>
        <button class="settings-tab" role="tab" aria-selected="false" data-tab="tab-notifications">
          Notifications
        </button>
        <button class="settings-tab" role="tab" aria-selected="false" data-tab="tab-account">
          Account
        </button>
      </div>

      <div class="settings-panel" id="tab-billing" data-active="true">
        <div class="plan-now">
          <div class="pn">
            <b>{currentPlan.name} plan</b>
            <small>
              {customerPlan === 'team'
                ? "You're on the top tier — every Open Canvas feature is unlocked."
                : customerPlan === 'pro'
                  ? 'Unlimited sites and custom domains. Cancel or downgrade anytime.'
                  : "You're on the house plan — upgrade anytime for more sites and storage."}
            </small>
          </div>
          {customerPlan === 'team' ? null : (
            <Button variant="primary" disabled>
              {customerPlan === 'pro' ? 'Upgrade to Team' : 'Upgrade to Pro'}
            </Button>
          )}
        </div>

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
          <div class="mtr">
            <div class="k">
              <span>Build minutes</span>
              <span>— / {planName === 'Free' ? '60' : 'unlimited'}</span>
            </div>
            <div class="bar">
              <i class="ok" style="width:0%" />
            </div>
          </div>
        </div>

        <div class="plans">
          {PLANS.map((plan) => {
            const isCurrent = plan.id === customerPlan;
            const isFeat = plan.highlight && !isCurrent;
            return (
              <div class={`plan${isFeat ? ' feat' : ''}`} data-plan-card={plan.id}>
                {isFeat && <span class="tag chip chip-red">Most popular</span>}
                <h3>{plan.name}</h3>
                <div class="price">{plan.price}<small>{plan.period}</small></div>
                <ul>
                  {plan.features.map((f) => (
                    <li><CheckIcon />{f}</li>
                  ))}
                </ul>
                {isCurrent ? (
                  <Button variant="secondary" style="width:100%" disabled>
                    Current plan
                  </Button>
                ) : (
                  <Button variant={isFeat ? 'primary' : 'secondary'} style="width:100%" disabled>
                    {plan.id === 'team' ? 'Choose Team' : `Upgrade to ${plan.name}`}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <h2 class="inv-heading">Invoices</h2>
        <div class="invoices">
          {INVOICES.map((inv) => (
            <div class="inv">
              <span>{inv.date}</span>
              <span class="sp" />
              <span class="muted">{currentInvoiceAmount} · {currentPlan.name}</span>
              <a href="#" onclick="event.preventDefault();window.__rev01Modal.alert('Invoice PDFs ship with billing v1.', 'Coming soon')">PDF</a>
            </div>
          ))}
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
