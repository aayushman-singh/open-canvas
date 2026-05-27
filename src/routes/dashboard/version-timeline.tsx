// src/routes/dashboard/version-timeline.tsx
//
// Editor-sidebar UI for the version-history timeline — Wave 1 #3.
//
// Server-rendered shell that loads the first page of snapshots inline, then
// hands the rest off to small inline scripts:
//   - "Save snapshot" button → POST /api/sites/:id/snapshots with a label
//   - "Preview" button → GET …/preview, swap the HTML into a sandbox iframe
//   - "Restore" button → POST …/restore (with one confirm step)
//
// Disjoint from any other Wave 1 surface — the editor (canvas-index.tsx)
// already exists; this is a new sidebar panel served at its own dashboard
// route. Wave 4 may fold it into a unified sidebar; for now it stands alone
// so an Owner can demo the timeline against any site without editor wiring.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';

import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { db } from '../../db/client.js';
import { customer, site } from '../../db/schema.js';

import { listSnapshots, type SnapshotListItem } from '../../version/list.js';
import { DashboardShell, buildSiteNav } from './shell.js';
import { Button, Badge } from '../../ui';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

export const versionTimeline = new Hono<{
  Bindings: Bindings;
  Variables: ClerkAuthVariables;
}>();

versionTimeline.use('*', clerkAuth());
versionTimeline.use('*', requireAuth());

const panelStyles = `
  .timeline-panel {
    display: grid;
    grid-template-columns: minmax(280px, 360px) 1fr;
    gap: 20px;
    margin-top: 24px;
  }
  .timeline-list {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px;
  }
  .timeline-list h2 {
    margin: 0 0 12px;
    font-size: 16px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .timeline-list ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .timeline-entry {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--panel-strong);
  }
  .timeline-entry.is-active {
    border-color: var(--accent);
  }
  .timeline-entry .when {
    font-size: 12px;
    color: var(--faint);
    margin-bottom: 4px;
  }
  .timeline-entry .what {
    font-size: 14px;
    color: var(--text);
    margin-bottom: 8px;
  }
  .timeline-entry .actions {
    display: flex;
    gap: 6px;
  }
  .timeline-form {
    margin-top: 16px;
    display: flex;
    gap: 8px;
  }
  .timeline-form input {
    flex: 1;
    background: var(--panel-strong);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 6px;
    font-size: 13px;
    padding: 6px 10px;
  }
  .timeline-preview {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px;
    min-height: 320px;
  }
  .timeline-preview h2 {
    margin: 0 0 12px;
    font-size: 16px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .timeline-preview .empty {
    color: var(--faint);
    font-style: italic;
  }
  .timeline-preview iframe {
    width: 100%;
    height: 480px;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
`;

