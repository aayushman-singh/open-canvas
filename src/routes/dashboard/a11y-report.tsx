// src/routes/dashboard/a11y-report.tsx
//
// Wave 3 #15 — Owner-facing dashboard route.
//
//   GET /dashboard/sites/:siteId/a11y
//
// Renders the AuditReport for a site with the Open Canvas accessibility
// surface (MIGRATION.md §5d / a11y.html):
//   - score ring (conic-gradient) keyed on blocker count → ok / warn / red
//   - 6 check cards (one per Severity category, derived from issue kinds)
//   - issue list with severity chips + "Fix in editor" CTA per row
//
// The Owner uses this BEFORE clicking Publish to see what would block them.
// Each blocking + warning item links back to the offending element by id
// (the editor surfaces a "find element by id" affordance — out of scope here).
//
// Auth: Clerk + customer→site join. Mirrors the forms-inbox route shape so
// drift between dashboard surfaces stays minimal.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { EditableSite } from '../../canvas/schema';
import { db } from '../../db/client';
import { site } from '../../db/schema';
import { runAudit, type AuditIssue } from '../../a11y/audit';
import type { Severity } from '../../a11y/severity';

import { DashboardShell, buildSiteNav } from './shell';
import { Button, readThemeCookie } from '../../ui';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const a11yReportRoute = new Hono<Env>();
a11yReportRoute.use('*', clerkAuth());
a11yReportRoute.use('*', requireAuth());

// Page-specific overlay on top of components.css. Scopes the score ring +
// check grid + issue card chrome so the audit surface matches a11y.html
// byte-for-byte while still inheriting tokens (--ok / --warn / --red /
// --line / --surface) from theme.css.
const pageStyles = `
  .content > h1 { font-size: 32px; letter-spacing: -.03em; }
  .content > .sub { color: var(--ink-2); margin: 6px 0 28px; }

  .score {
    display: flex;
    align-items: center;
    gap: 22px;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    padding: 24px;
    margin-bottom: 22px;
  }
  .score .ring {
    width: 92px;
    height: 92px;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .score .ring .in {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: var(--surface);
  }
  .score .st h2 { font-family: var(--display); font-size: 19px; }
  .score .st p { font-size: 14px; color: var(--ink-2); margin-top: 5px; }
  .score .actions { margin-left: auto; }

  .checks {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-bottom: 22px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: var(--r);
    background: var(--surface);
  }
  .check .ic {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .check.ok .ic { background: var(--ok-soft); color: var(--ok); }
  .check.warn .ic { background: var(--warn-soft); color: var(--warn); }
  .check.red .ic { background: var(--red-soft); color: var(--red-ink); }
  .check b { font-size: 14px; color: var(--ink); }
  .check small { display: block; font-size: 12px; color: var(--ink-3); }

  .issues {
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }
  .issue {
    display: flex;
    gap: 14px;
    padding: 16px 20px;
    border-top: 1px solid var(--line);
  }
  .issue:first-child { border-top: none; }
  .issue .sev { flex-shrink: 0; align-self: flex-start; }
  .issue .it b { font-size: 14px; color: var(--ink); }
  .issue .it p { font-size: 13px; color: var(--ink-2); margin-top: 3px; line-height: 1.45; }
  .issue .it .where {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--ink-3);
    margin-top: 4px;
    display: block;
  }
  .issue .it .fix {
    font-size: 12.5px;
    color: var(--red-ink);
    font-weight: 600;
    margin-top: 6px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  /* warn chip variant — components.css ships .chip + .chip-ok + .chip-red.
     Hand-roll .chip-warn here so the audit surface can show "Review"
     differently from "Pass" / "Block". */
  .chip-warn {
    background: var(--warn-soft);
    color: var(--warn);
    border-color: transparent;
  }

  .empty {
    padding: 24px;
    text-align: center;
    color: var(--ink-2);
    font-size: 14px;
  }
`;

interface OwnedSiteRow {
  id: string;
  name: string;
  editableState: EditableSite;
}

