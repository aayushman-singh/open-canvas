import { Hono } from 'hono';
import { raw } from 'hono/html';
import { eq, sql, count, sum } from 'drizzle-orm';
import {
  billingPlanInvoiceAmount,
  billingPlanLabel,
  siteLimitForPlan,
  storageLimitForPlan,
} from '../../billing/plan-limits';
import { db } from '../../db/client';
import { customer, site, ownerAsset, type BillingPlan } from '../../db/schema';
import { entitlementsFor, isUnlimited, PLAN_DISPLAY_NAMES } from '../../billing/plans';
import { clerkAuth } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { DashboardShell } from './shell';
import { Button, Badge } from '../../ui';

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

const settingsStyles = `
  .settings-tabs {
    display: flex;
    gap: 2px;
    margin-bottom: 28px;
    border-bottom: 1px solid var(--line);
    padding-bottom: 0;
  }
  .settings-tab {
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 500;
    color: var(--muted);
    text-decoration: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: color 0.12s, border-color 0.12s;
    cursor: pointer;
    background: none;
    border-top: none;
    border-left: none;
    border-right: none;
    font-family: inherit;
  }
  .settings-tab:hover { color: var(--text); }
  .settings-tab[aria-selected="true"] {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .settings-panel { display: none; }
  .settings-panel[data-active="true"] { display: block; }

  .settings-section {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 24px 28px;
    margin-bottom: 20px;
  }
  .settings-section h3 {
    margin: 0 0 4px;
    font-size: 17px;
    font-weight: 600;
  }
  .settings-section .desc {
    font-size: 13px;
    color: var(--faint);
    margin: 0 0 20px;
  }

  .plan-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-bottom: 20px;
  }
  .plan-card {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 20px;
    position: relative;
  }
  .plan-card--current { border-color: var(--accent); }
  .plan-card--current::before {
    content: 'Current plan';
    position: absolute;
    top: -10px;
    left: 16px;
    background: var(--accent);
    color: var(--bg);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 2px 10px;
    border-radius: 4px;
  }
  .plan-name {
    font-size: 18px;
    font-weight: 700;
    margin: 0 0 4px;
  }
  .plan-price {
    font-size: 28px;
    font-weight: 700;
    color: var(--text);
    margin: 8px 0;
  }
  .plan-price .period {
    font-size: 14px;
    font-weight: 400;
    color: var(--faint);
  }
  .plan-features {
    list-style: none;
    padding: 0;
    margin: 16px 0 0;
    font-size: 13px;
    color: var(--muted);
  }
  .plan-features li {
    padding: 4px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .plan-features li::before {
    content: '\\2713';
    color: #4ade80;
    font-weight: 700;
    font-size: 12px;
    flex-shrink: 0;
  }

  .usage-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  .usage-card {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 18px 20px;
  }
  .usage-card .label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--faint);
    margin-bottom: 6px;
  }
  .usage-card .value {
    font-size: 24px;
    font-weight: 700;
    color: var(--text);
  }
  .usage-card .of {
    font-size: 13px;
    color: var(--faint);
    margin-top: 4px;
  }
  .usage-bar {
    height: 4px;
    background: rgba(255,255,255,0.08);
    border-radius: 2px;
    margin-top: 10px;
    overflow: hidden;
  }
  .usage-bar-fill {
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: width 0.3s;
  }

  .invoice-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .invoice-table th {
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--faint);
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .invoice-table td {
    padding: 10px 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    color: var(--muted);
  }
  .invoice-table td:last-child { text-align: right; }

  .notif-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .notif-row:last-child { border-bottom: none; }
  .notif-info h4 { margin: 0; font-size: 14px; font-weight: 500; }
  .notif-info p { margin: 2px 0 0; font-size: 12px; color: var(--faint); }
  .toggle {
    position: relative;
    width: 42px;
    height: 24px;
    flex-shrink: 0;
  }
  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }
  .toggle-track {
    position: absolute;
    inset: 0;
    background: rgba(255,255,255,0.1);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .toggle-track::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--muted);
    transition: transform 0.15s, background 0.15s;
  }
  .toggle input:checked + .toggle-track {
    background: rgba(125,211,252,0.25);
  }
  .toggle input:checked + .toggle-track::after {
    transform: translateX(18px);
    background: var(--accent);
  }

  .danger-zone {
    border-color: rgba(239,68,68,0.3);
  }
  .danger-zone h3 { color: #ef4444; }
  .btn-danger {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    background: rgba(239,68,68,0.10);
    color: #ef4444;
    border: 1px solid rgba(239,68,68,0.22);
    cursor: pointer;
    font-family: inherit;
  }
  .btn-danger:hover { background: rgba(239,68,68,0.18); }

  @media (max-width: 768px) {
    .plan-grid,
    .usage-grid {
      grid-template-columns: 1fr;
    }
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

const PLANS: Array<{
  id: BillingPlan;
  name: string;
  price: string;
  period: string;
  features: string[];
}> = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '/mo',
    features: ['3 sites', 'Community templates', 'rev01 subdomain', '100 MB storage'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$19',
    period: '/mo',
    features: ['Unlimited sites', 'Custom domains', 'Remove branding', '10 GB storage'],
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
  { date: 'May 2026', description: 'Free plan', amount: '$0.00', status: 'Paid' },
  { date: 'Apr 2026', description: 'Free plan', amount: '$0.00', status: 'Paid' },
  { date: 'Mar 2026', description: 'Free plan', amount: '$0.00', status: 'Paid' },
];

settingsRoute.get('/settings', async (c) => {
  const user = c.get('user');
  if (!user) {
    throw new Error('settings page reached without a resolved user');
  }

  const primaryEmail =
    user.emailAddresses.find((addr) => addr.id === user.primaryEmailAddressId)?.emailAddress ?? '';

  const database = db(c.env);

  await database
    .insert(customer)
    .values({ clerkUserId: user.id, email: primaryEmail })
    .onConflictDoUpdate({
      target: customer.clerkUserId,
      set: { email: primaryEmail, updatedAt: sql`now()` },
    });

  const customerRow = await database
    .select({ id: customer.id, displayName: customer.displayName, plan: customer.plan })
    .from(customer)
    .where(eq(customer.clerkUserId, user.id))
    .limit(1);
  const customerId = customerRow[0]?.id;
  const currentPlanId: BillingPlan = customerRow[0]?.plan ?? 'free';
  const currentPlan = PLANS.find((p) => p.id === currentPlanId) ?? PLANS[0]!;

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

  const entitlements = entitlementsFor(currentPlanId);
  const siteLimitLabel = isUnlimited(entitlements.siteLimit) ? 'Unlimited' : String(entitlements.siteLimit);
  const storageLimitLabel = isUnlimited(entitlements.storageBytes) ? 'Unlimited' : formatBytes(entitlements.storageBytes);
  const planName = PLAN_DISPLAY_NAMES[currentPlanId];
  const sitesFillPct = isUnlimited(entitlements.siteLimit) ? 0 : Math.min(100, (siteCount / entitlements.siteLimit) * 100);
  const storageFillPct = isUnlimited(entitlements.storageBytes) ? 0 : Math.min(100, (storageBytes / entitlements.storageBytes) * 100);

  const avatarUrl = user.imageUrl;
  const displayName = customerRow[0]?.displayName ?? user.firstName ?? undefined;

  return c.html(
    <DashboardShell
      title="rev01 — settings"
      crumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Settings' }]}
      activePath="/dashboard/settings"
      pageStyles={settingsStyles}
      userMeta={{ avatarUrl, displayName, email: primaryEmail }}
    >
      <h1>Settings</h1>

      <div class="settings-tabs" role="tablist">
        <button class="settings-tab" role="tab" aria-selected="true" data-tab="tab-billing">
          Billing
        </button>
        <button class="settings-tab" role="tab" aria-selected="false" data-tab="tab-notifications">
          Notifications
        </button>
        <button class="settings-tab" role="tab" aria-selected="false" data-tab="tab-account">
          Account
        </button>
      </div>

      <div class="settings-panel" id="tab-billing" data-active="true">
        <div class="settings-section">
          <h3>Plan</h3>
          <p class="desc">You're on the {currentPlan.name} plan. {currentPlanId === 'team' ? 'You have access to every rev01 feature.' : 'Plan changes are coming soon — contact support to switch plans.'}</p>
          <div class="plan-grid">
            {PLANS.map((plan) => {
              const isCurrent = plan.id === currentPlanId;
              return (
                <div class={`plan-card${isCurrent ? ' plan-card--current' : ''}`} data-plan-card={plan.id}>
                  <p class="plan-name">{plan.name}</p>
                  <p class="plan-price">{plan.price}<span class="period">{plan.period}</span></p>
                  <ul class="plan-features">
                    {plan.features.map((f) => <li>{f}</li>)}
                  </ul>
                  <Button variant="secondary" style="margin-top:16px;width:100%" disabled>
                    {isCurrent ? 'Current plan' : 'Coming soon'}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <div class="settings-section">
          <h3>Usage</h3>
          <p class="desc">Current billing period: May 1 – May 31, 2026</p>
          <div class="usage-grid">
            <div class="usage-card">
              <div class="label">Sites</div>
              <div class="value">{String(siteCount)}</div>
              <div class="of">of {siteLimitLabel} on {planName}</div>
              <div class="usage-bar">
                <div class="usage-bar-fill" style={`width:${sitesFillPct}%`} />
              </div>
            </div>
            <div class="usage-card">
              <div class="label">Storage</div>
              <div class="value">{formatBytes(storageBytes)}</div>
              <div class="of">of {storageLimitLabel} on {planName}</div>
              <div class="usage-bar">
                <div class="usage-bar-fill" style={`width:${storageFillPct}%`} />
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Invoices</h3>
          <p class="desc">Download past invoices and receipts.</p>
          <table class="invoice-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Amount</th>
                <th style="text-align:right">Status</th>
              </tr>
            </thead>
            <tbody>
              {INVOICES.map((inv) => (
                <tr>
                  <td>{inv.date}</td>
                  <td>{currentPlanLabel} plan</td>
                  <td>{currentInvoiceAmount}</td>
                  <td>
                    <Badge variant="success">{inv.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div class="settings-panel" id="tab-notifications" data-active="false">
        <div class="settings-section">
          <h3>Email notifications</h3>
          <p class="desc">
            Per-event email preferences aren't wired up in this build. You'll receive
            transactional account emails (sign-in, publish receipts) regardless; everything
            else lands here once the notifications service ships.
          </p>
        </div>
      </div>

      <div class="settings-panel" id="tab-account" data-active="false">
        <div class="settings-section">
          <h3>Account</h3>
          <p class="desc">Manage your rev01 account.</p>
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                style="width:48px;height:48px;border-radius:50%;border:2px solid var(--line)"
              />
            ) : (
              <div style="width:48px;height:48px;border-radius:50%;background:rgba(125,211,252,0.12);display:flex;align-items:center;justify-content:center;color:var(--accent);font-weight:700;font-size:20px">
                {(displayName ?? primaryEmail ?? '?').charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div style="font-weight:600">{displayName ?? primaryEmail.split('@')[0]}</div>
              <div style="font-size:13px;color:var(--faint)">{primaryEmail}</div>
            </div>
            <Button variant="secondary" href="/dashboard/profile" style="margin-left:auto">
              Edit profile
            </Button>
          </div>
        </div>

        <div class="settings-section danger-zone">
          <h3>Danger zone</h3>
          <p class="desc">
            Permanently delete your account and all associated data. This cannot be undone.
          </p>
          <button
            class="btn-danger"
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