function relativeWhen(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

function entryLabel(entry: SnapshotListItem): string {
  if (entry.reason === 'publish') {
    const v = entry.publishedVersion;
    return v !== null ? `Published v${String(v)}` : 'Published';
  }
  return entry.label ?? 'Manual snapshot';
}

versionTimeline.get('/sites/:siteId/snapshots', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('version timeline reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.notFound();
  }
  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return c.notFound();
  }
  const siteRow = await database
    .select({ id: site.id, name: site.name })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const row = siteRow[0];
  if (!row) {
    return c.notFound();
  }

  const page = await listSnapshots(row.id, database, { limit: 50 });

  const apiBase = `/api/sites/${row.id}/snapshots`;

  // Inline script that wires the three actions. Plain JS — no bundler step.
  // Confirm dialogs gate the destructive restore action. Preview swaps the
  // returned HTML into a sandboxed iframe via srcdoc so an Owner viewing a
  // past snapshot never accidentally runs scripts against the live editor.
  const inlineScript = `
    (function () {
      const apiBase = ${JSON.stringify(apiBase)};
      const preview = document.querySelector('[data-timeline-preview]');
      const list = document.querySelector('[data-timeline-list]');

      function setActive(id) {
        if (!list) return;
        list.querySelectorAll('[data-timeline-entry]').forEach(function (el) {
          el.classList.toggle('is-active', el.getAttribute('data-timeline-entry') === id);
        });
      }

      async function doPreview(id) {
        if (!preview) return;
        preview.innerHTML = '<h2>Preview</h2><p class="empty">Loading…</p>';
        const res = await fetch(apiBase + '/' + encodeURIComponent(id) + '/preview', {
          headers: { 'accept': 'application/json' },
        });
        if (!res.ok) {
          const body = await res.text();
          var errP = document.createElement('p'); errP.className = 'empty'; errP.textContent = 'Preview failed: ' + body; preview.innerHTML = '<h2>Preview</h2>'; preview.appendChild(errP);
          return;
        }
        const data = await res.json();
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', '');
        frame.setAttribute('srcdoc', '<!doctype html><html><body>' + data.html + '</body></html>');
        preview.innerHTML = '<h2>Preview</h2>';
        preview.appendChild(frame);
        setActive(id);
      }

      async function doRestore(id, label) {
        if (!await __rev01Modal.confirm('Restore "' + label + '"? This overwrites your current edits. A safety snapshot of your current state will be saved automatically.', { title: 'Restore version' })) {
          return;
        }
        const res = await fetch(apiBase + '/' + encodeURIComponent(id) + '/restore', {
          method: 'POST',
          headers: { 'accept': 'application/json' },
        });
        if (!res.ok) {
          const body = await res.text();
          __rev01Modal.alert('Restore failed: ' + body, 'Error');
          return;
        }
        window.location.reload();
      }

      async function doManualCapture(form) {
        const label = String(new FormData(form).get('label') || '').trim();
        if (label.length === 0) {
          __rev01Modal.alert('Label is required.', 'Missing label');
          return;
        }
        const res = await fetch(apiBase, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify({ label: label }),
        });
        if (!res.ok) {
          const body = await res.text();
          __rev01Modal.alert('Capture failed: ' + body, 'Error');
          return;
        }
        window.location.reload();
      }

      if (list) {
        list.addEventListener('click', function (event) {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const action = target.getAttribute('data-timeline-action');
          if (!action) return;
          const entry = target.closest('[data-timeline-entry]');
          if (!entry) return;
          const id = entry.getAttribute('data-timeline-entry') || '';
          const label = entry.getAttribute('data-timeline-label') || '';
          if (action === 'preview') doPreview(id);
          if (action === 'restore') doRestore(id, label);
        });
      }

      const form = document.querySelector('[data-timeline-form]');
      if (form) {
        form.addEventListener('submit', function (event) {
          event.preventDefault();
          doManualCapture(form);
        });
      }
    })();
  `;

  return c.html(
    <DashboardShell
      title={`Version history — ${row.name}`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${row.id}/edit`, label: row.name },
        { label: 'Version history' },
      ]}
      siteNav={buildSiteNav(row.id, row.name, `/dashboard/sites/${row.id}/snapshots`)}
      pageStyles={panelStyles}
    >
      <h1>Version history</h1>
      <p>
        Past publishes of <strong>{row.name}</strong> appear here, newest first. Preview a past
        version, restore it, or capture a labelled snapshot of your current state.
      </p>

      <div class="timeline-panel">
        <section class="timeline-list">
          <h2>Timeline</h2>
          {page.items.length === 0 ? (
            <p class="empty">No snapshots yet. Publish or save one to start the history.</p>
          ) : (
            <ol data-timeline-list>
              {page.items.map((entry) => (
                <li
                  class="timeline-entry"
                  data-timeline-entry={entry.id}
                  data-timeline-label={entryLabel(entry)}
                >
                  <div class="when">{relativeWhen(entry.capturedAt)}</div>
                  <div class="what">
                    {entryLabel(entry)}
                    {entry.reason === 'publish' && <Badge variant="info">publish</Badge>}
                  </div>
                  <div class="actions">
                    <Button variant="secondary" size="sm" data-timeline-action="preview">
                      Preview
                    </Button>
                    <Button variant="danger" size="sm" data-timeline-action="restore">
                      Restore
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <form class="timeline-form" data-timeline-form>
            <input
              type="text"
              name="label"
              placeholder="Save snapshot label…"
              maxlength={200}
              required
            />
            <Button variant="primary" type="submit" size="sm">Save</Button>
          </form>
        </section>
        <section class="timeline-preview" data-timeline-preview>
          <h2>Preview</h2>
          <p class="empty">Click "Preview" on a timeline entry to see how the site looked then.</p>
        </section>
      </div>
      <script>{raw(inlineScript)}</script>
    </DashboardShell>,
  );
});

export default versionTimeline;
