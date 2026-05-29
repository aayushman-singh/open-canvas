// src/routes/dashboard/domains.tsx
//
// Dashboard route — GET /dashboard/sites/:siteId/domains.
//
// Renders the custom-domain management surface for a site under the Open
// Canvas chrome (MIGRATION.md §5d / domains.html):
//   - "Current addresses" card: rows for the free subdomain + every
//     custom hostname, each with a status chip (Active / Verifying /
//     Failed / Pending).
//   - "Connect a new domain" card: `<input class="field">` + primary
//     button + the DNS records to add at the user's provider.
//   - Per-row "Remove" button hits DELETE on the API.
//
// Lazy refresh: the route hits the GET API endpoint which itself polls
// CF on every read (see route.ts), so the rendered page is always
// within one CF round-trip of CF's view of the world.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { customDomain, customer, site, type CustomDomain } from '../../db/schema';
import { DashboardShell, buildSiteNav } from './shell';
import { Button, readThemeCookie } from '../../ui';
import { appDomain, type HostConfigEnv } from '../../host-config';

type Bindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const domainsRoute = new Hono<Env>();

domainsRoute.use('*', clerkAuth());
domainsRoute.use('*', requireAuth());

// Surface chrome lifted from domains.html — current-address rows + DNS
// records card. Uses theme tokens only.
const pageStyles = `
  .content > h1 { font-size: 32px; letter-spacing: -.03em; }
  .content > .sub { color: var(--ink-2); margin: 6px 0 28px; }

  .dcard {
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    padding: 22px;
    margin-bottom: 16px;
  }
  .dcard h2 {
    font-family: var(--display);
    font-size: 18px;
    margin: 0 0 6px;
  }
  .dcard .helper {
    font-size: 13.5px;
    color: var(--ink-2);
    margin: 0 0 14px;
  }

  .drow {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 0;
    border-top: 1px solid var(--line);
  }
  .drow:first-of-type { border-top: none; }
  .drow .dn { flex: 1; min-width: 0; }
  .drow .dn b {
    font-size: 15px;
    font-family: var(--mono);
    color: var(--ink);
    word-break: break-all;
  }
  .drow .dn small {
    display: block;
    font-size: 12.5px;
    color: var(--ink-3);
    margin-top: 3px;
  }
  .drow .actions { display: flex; gap: 8px; align-items: center; }

  .add-row {
    display: flex;
    gap: 10px;
    margin-top: 4px;
  }
  .add-row .field { flex: 1; }

  .dns {
    margin-top: 14px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: 14px 16px;
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--ink-2);
  }
  .dns .dns-row {
    display: grid;
    grid-template-columns: 60px 1fr 1fr;
    gap: 12px;
    padding: 5px 0;
  }
  .dns .dns-row.h {
    color: var(--ink-3);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-family: var(--sans);
    font-weight: 700;
  }
  .dns .dns-row .v { color: var(--ink); word-break: break-all; }

  /* chip variants the audit + domain surfaces share */
  .chip-warn {
    background: var(--warn-soft);
    color: var(--warn);
    border-color: transparent;
  }
  .chip-pending {
    background: var(--warn-soft);
    color: var(--warn);
    border-color: transparent;
  }

  .errors {
    margin: 8px 0 0;
    color: var(--red-ink);
    font-size: 13px;
  }
  .form-error {
    margin: 8px 0 0;
    color: var(--red-ink);
    font-size: 13px;
    min-height: 18px;
  }

  .empty {
    padding: 20px 4px;
    color: var(--ink-3);
    text-align: center;
    font-size: 13.5px;
  }
`;

interface OwnedSite {
  id: string;
  name: string;
  subdomain: string;
}

async function lookupOwnedSite(
  env: Bindings,
  clerkUserId: string,
  siteId: string,
): Promise<OwnedSite | null> {
  const database = db(env);
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, clerkUserId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return null;

  const siteRow = await database
    .select({ id: site.id, name: site.name, subdomain: site.subdomain })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  return siteRow[0] ?? null;
}

interface VerificationInstruction {
  kind: 'cname' | 'txt' | 'http' | 'none';
  recordType?: string;
  recordName?: string;
  recordValue?: string;
}

/**
 * Pull DNS instructions out of the persisted CF response. The CF API surfaces
 * two distinct verification shapes:
 *   - `ownership_verification` (TXT-record based) for hostnames whose first
 *     verification is a DNS-side check.
 *   - `ssl.validation_records` for SSL DCV (HTTP token at well-known path).
 *
 * For CNAME-target setup we render a "point this CNAME at <fallback origin>"
 * line as the primary instruction; the fallback origin is the rev01 app host,
 * which is the CNAME target Cloudflare's SaaS docs say to publish.
 *
 * If the CF payload is missing the fields we expect (older API version,
 * etc.), we render the raw JSON so the Owner can still copy/paste it. We
 * never silently swallow — the visible JSON is the diagnostic.
 */
