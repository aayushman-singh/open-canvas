// src/routes/dashboard/a11y-report.tsx
//
// Wave 3 #15 — Owner-facing dashboard route.
//
//   GET /dashboard/sites/:siteId/a11y
//
// Renders the AuditReport for a site as a severity-grouped list. The Owner
// uses this BEFORE clicking Publish to see what would block them. Each
// blocking + warning item links back to the offending element by id (the
// editor surfaces a "find element by id" affordance — out of scope here).
//
// Auth: Clerk + customer→site join. Mirrors the forms-inbox route shape so
// drift between dashboard surfaces stays minimal.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { EditableSite } from '../../canvas/schema';
import { db } from '../../db/client';
import { customer, site } from '../../db/schema';
import { runAudit, type AuditIssue } from '../../a11y/audit';
import type { Severity } from '../../a11y/severity';

import { DashboardShell, buildSiteNav } from './shell';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const a11yReportRoute = new Hono<Env>();
a11yReportRoute.use('*', clerkAuth());
a11yReportRoute.use('*', requireAuth());

const pageStyles = `
  .lede { margin: 8px 0 24px; color: var(--muted); max-width: 720px; line-height: 1.55; }
  .summary { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
  .summary .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--panel);
    font-size: 13px;
    color: var(--text);
  }
  .summary .chip.blocking { border-color: #ef4444; color: #fecaca; }
  .summary .chip.warning  { border-color: #f59e0b; color: #fcd34d; }
  .summary .chip.info     { border-color: #38bdf8; color: #bae6fd; }
  .summary .chip.clean    { border-color: #22c55e; color: #bbf7d0; }
  .summary .chip strong { font-variant-numeric: tabular-nums; }
  .group { margin: 28px 0; }
  .group h2 {
    font-size: 18px;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    margin: 0 0 12px;
    color: var(--muted);
  }
  .issue {
    border: 1px solid var(--line);
    border-left: 4px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    padding: 14px 16px;
    margin-bottom: 10px;
  }
  .issue.blocking { border-left-color: #ef4444; }
  .issue.warning  { border-left-color: #f59e0b; }
  .issue.info     { border-left-color: #38bdf8; }
  .issue .kind {
    display: inline-block;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    color: var(--muted);
    margin-right: 8px;
  }
  .issue .where {
    color: var(--faint);
    font-size: 13px;
  }
  .issue .message { margin: 4px 0 0; color: var(--text); }
  .issue .fix { margin: 6px 0 0; color: var(--muted); font-size: 13.5px; }
  .empty {
    padding: 24px;
    border: 1px dashed var(--line);
    border-radius: 10px;
    color: var(--muted);
    text-align: center;
  }
`;

interface OwnedSiteRow {
  id: string;
  name: string;
  editableState: EditableSite;
}

async function lookupOwnedSite(
  env: Bindings,
  clerkUserId: string,
  siteId: string,
): Promise<OwnedSiteRow | null> {
  const database = db(env);
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, clerkUserId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return null;

  const rows = await database
    .select({
      id: site.id,
      name: site.name,
      editableState: site.editableState,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  return rows[0] ?? null;
}

function groupBySeverity(issues: AuditIssue[]): Record<Severity, AuditIssue[]> {
  const groups: Record<Severity, AuditIssue[]> = {
    blocking: [],
    warning: [],
    info: [],
  };
  for (const issue of issues) groups[issue.severity].push(issue);
  return groups;
}

function IssueCard({ issue }: { issue: AuditIssue }) {
  const where =
    issue.elementId !== undefined && issue.pageSlug !== undefined
      ? `Page /${issue.pageSlug} — element ${issue.elementId}`
      : issue.pageSlug !== undefined
        ? `Page /${issue.pageSlug}`
        : 'Site';
  return (
    <div class={`issue ${issue.severity}`}>
      <div>
        <span class="kind">{issue.kind}</span>
        <span class="where">{where}</span>
      </div>
      <p class="message">{issue.message}</p>
      {issue.fixHint && <p class="fix">{issue.fixHint}</p>}
    </div>
  );
}

a11yReportRoute.get('/sites/:siteId/a11y', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('a11y-report route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) return c.text('site not found', 404);

  const owned = await lookupOwnedSite(c.env, auth.userId, siteId);
  if (!owned) return c.text('site not found', 404);

  const report = runAudit(owned.editableState);
  const grouped = groupBySeverity(report.issues);

  const isClean = report.issues.length === 0;

  return c.html(
    <DashboardShell
      title={`${owned.name} — a11y report`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${siteId}/edit`, label: owned.name },
        { label: 'Accessibility' },
      ]}
      siteNav={buildSiteNav(siteId, owned.name, `/dashboard/sites/${siteId}/a11y`)}
      pageStyles={pageStyles}
    >
      <h1>Accessibility report</h1>
      <p class="lede">
        Every blocking issue must be resolved before this site can publish. Warnings and
        informational items don&apos;t block publish; they&apos;re a polishing checklist.
      </p>
      <div class="summary">
        {isClean ? (
          <span class="chip clean">
            <strong>0</strong> issues — ready to publish
          </span>
        ) : (
          <>
            <span class="chip blocking">
              <strong>{String(report.blockerCount)}</strong> blocking
            </span>
            <span class="chip warning">
              <strong>{String(report.warningCount)}</strong> warning
            </span>
            <span class="chip info">
              <strong>{String(report.infoCount)}</strong> info
            </span>
          </>
        )}
      </div>

      {isClean ? (
        <div class="empty">
          No accessibility issues detected on this site. Publish is unblocked.
        </div>
      ) : (
        <>
          {grouped.blocking.length > 0 && (
            <section class="group">
              <h2>Blocking</h2>
              {grouped.blocking.map((issue) => (
                <IssueCard issue={issue} />
              ))}
            </section>
          )}
          {grouped.warning.length > 0 && (
            <section class="group">
              <h2>Warnings</h2>
              {grouped.warning.map((issue) => (
                <IssueCard issue={issue} />
              ))}
            </section>
          )}
          {grouped.info.length > 0 && (
            <section class="group">
              <h2>Info</h2>
              {grouped.info.map((issue) => (
                <IssueCard issue={issue} />
              ))}
            </section>
          )}
        </>
      )}
    </DashboardShell>,
  );
});

export default a11yReportRoute;
