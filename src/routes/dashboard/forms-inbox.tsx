// src/routes/dashboard/forms-inbox.tsx
//
// Dashboard route — GET /dashboard/sites/:siteId/forms
//                   GET /dashboard/sites/:siteId/forms/:formElementId
//
// Lists every form element across a site's pages with submission counts, then
// drills into one form's submission list with newest-first ordering and a
// "Download CSV" button.
//
// Open Canvas chrome (MIGRATION.md §5d / forms.html):
//   - Three mini-stat cards: Total messages / This week / Unread
//   - Form selector pill (`.formsel` segmented buttons, one per form)
//   - Inbox card with header row + .sub-row rows; unread rows carry .unread
//     so the red dot after the sender name shows
//   - "Export CSV" button (.btn .btn-outline) at the toolbar level

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
import { readThemeCookie } from '../../ui';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const formsInboxRoute = new Hono<Env>();
formsInboxRoute.use('*', clerkAuth());
formsInboxRoute.use('*', requireAuth());

// Page chrome — restyled from forms.html. The `.toolbar` / `.formsel`
// / `.ministats` / `.inbox` blocks live here so the route stays
// self-contained; tokens come from theme.css.
const pageStyles = `
  .content > h1 { font-size: 32px; letter-spacing: -.03em; }
  .content > .sub { color: var(--ink-2); margin: 6px 0 28px; }

  .ministats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    margin-bottom: 22px;
  }
  .ms {
    padding: 16px 18px;
    border: 1px solid var(--line);
    border-radius: var(--r);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .ms .k {
    font-size: 12.5px;
    color: var(--ink-2);
    font-weight: 600;
  }
  .ms .v {
    font-family: var(--display);
    font-weight: 700;
    font-size: 26px;
    margin-top: 6px;
    color: var(--ink);
  }
  .ms.unread .v { color: var(--red-ink); }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }
  .formsel {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
  }
  .formsel a {
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 600;
    padding: 7px 14px;
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--ink-2);
    text-decoration: none;
    transition: background .14s, color .14s, box-shadow .14s;
  }
  .formsel a.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-sm);
  }
  .toolbar .sp { flex: 1; }

  .inbox {
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }
  .inbox-head {
    display: grid;
    grid-template-columns: 200px 1fr 140px 40px;
    gap: 16px;
    padding: 12px 20px;
    background: var(--surface-2);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .sub-row {
    display: grid;
    grid-template-columns: 200px 1fr 140px 40px;
    gap: 16px;
    align-items: center;
    padding: 15px 20px;
    border-top: 1px solid var(--line);
    transition: background .12s;
    color: inherit;
    text-decoration: none;
  }
  .sub-row:first-of-type { border-top: none; }
  .sub-row:hover { background: var(--surface-2); }
  .sub-row .who b { font-size: 14px; color: var(--ink); }
  .sub-row .who small { display: block; font-size: 12px; color: var(--ink-3); }
  .sub-row .msg {
    font-size: 13.5px;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub-row .date { font-size: 12.5px; color: var(--ink-3); text-align: right; }
  .sub-row .chev { color: var(--ink-3); display: flex; justify-content: flex-end; }
  .sub-row.unread .who b::after {
    content: "";
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--red);
    margin-left: 7px;
    vertical-align: middle;
  }

  .empty {
    padding: 28px 20px;
    text-align: center;
    color: var(--ink-3);
    font-size: 14px;
  }

  /* sub-page header: title + Export CSV alignment */
  .subs-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 18px;
  }
  .subs-head .sp { flex: 1; }
  table.submissions {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }
  table.submissions th,
  table.submissions td {
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
    text-align: left;
    vertical-align: top;
    font-size: 14px;
  }
  table.submissions th {
    color: var(--ink-3);
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: var(--surface-2);
  }
  table.submissions tr:last-child td { border-bottom: none; }
  table.submissions td.payload {
    font-family: var(--mono);
    color: var(--ink-2);
    font-size: 12.5px;
    white-space: pre-wrap;
    max-width: 480px;
    overflow-wrap: anywhere;
  }
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

function ExportIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" stroke-linecap="round" />
    </svg>
  );
}

function relativeWhen(when: Date): string {
  const ms = Date.now() - when.getTime();
  if (Number.isNaN(ms)) return when.toISOString();
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return when.toISOString().slice(0, 10);
}

// Pull the first non-empty string field out of a payload — used as the
// "preview" line in the inbox row. Mirrors how an email client shows the
// first sentence of a message.
function previewLine(payload: Record<string, unknown>): string {
  for (const value of Object.values(payload)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '(no message)';
}

function senderLine(payload: Record<string, unknown>): { name: string; email: string } {
  const nameRaw = payload['name'] ?? payload['fullName'] ?? payload['firstName'];
  const emailRaw = payload['email'] ?? payload['from'];
  const name = typeof nameRaw === 'string' && nameRaw.trim().length > 0 ? nameRaw : 'Anonymous';
  const email = typeof emailRaw === 'string' ? emailRaw : '';
  return { name, email };
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

  // Per-form count — one query per form is fine for the POC scale.
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

  const totalMessages = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);

  return c.html(
    <DashboardShell
      title={`${owned.name} — forms`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${esc(siteId)}/edit`, label: owned.name },
        { label: 'Forms' },
      ]}
      siteNav={buildSiteNav(siteId, owned.name, `/dashboard/sites/${siteId}/forms`)}
      pageStyles={pageStyles}
      theme={readThemeCookie(c)}
    >
      <h1>Forms</h1>
      <p class="sub">
        Messages people send through forms on <b>{owned.name}</b>.
      </p>

      <div class="ministats">
        <div class="ms">
          <div class="k">Total messages</div>
          <div class="v">{String(totalMessages)}</div>
        </div>
        <div class="ms">
          <div class="k">Forms</div>
          <div class="v">{String(forms.length)}</div>
        </div>
        <div class="ms">
          <div class="k">Pages with a form</div>
          <div class="v">
            {String(new Set(forms.map((entry) => entry.pageSlug)).size)}
          </div>
        </div>
      </div>

      {forms.length === 0 ? (
        <div class="inbox">
          <div class="empty">
            No form elements found on this site. Drop a Form element onto a section to begin.
          </div>
        </div>
      ) : (
        <div class="inbox">
          <div class="inbox-head">
            <span>Form</span>
            <span>Location</span>
            <span style="text-align:right">Messages</span>
            <span></span>
          </div>
          {forms.map((entry) => (
            <a
              class="sub-row"
              href={`/dashboard/sites/${esc(siteId)}/forms/${esc(entry.form.id)}`}
            >
              <div class="who">
                <b>{entry.form.id}</b>
                <small>{String(entry.form.fields.length)} fields</small>
              </div>
              <div class="msg">on /{entry.pageSlug}</div>
              <div class="date">{String(counts.get(entry.form.id) ?? 0)}</div>
              <div class="chev">
                <ChevronIcon />
              </div>
            </a>
          ))}
        </div>
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
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = submissions.filter((row) => row.submittedAt.getTime() >= weekAgo).length;

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
      theme={readThemeCookie(c)}
    >
      <h1>Forms</h1>
      <p class="sub">
        Messages people send through forms on <b>{owned.name}</b>.
      </p>

      <div class="ministats">
        <div class="ms">
          <div class="k">Total messages</div>
          <div class="v">{String(submissions.length)}</div>
        </div>
        <div class="ms">
          <div class="k">This week</div>
          <div class="v">{String(thisWeek)}</div>
        </div>
        <div class="ms unread">
          <div class="k">Unread</div>
          <div class="v">{String(submissions.length)}</div>
        </div>
      </div>

      <div class="toolbar">
        <div class="formsel">
          {forms.map((f) => (
            <a
              href={`/dashboard/sites/${esc(siteId)}/forms/${esc(f.form.id)}`}
              class={f.form.id === formElementId ? 'on' : ''}
            >
              {f.form.id}
            </a>
          ))}
        </div>
        <div class="sp" />
        <a
          class="btn btn-outline btn-sm"
          href={`/api/forms/${esc(siteId)}/${esc(formElementId)}/export.csv`}
        >
          <ExportIcon />
          Export CSV
        </a>
      </div>

      {submissions.length === 0 ? (
        <div class="inbox">
          <div class="empty">No submissions yet.</div>
        </div>
      ) : (
        <>
          <div class="inbox">
            <div class="inbox-head">
              <span>From</span>
              <span>Message</span>
              <span style="text-align:right">Received</span>
              <span></span>
            </div>
            {submissions.map((row) => {
              const payload: Record<string, unknown> = row.payload ?? {};
              const sender = senderLine(payload);
              return (
                <div class="sub-row unread">
                  <div class="who">
                    <b>{sender.name}</b>
                    <small>{sender.email || `/${row.pageSlug}`}</small>
                  </div>
                  <div class="msg">{previewLine(payload)}</div>
                  <div class="date">{relativeWhen(row.submittedAt)}</div>
                  <div class="chev">
                    <ChevronIcon />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Full payload table — kept below the inbox view for owners who want
              field-by-field detail. */}
          <h2
            style="font-family:var(--display);font-size:18px;margin:28px 0 12px;color:var(--ink);"
          >
            All fields
          </h2>
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
        </>
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