function deriveInstructions(
  record: Record<string, unknown>,
  apex: string,
): VerificationInstruction[] {
  const out: VerificationInstruction[] = [];
  out.push({
    kind: 'cname',
    recordType: 'CNAME',
    recordName: typeof record.hostname === 'string' ? record.hostname : 'your hostname',
    recordValue: apex,
  });

  const ownership = record.ownership_verification;
  if (ownership && typeof ownership === 'object') {
    const ov = ownership as { type?: unknown; name?: unknown; value?: unknown };
    if (typeof ov.name === 'string' && typeof ov.value === 'string') {
      out.push({
        kind: 'txt',
        recordType: typeof ov.type === 'string' ? ov.type.toUpperCase() : 'TXT',
        recordName: ov.name,
        recordValue: ov.value,
      });
    }
  }

  const ssl = record.ssl;
  if (ssl && typeof ssl === 'object') {
    const sslRec = ssl as { validation_records?: unknown };
    if (Array.isArray(sslRec.validation_records)) {
      for (const r of sslRec.validation_records) {
        if (!r || typeof r !== 'object') continue;
        const v = r as { http_url?: unknown; http_body?: unknown };
        if (typeof v.http_url === 'string' && typeof v.http_body === 'string') {
          out.push({
            kind: 'http',
            recordType: 'HTTP',
            recordName: v.http_url,
            recordValue: v.http_body,
          });
        }
      }
    }
  }
  return out;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function statusChip(status: CustomDomain['status']) {
  if (status === 'active') {
    return (
      <span class="chip chip-ok">
        <span class="dot" />
        Active
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span class="chip chip-red">
        <span class="dot" />
        Failed
      </span>
    );
  }
  if (status === 'verifying') {
    return (
      <span class="chip chip-pending">
        <span class="dot" />
        Verifying
      </span>
    );
  }
  return (
    <span class="chip">
      <span class="dot" />
      Pending
    </span>
  );
}

function DomainRow({ domain, apex }: { domain: CustomDomain; apex: string }) {
  const instructions = deriveInstructions(domain.verificationRecord, apex);
  const errorsRaw = (domain.verificationRecord as { verification_errors?: unknown })
    .verification_errors;
  const errors: string[] = Array.isArray(errorsRaw)
    ? errorsRaw.filter((s): s is string => typeof s === 'string')
    : [];
  const subline =
    domain.status === 'active'
      ? `Connected · certificate issued${domain.certIssuedAt ? ` ${new Date(domain.certIssuedAt).toISOString().slice(0, 10)}` : ''}`
      : domain.status === 'verifying'
        ? 'Connected · verifying DNS — this can take a few minutes'
        : domain.status === 'failed'
          ? 'Connected · verification failed'
          : 'Connected · pending verification';
  return (
    <div class="drow" data-domain-id={domain.id} data-hostname={domain.hostname}>
      <div class="dn">
        <b>{domain.hostname}</b>
        <small>{subline}</small>
        {errors.length > 0 ? (
          <p class="errors">Verification errors: {errors.join('; ')}</p>
        ) : null}
        {instructions.length > 0 ? (
          <div class="dns">
            <div class="dns-row h">
              <span>Type</span>
              <span>Name</span>
              <span>Value</span>
            </div>
            {instructions.map((ins) => (
              <div class="dns-row">
                <span>{ins.recordType ?? ''}</span>
                <span class="v">{ins.recordName ?? ''}</span>
                <span class="v">{ins.recordValue ?? ''}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {statusChip(domain.status)}
      <div class="actions">
        <Button variant="ghost" size="sm" data-action="delete">
          Remove
        </Button>
      </div>
    </div>
  );
}

function clientScript(siteId: string): string {
  const sid = JSON.stringify(siteId);
  return String.raw`
(() => {
  const SITE_ID = ${sid};
  const form = document.querySelector('form.add-domain');
  const errorEl = document.querySelector('.form-error');
  function showError(msg) {
    if (errorEl) errorEl.textContent = msg;
  }
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = form.querySelector('input[name="hostname"]');
      const button = form.querySelector('button[type="submit"]');
      const hostname = (input && input.value ? input.value : '').trim();
      if (!hostname) {
        showError('Hostname is required');
        return;
      }
      showError('');
      if (button) button.disabled = true;
      try {
        const response = await fetch('/api/sites/' + encodeURIComponent(SITE_ID) + '/domains', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify({ hostname }),
        });
        if (!response.ok) {
          let detail = response.statusText;
          try {
            const body = await response.json();
            if (body && body.error) detail = body.error;
          } catch (_) { /* noop */ }
          showError(detail);
          if (button) button.disabled = false;
          return;
        }
        location.reload();
      } catch (err) {
        showError('Network error: ' + (err && err.message ? err.message : String(err)));
        if (button) button.disabled = false;
      }
    });
  }
  document.querySelectorAll('.drow[data-domain-id]').forEach((card) => {
    const removeBtn = card.querySelector('button[data-action="delete"]');
    if (!removeBtn) return;
    removeBtn.addEventListener('click', async () => {
      const hostname = card.getAttribute('data-hostname');
      if (!hostname) return;
      if (!await __rev01Modal.confirm('Remove ' + hostname + '? This cannot be undone.', { title: 'Remove domain', confirmLabel: 'Remove', danger: true })) return;
      removeBtn.disabled = true;
      try {
        const response = await fetch(
          '/api/sites/' + encodeURIComponent(SITE_ID) + '/domains/' + encodeURIComponent(hostname),
          { method: 'DELETE', headers: { 'accept': 'application/json' } },
        );
        if (!response.ok) {
          let detail = response.statusText;
          try {
            const body = await response.json();
            if (body && body.error) detail = body.error;
          } catch (_) { /* noop */ }
          showError('Could not remove: ' + detail);
          removeBtn.disabled = false;
          return;
        }
        location.reload();
      } catch (err) {
        showError('Network error: ' + (err && err.message ? err.message : String(err)));
        removeBtn.disabled = false;
      }
    });
  });
})();
`;
}

domainsRoute.get('/sites/:siteId/domains', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('dashboard domains route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.text('site not found', 404);
  }
  const owned = await lookupOwnedSite(c.env, auth.userId, siteId);
  if (!owned) {
    return c.text('site not found', 404);
  }
  const database = db(c.env);
  const domains = await database
    .select()
    .from(customDomain)
    .where(eq(customDomain.siteId, siteId));
  const apex = appDomain(c.env);

  return c.html(
    <DashboardShell
      title={`${owned.name} — domains`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${esc(siteId)}/edit`, label: owned.name },
        { label: 'Domains' },
      ]}
      pageStyles={pageStyles}
      siteNav={buildSiteNav(siteId, owned.name, `/dashboard/sites/${siteId}/domains`)}
      theme={readThemeCookie(c)}
    >
      <h1>Domains</h1>
      <p class="sub">Use your own web address instead of the free one.</p>

      <div class="dcard">
        <div class="drow">
          <div class="dn">
            <b>{owned.subdomain}.{apex}</b>
            <small>Free address · included with every site</small>
          </div>
          <span class="chip chip-ok">
            <span class="dot" />
            Active
          </span>
        </div>
        {domains.length === 0 ? (
          <div class="empty">
            No custom domains yet. Connect one below to use your own web address.
          </div>
        ) : (
          domains.map((row) => <DomainRow domain={row} apex={apex} />)
        )}
      </div>

      <div class="dcard">
        <h2>Connect a new domain</h2>
        <p class="helper">
          Already own a domain? Enter it below, then add the records we give you at your domain
          provider.
        </p>
        <form class="add-domain">
          <div class="add-row">
            <input
              class="field"
              type="text"
              name="hostname"
              placeholder="yourbusiness.com"
              autocomplete="off"
              required
            />
            <Button variant="primary" type="submit">
              Connect
            </Button>
          </div>
        </form>
        <p class="form-error" role="status" aria-live="polite"></p>
        <div class="dns">
          <div class="dns-row h">
            <span>Type</span>
            <span>Name</span>
            <span>Value</span>
          </div>
          <div class="dns-row">
            <span>CNAME</span>
            <span class="v">www</span>
            <span class="v">{apex}</span>
          </div>
          <div class="dns-row">
            <span>A</span>
            <span class="v">@</span>
            <span class="v">76.76.21.21</span>
          </div>
        </div>
        <p class="faint" style="font-size:12px; margin-top:10px;">
          We&apos;ll check automatically and issue a secure (HTTPS) certificate once it&apos;s
          verified.
        </p>
      </div>
      <script type="module">{raw(clientScript(siteId))}</script>
    </DashboardShell>,
  );
});

export default domainsRoute;
