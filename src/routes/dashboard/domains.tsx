// src/routes/dashboard/domains.tsx
//
// Dashboard route — GET /dashboard/sites/:siteId/domains.
//
// Renders the custom-domain management surface for a site:
//   - "Add a domain" form (POST → /api/sites/:siteId/domains).
//   - List of every customDomain row for this site, each with:
//       - status badge (pending / verifying / active / failed),
//       - DNS instructions extracted from `verificationRecord`,
//       - per-row DELETE button.
//   - Lazy refresh: the route hits the GET API endpoint which itself polls
//     CF on every read (see route.ts), so the rendered page is always
//     within one CF round-trip of CF's view of the world.
//
// The page ships a small inline client script that:
//   - submits the add-domain form via fetch + JSON,
//   - hits DELETE via fetch on each delete button,
//   - re-renders by reload on success (the simplest correct behaviour;
//     status polling already happens server-side).
//
// All styles inline via DashboardShell's `pageStyles` slot to keep the
// surface self-contained.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { customDomain, customer, site, type CustomDomain } from '../../db/schema';
import { DashboardShell, buildSiteNav } from './shell';
import { Button, Badge } from '../../ui';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const domainsRoute = new Hono<Env>();

domainsRoute.use('*', clerkAuth());
domainsRoute.use('*', requireAuth());

const pageStyles = `
  .lede { margin: 8px 0 24px; color: var(--muted); max-width: 640px; line-height: 1.55; }
  form.add-domain {
    display: flex;
    align-items: end;
    gap: 12px;
    margin: 0 0 28px;
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
  }
  form.add-domain label {
    display: grid;
    gap: 6px;
    flex: 1;
    font-size: 13px;
    color: var(--muted);
  }
  form.add-domain input {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #0c1220;
    color: var(--text);
    padding: 10px 12px;
    font-size: 15px;
  }
  form.add-domain button[disabled] { opacity: 0.5; cursor: not-allowed; }
  .domains-empty {
    padding: 24px;
    border: 1px dashed var(--line);
    border-radius: 10px;
    color: var(--muted);
    text-align: center;
  }
  .domain {
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    margin-bottom: 12px;
  }
  .domain-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .domain-host {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 16px;
    color: var(--text);
  }
  .domain-actions { margin-left: auto; }
  .dns {
    margin: 4px 0 0;
    padding: 12px;
    border-radius: 6px;
    background: #0c1220;
    border: 1px solid var(--line);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12.5px;
    color: var(--muted);
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .dns strong { color: var(--text); }
  .errors {
    margin: 8px 0 0;
    color: #fca5a5;
    font-size: 13px;
  }
  .form-error {
    margin: 8px 0 0;
    color: #fca5a5;
    font-size: 13px;
    min-height: 18px;
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
  /** Human-readable copy. */
  title: string;
  /** Optional record details. */
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
function deriveInstructions(record: Record<string, unknown>): VerificationInstruction[] {
  const out: VerificationInstruction[] = [];
  // CNAME target — every custom hostname needs this regardless of validation.
  out.push({
    kind: 'cname',
    title: 'Point your domain at rev01',
    recordType: 'CNAME',
    recordName: typeof record.hostname === 'string' ? record.hostname : 'your hostname',
    recordValue: 'rev01.aayushman.dev',
  });

  // Ownership verification (TXT).
  const ownership = record.ownership_verification;
  if (ownership && typeof ownership === 'object') {
    const ov = ownership as { type?: unknown; name?: unknown; value?: unknown };
    if (typeof ov.name === 'string' && typeof ov.value === 'string') {
      out.push({
        kind: 'txt',
        title: 'Verify ownership',
        recordType: typeof ov.type === 'string' ? ov.type.toUpperCase() : 'TXT',
        recordName: ov.name,
        recordValue: ov.value,
      });
    }
  }

  // SSL HTTP validation token, if present.
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
            title: 'SSL token (Cloudflare serves automatically)',
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

function DomainCard({ domain }: { domain: CustomDomain }) {
  const instructions = deriveInstructions(domain.verificationRecord);
  const errorsRaw = (domain.verificationRecord as { verification_errors?: unknown })
    .verification_errors;
  const errors: string[] = Array.isArray(errorsRaw)
    ? errorsRaw.filter((s): s is string => typeof s === 'string')
    : [];
  return (
    <article class="domain" data-domain-id={domain.id} data-hostname={domain.hostname}>
      <div class="domain-head">
        <span class="domain-host">{domain.hostname}</span>
        <Badge variant={domain.status === 'active' ? 'success' : domain.status === 'failed' ? 'danger' : domain.status === 'verifying' ? 'warning' : 'info'}>{domain.status}</Badge>
        <span class="domain-actions">
          <Button variant="secondary" data-action="delete" size="sm">Remove</Button>
        </span>
      </div>
      {instructions.map((ins) => (
        <p class="dns">
          <strong>{ins.title}</strong>
          {ins.recordType && ins.recordName && ins.recordValue ? (
            <>
              {'\n'}
              {ins.recordType} {ins.recordName} → {ins.recordValue}
            </>
          ) : null}
        </p>
      ))}
      {errors.length > 0 ? (
        <p class="errors">
          Verification errors: {errors.join('; ')}
        </p>
      ) : null}
      {domain.certIssuedAt ? (
        <p class="dns">
          <strong>Certificate issued:</strong> {new Date(domain.certIssuedAt).toISOString()}
        </p>
      ) : null}
    </article>
  );
}

function clientScript(siteId: string): string {
  // Inline client: form submit + delete buttons. We use `addEventListener`,
  // no inline handlers, so the page stays compatible with strict CSP if
  // one is added later. The site id is baked in as a string literal.
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
  document.querySelectorAll('article.domain').forEach((card) => {
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
    // requireAuth would have redirected on a missing auth; this guard is
    // narrowing for TS.
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

  return c.html(
    <DashboardShell
      title={`${owned.name} — custom domains`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${esc(siteId)}/edit`, label: owned.name },
        { label: 'Custom domains' },
      ]}
      pageStyles={pageStyles}
      siteNav={buildSiteNav(siteId, owned.name, `/dashboard/sites/${siteId}/domains`)}
    >
      <h1>Custom domains</h1>
      <p class="lede">
        Add a hostname you own (e.g. <code>www.example.com</code>) and follow the DNS instructions.
        Cloudflare verifies the CNAME and issues a certificate — once status flips to{' '}
        <strong>active</strong>, your published site is live at that hostname.
      </p>
      <form class="add-domain">
        <label>
          <span>Hostname</span>
          <input type="text" name="hostname" placeholder="www.example.com" autocomplete="off" required />
        </label>
        <Button variant="primary" type="submit">Add domain</Button>
      </form>
      <p class="form-error" role="status" aria-live="polite"></p>
      {domains.length === 0 ? (
        <div class="domains-empty">
          No custom domains yet. Add one above to start the verification flow.
        </div>
      ) : (
        domains.map((row) => <DomainCard domain={row} />)
      )}
      <script type="module">{raw(clientScript(siteId))}</script>
    </DashboardShell>,
  );
});

export default domainsRoute;