async function lookupOwnedSite(
  env: Bindings,
  customerId: string,
  siteId: string,
): Promise<OwnedSiteRow | null> {
  const database = db(env);
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

// Three SVG icons used in the score ring + check tiles.
function CheckTickIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CheckWarnIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
    >
      <path d="M12 8v5M12 16h.01" stroke-linecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

// Six category cards mirroring a11y.html. Each one summarises issue
// counts under a kind family — when the family has 0 issues we render
// the .ok variant; otherwise .warn (and .red for blocking-only families).
interface CheckCategory {
  label: string;
  kinds: ReadonlyArray<string>;
  okCopy: string;
}

const CHECK_CATEGORIES: ReadonlyArray<CheckCategory> = [
  { label: 'Image descriptions', kinds: ['img-alt-missing'], okCopy: 'All images labelled' },
  { label: 'Button labels', kinds: ['button-label-missing'], okCopy: 'Every button is clear' },
  {
    label: 'Colour contrast',
    kinds: ['contrast-low', 'contrast-failing'],
    okCopy: 'All contrast checks pass',
  },
  {
    label: 'Form labels',
    kinds: ['form-label-missing', 'form-field-missing'],
    okCopy: 'All fields labelled',
  },
  {
    label: 'Heading order',
    kinds: ['heading-skip', 'heading-order'],
    okCopy: 'No skipped levels',
  },
  {
    label: 'Page titles',
    kinds: ['page-title-missing', 'page-meta-missing'],
    okCopy: 'Set on all pages',
  },
];

function summariseCategory(
  category: CheckCategory,
  issues: AuditIssue[],
): { variant: 'ok' | 'warn' | 'red'; copy: string } {
  const matches = issues.filter((issue) =>
    category.kinds.some((kind) => issue.kind === kind || issue.kind.startsWith(`${kind}-`)),
  );
  if (matches.length === 0) {
    return { variant: 'ok', copy: category.okCopy };
  }
  const blocking = matches.filter((issue) => issue.severity === 'blocking').length;
  if (blocking > 0) {
    const word = blocking === 1 ? 'block' : 'blocks';
    return { variant: 'red', copy: `${blocking} ${word} publish` };
  }
  const word = matches.length === 1 ? 'area' : 'areas';
  return { variant: 'warn', copy: `${matches.length} ${word} to review` };
}

function severityChipClass(severity: Severity): string {
  if (severity === 'blocking') return 'chip chip-red';
  if (severity === 'warning') return 'chip chip-warn';
  return 'chip';
}

function severityChipLabel(severity: Severity): string {
  if (severity === 'blocking') return 'Block';
  if (severity === 'warning') return 'Review';
  return 'Info';
}

function IssueCard({ issue, editorHref }: { issue: AuditIssue; editorHref: string }) {
  const where =
    issue.pageSlug !== undefined ? `Page /${issue.pageSlug}` : 'Site';
  // Append the targeting query params so the editor's boot path can pan to
  // the right page and select the offending element. The editor reads these
  // synchronously after state hydration — see editor-client/index.ts boot
  // block. elementId stays user-invisible in the message (we use friendlier
  // labels in the audit checks now), but it's the load-bearing identifier
  // for the selection round-trip.
  const params = new URLSearchParams();
  if (issue.pageSlug !== undefined) params.set('focusPage', issue.pageSlug);
  if (issue.elementId !== undefined) params.set('focusElement', issue.elementId);
  const fixHref = params.toString().length > 0 ? `${editorHref}?${params.toString()}` : editorHref;
  return (
    <div class="issue">
      <span class={`sev ${severityChipClass(issue.severity)}`}>
        {severityChipLabel(issue.severity)}
      </span>
      <div class="it">
        <b>{issue.message}</b>
        {issue.fixHint && <p>{issue.fixHint}</p>}
        <span class="where">{where}</span>
        <a href={fixHref} class="fix">
          Fix in editor <ArrowIcon />
        </a>
      </div>
    </div>
  );
}

// Score band → ring colour. We use Open Canvas semantic tokens so the
// ring themes for free in dark mode.
function scoreBand(blockerCount: number, warningCount: number): 'ok' | 'warn' | 'red' {
  if (blockerCount > 0) return 'red';
  if (warningCount > 0) return 'warn';
  return 'ok';
}

function scoreCopy(blockerCount: number, warningCount: number): { headline: string; body: string } {
  if (blockerCount > 0) {
    const word = blockerCount === 1 ? 'issue is' : 'issues are';
    return {
      headline: 'Needs attention',
      body: `${blockerCount} ${word} blocking publish. Resolve them, then re-run this check.`,
    };
  }
  if (warningCount > 0) {
    return {
      headline: 'Looking good!',
      body: 'No blocking problems — your site is ready to publish. A couple of small things would make it even better.',
    };
  }
  return {
    headline: 'All clear',
    body: 'No accessibility issues detected on this site. Publish is unblocked.',
  };
}

a11yReportRoute.get('/sites/:siteId/a11y', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('a11y-report route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) return c.text('site not found', 404);

  const customerId = c.get('customer')?.id;
  if (!customerId) return c.text('site not found', 404);
  const owned = await lookupOwnedSite(c.env, customerId, siteId);
  if (!owned) return c.text('site not found', 404);

  const report = runAudit(owned.editableState);
  const grouped = groupBySeverity(report.issues);
  const editorHref = `/dashboard/sites/${siteId}/edit`;

  // Score: 100 minus 20 per blocker, 5 per warning, capped at 0.
  const rawScore = 100 - report.blockerCount * 20 - report.warningCount * 5;
  const score = Math.max(0, rawScore);
  const band = scoreBand(report.blockerCount, report.warningCount);
  const ringColour =
    band === 'ok' ? 'var(--ok)' : band === 'warn' ? 'var(--warn)' : 'var(--red)';
  // Conic-gradient → ring fill stops at `score%`; remainder is a neutral
  // surface so the unfilled portion reads as "headroom".
  const ringStyle = `background: conic-gradient(${ringColour} 0 ${score}%, var(--surface-3) ${score}% 100%);`;
  const copy = scoreCopy(report.blockerCount, report.warningCount);

  return c.html(
    <DashboardShell
      title={`${owned.name} — accessibility`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${siteId}/edit`, label: owned.name },
        { label: 'Accessibility' },
      ]}
      siteNav={buildSiteNav(siteId, owned.name, `/dashboard/sites/${siteId}/a11y`)}
      pageStyles={pageStyles}
      theme={readThemeCookie(c)}
    >
      <h1>Accessibility</h1>
      <p class="sub">
        We check your site so everyone — including people using screen readers — can use it.
      </p>

      <div class="score">
        {/* Ring fill encodes the trend (red/warn/green by band, fill ratio
            by score%). The numeric score itself isn't displayed — ADR 0031
            removed the digits because the rubric (100 - blockers*20 -
            warnings*5) doesn't track publishability (1 blocker + 8 warnings
            scores 40, 2 blockers + 0 warnings scores 60, the latter is
            worse despite being closer to publishable). The ring's fill is
            the qualitative signal; the per-finding rows below carry the
            actionable detail. */}
        <div class="ring" style={ringStyle}>
          <div class="in" />
        </div>
        <div class="st">
          <h2>{copy.headline}</h2>
          <p>{copy.body}</p>
        </div>
        <div class="actions">
          <Button variant="secondary" size="sm" href={`/dashboard/sites/${siteId}/a11y`}>
            Run audit
          </Button>
        </div>
      </div>

      <div class="checks">
        {CHECK_CATEGORIES.map((category) => {
          const { variant, copy: tileCopy } = summariseCategory(category, report.issues);
          return (
            <div class={`check ${variant}`}>
              <span class="ic">
                {variant === 'ok' ? <CheckTickIcon /> : <CheckWarnIcon />}
              </span>
              <span>
                <b>{category.label}</b>
                <small>{tileCopy}</small>
              </span>
            </div>
          );
        })}
      </div>

      {report.issues.length === 0 ? (
        <div class="card">
          <p class="empty">
            No accessibility issues detected on this site. Publish is unblocked.
          </p>
        </div>
      ) : (
        <div class="issues">
          {grouped.blocking.map((issue) => (
            <IssueCard issue={issue} editorHref={editorHref} />
          ))}
          {grouped.warning.map((issue) => (
            <IssueCard issue={issue} editorHref={editorHref} />
          ))}
          {grouped.info.map((issue) => (
            <IssueCard issue={issue} editorHref={editorHref} />
          ))}
        </div>
      )}
    </DashboardShell>,
  );
});

export default a11yReportRoute;
