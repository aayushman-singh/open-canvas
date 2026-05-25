// src/routes/dashboard/addon-shop.tsx

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { customer, addonEntitlement } from '../../db/schema';
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
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
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
    margin-top: auto;
    padding-top: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
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
  .btn-owned {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    font-family: inherit;
    background: rgba(74,222,128,0.12);
    color: #4ade80;
    cursor: default;
  }
`;

function clientScript(): string {
  return String.raw`
(function() {
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
    .catch(function(err) {
      btn.textContent = 'Failed — retry';
      btn.disabled = false;
    });
  });
})();
`;
}

addonShopRoute.get('/shop', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('shop reached without authenticated user');

  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;

  let ownedAddonIds = new Set<string>();
  if (customerId) {
    const rows = await database
      .select({ addonId: addonEntitlement.addonId })
      .from(addonEntitlement)
      .where(eq(addonEntitlement.customerId, customerId));
    ownedAddonIds = new Set(rows.map((r) => r.addonId));
  }

  return c.html(
    <DashboardShell
      title="rev01 — addon shop"
      crumbs={[{ href: '/dashboard', label: 'Dashboard' }, { label: 'Shop' }]}
      activePath="/dashboard/shop"
      pageStyles={pageStyles}
    >
      <h1>Addon Shop</h1>
      <p class="shop-lede">
        Extend your sites with powerful integrations. Purchase once, enable on any of your sites.
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
              <div class="addon-card-footer">
                <span class="addon-price">Free</span>
                {owned ? (
                  <span class="btn-owned">Acquired</span>
                ) : (
                  <button type="button" class="btn-acquire" data-acquire={addon.id}>
                    Get addon
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <script>{raw(clientScript())}</script>
    </DashboardShell>,
  );
});

export default addonShopRoute;
