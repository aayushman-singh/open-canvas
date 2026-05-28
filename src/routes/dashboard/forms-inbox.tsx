// src/routes/dashboard/forms-inbox.tsx
//
// Dashboard route — GET /dashboard/sites/:siteId/forms
//                   GET /dashboard/sites/:siteId/forms/:formElementId
//
// Lists every form element across a site's pages with submission counts, then
// drills into one form's submission list with newest-first ordering and a
// "Download CSV" button. Filtering / search is intentionally absent for the
// POC — the dataset is owner-scoped and assumed small.

import { and, count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { FormElement } from '../../canvas/elements/form';
import type {
  CanvasPage,
  EditableSite,
  PublishedSnapshot,
} from '../../canvas/schema';
import { db } from '../../db/client';
import { customer, formSubmission, site, type FormSubmission } from '../../db/schema';

import { DashboardShell, buildSiteNav } from './shell';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const formsInboxRoute = new Hono<Env>();
formsInboxRoute.use('*', clerkAuth());
formsInboxRoute.use('*', requireAuth());

const pageStyles = `
  .lede { margin: 8px 0 24px; color: var(--muted); max-width: 640px; line-height: 1.55; }
  .form-card {
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .form-card .meta { color: var(--muted); font-size: 13px; }
  .form-card .name { font-weight: 600; color: var(--text); }
  .form-card .count {
    margin-left: auto;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 14px;
    color: var(--text);
  }
  .submissions-empty {
    padding: 24px;
    border: 1px dashed var(--line);
    border-radius: 10px;
    color: var(--muted);
    text-align: center;
  }
  table.submissions {
    width: 100%;
    border-collapse: collapse;
    margin-top: 16px;
  }
  table.submissions th,
  table.submissions td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--line);
    text-align: left;
    vertical-align: top;
    font-size: 14px;
  }
  table.submissions th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  table.submissions td.payload {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    color: var(--muted);
    font-size: 12.5px;
    white-space: pre-wrap;
    max-width: 480px;
    overflow-wrap: anywhere;
  }
  .actions { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; }
  .actions a {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    padding: 8px 12px;
    font-size: 13px;
    text-decoration: none;
  }
  .actions a:hover { border-color: var(--accent); color: var(--accent); }
`;

interface OwnedSite {
  id: string;
  name: string;
  editableState: EditableSite;
  publishedSnapshot: PublishedSnapshot | null;
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

  const rows = await database
    .select({
      id: site.id,
      name: site.name,
      editableState: site.editableState,
      publishedSnapshot: site.publishedSnapshot,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Walk a site's editableState + publishedSnapshot collecting every form
 * element. The same form id can appear in both surfaces; we prefer the
 * editableState definition (newer fields), falling back to the snapshot.
 */
function collectForms(site: OwnedSite): Array<{ form: FormElement; pageSlug: string }> {
  const out = new Map<string, { form: FormElement; pageSlug: string }>();
  const ingest = (source: { pages: CanvasPage[] }) => {
    for (const page of source.pages) {
      for (const section of page.sections) {
        for (const element of section.elements) {
          if (element.type === 'form' && !out.has(element.id)) {
            out.set(element.id, { form: element, pageSlug: page.slug });
          }
        }
      }
    }
  };
  ingest(site.editableState);
  if (site.publishedSnapshot) ingest(site.publishedSnapshot);
  return Array.from(out.values());
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

formsInboxRoute.get('/sites/:siteId/forms', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('forms-inbox route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) return c.text('site not found', 404);
  const owned = await lookupOwnedSite(c.env, auth.userId, siteId);
  if (!owned) return c.text('site not found', 404);

  const forms = collectForms(owned);
  const database = db(c.env);

  // Per-form count — one query per form is fine for the POC scale (form
  // density per site is tiny — N=1..3 in practice).
  const counts = new Map<string, number>();
  for (const entry of forms) {
    const rows = await database
      .select({ n: count() })
      .from(formSubmission)
      .where(
        and(
          eq(formSubmission.siteId, siteId),
          eq(formSubmission.formElementId, entry.form.id),
        ),
      );
    counts.set(entry.form.id, rows[0]?.n ?? 0);
  }

  return c.html(
    <DashboardShell
      title={`${owned.name} — forms inbox`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${esc(siteId)}/edit`, label: owned.name },
        { label: 'Forms' },
      ]}
      siteNav={buildSiteNav(siteId, owned.name, `/dashboard/sites/${siteId}/forms`)}
      pageStyles={pageStyles}
    >
      <h1>Forms</h1>
      <p class="lede">
        Every form on this site appears below with its submission count. Click a form to view
        submissions and export CSV.
      </p>
      {forms.length === 0 ? (
        <div class="submissions-empty">
          No form elements found on this site. Drop a Form element onto a section to begin.
        </div>
      ) : (
        forms.map((entry) => (
          <a
            class="form-card"
            href={`/dashboard/sites/${esc(siteId)}/forms/${esc(entry.form.id)}`}
            style="display:flex;color:inherit;text-decoration:none;"
          >
            <span>
              <span class="name">{entry.form.id}</span>
              <span class="meta" style="display:block;">
                on /{entry.pageSlug} — {String(entry.form.fields.length)} fields
              </span>
            </span>
            <span class="count">{String(counts.get(entry.form.id) ?? 0)} submissions</span>
          </a>
        ))
      )}
    </DashboardShell>,
  );
});

formsInboxRoute.get('/sites/:siteId/forms/:formElementId', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('forms-inbox route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  const formElementId = c.req.param('formElementId');
  if (!siteId || !formElementId) return c.text('site or form not found', 404);
  const owned = await lookupOwnedSite(c.env, auth.userId, siteId);
  if (!owned) return c.text('site not found', 404);

  const forms = collectForms(owned);
  const entry = forms.find((e) => e.form.id === formElementId);
  if (!entry) return c.text('form not found', 404);

  const database = db(c.env);
  const submissions: FormSubmission[] = await database
    .select()
    .from(formSubmission)
    .where(and(eq(formSubmission.siteId, siteId), eq(formSubmission.formElementId, formElementId)))
    .orderBy(desc(formSubmission.submittedAt))
    .limit(200);

  const fieldIds = entry.form.fields.map((f) => f.id);

  return c.html(
    <DashboardShell
      title={`${owned.name} — ${formElementId}`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${esc(siteId)}/edit`, label: owned.name },
        { href: `/dashboard/sites/${esc(siteId)}/forms`, label: 'Forms' },
        { label: formElementId },
      ]}
      siteNav={buildSiteNav(siteId, owned.name, `/dashboard/sites/${siteId}/forms`)}
      pageStyles={pageStyles}
    >
      <h1>{formElementId}</h1>
      <p class="lede">
        Page <code>/{entry.pageSlug}</code> — {String(entry.form.fields.length)} fields. Newest 200
        submissions below.
      </p>
      <div class="actions">
        <a href={`/api/forms/${esc(siteId)}/${esc(formElementId)}/export.csv`}>Download CSV</a>
      </div>
      {submissions.length === 0 ? (
        <div class="submissions-empty">No submissions yet.</div>
      ) : (
        <table class="submissions">
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Page</th>
              {fieldIds.map((id) => (
                <th>{id}</th>
              ))}
              <th>UA</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((row) => {
              const payload: Record<string, unknown> = row.payload ?? {};
              return (
                <tr>
                  <td>{row.submittedAt.toISOString()}</td>
                  <td>/{row.pageSlug}</td>
                  {fieldIds.map((id) => (
                    <td class="payload">{stringifyCell(payload[id])}</td>
                  ))}
                  <td class="payload">{row.userAgent}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </DashboardShell>,
  );
});

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Object / array values get JSON-stringified — avoids '[object Object]'.
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

export default formsInboxRoute;
