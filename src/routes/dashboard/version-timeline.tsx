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
// Open Canvas chrome (MIGRATION.md §5d / versions.html):
//   - Vertical timeline with `::before` rail at the left edge.
//   - Each row is a `.vrow` card with a coloured dot — publishes get
//     the red dot (`.vrow.pub`), the active "Live" entry gets the ok
//     halo (`.vrow.now`), and a plain dot marks manual snapshots.
//   - Per-row Preview / Restore buttons, plus a "Live" pill on the
//     current entry.
//   - The preview iframe lives in a sibling section so an Owner can
//     scrub past versions without losing the list.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';

import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { db } from '../../db/client.js';
import { customer, site } from '../../db/schema.js';

import { listSnapshots, type SnapshotListItem } from '../../version/list.js';
import { DashboardShell, buildSiteNav } from './shell.js';
import { Button, readThemeCookie } from '../../ui';

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

// Page chrome lifted from versions.html. The list lives in a 1-col
// vertical timeline; the preview iframe drops into a card below the
// timeline when activated (single-column layout = less competition
// with the per-site sidebar than the prior 2-col split).
const pageStyles = `
  .content > h1 { font-size: 32px; letter-spacing: -.03em; }
  .content > .sub { color: var(--ink-2); margin: 6px 0 28px; }

  .vhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 22px;
    flex-wrap: wrap;
  }
  .vhead .vh-text h1 { margin-bottom: 4px; }
  .vhead .vh-text p { margin: 0; }

  .timeline {
    position: relative;
    padding-left: 30px;
    margin-bottom: 28px;
  }
  .timeline::before {
    content: "";
    position: absolute;
    left: 9px;
    top: 6px;
    bottom: 6px;
    width: 2px;
    background: var(--line-2);
  }
  .vrow {
    position: relative;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    margin-bottom: 12px;
    border: 1px solid var(--line);
    border-radius: var(--r);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .vrow::before {
    content: "";
    position: absolute;
    left: -25px;
    top: 50%;
    transform: translateY(-50%);
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--surface);
    border: 3px solid var(--line-2);
  }
  .vrow.pub::before { border-color: var(--red); }
  .vrow.now::before {
    border-color: var(--ok);
    box-shadow: 0 0 0 4px var(--ok-soft);
  }
  .vrow .vt { flex: 1; min-width: 0; }
  .vrow .vt b { font-size: 14.5px; color: var(--ink); }
  .vrow .vt small {
    display: block;
    font-size: 12.5px;
    color: var(--ink-3);
    margin-top: 2px;
  }
  .vrow .vno {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--ink-3);
  }
  .vrow .acts { display: flex; gap: 7px; }

  .empty {
    padding: 20px;
    text-align: center;
    color: var(--ink-3);
    font-size: 13.5px;
    border: 1px dashed var(--line);
    border-radius: var(--r);
  }

  .snapshot-form {
    display: flex;
    gap: 10px;
    margin-top: 4px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: var(--r);
    background: var(--surface);
    align-items: center;
  }
  .snapshot-form input.field { flex: 1; max-width: 380px; }

  .preview-card {
    margin-top: 24px;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    padding: 18px;
  }
  .preview-card h2 {
    font-family: var(--display);
    font-size: 16px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin: 0 0 12px;
  }
  .preview-card .empty-preview {
    color: var(--ink-3);
    font-size: 13.5px;
    padding: 24px;
    text-align: center;
  }
  .preview-card iframe {
    width: 100%;
    height: 480px;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
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

function entryVersionTag(entry: SnapshotListItem): string {
  if (entry.reason === 'publish' && entry.publishedVersion !== null) {
    return `v${String(entry.publishedVersion)}`;
  }
  return '—';
}

function SaveIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v5h7" stroke-linecap="round" />
    </svg>
  );
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

  // Inline script wires the three actions. Confirm dialogs gate the
  // destructive restore action. Preview swaps the returned HTML into a
  // sandboxed iframe via srcdoc so an Owner viewing a past snapshot never
  // accidentally runs scripts against the live editor.
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
        preview.innerHTML = '<h2>Preview</h2><p class="empty-preview">Loading…</p>';
        const res = await fetch(apiBase + '/' + encodeURIComponent(id) + '/preview', {
          headers: { 'accept': 'application/json' },
        });
        if (!res.ok) {
          const body = await res.text();
          var errP = document.createElement('p');
          errP.className = 'empty-preview';
          errP.textContent = 'Preview failed: ' + body;
          preview.innerHTML = '<h2>Preview</h2>';
          preview.appendChild(errP);
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
          const actionTarget = target.closest('[data-timeline-action]');
          if (!actionTarget) return;
          const action = actionTarget.getAttribute('data-timeline-action');
          if (!action) return;
          const entry = actionTarget.closest('[data-timeline-entry]');
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

  // The first item in the timeline is treated as the "Live" version when
  // it carries reason=publish. This mirrors versions.html where the
  // current entry is decorated with .now .pub.
  const items = page.items;
  const liveId = items.find((entry) => entry.reason === 'publish')?.id ?? null;

  return c.html(
    <DashboardShell
      title={`Version history — ${row.name}`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${row.id}/edit`, label: row.name },
        { label: 'Version history' },
      ]}
      siteNav={buildSiteNav(row.id, row.name, `/dashboard/sites/${row.id}/snapshots`)}
      pageStyles={pageStyles}
      theme={readThemeCookie(c)}
    >
      <div class="vhead">
        <div class="vh-text">
          <h1>Version history</h1>
          <p class="sub">
            Every publish is saved. Roll back anytime — nothing is ever lost.
          </p>
        </div>
        <Button variant="secondary" size="sm">
          <SaveIcon />
          Save a snapshot
        </Button>
      </div>

      <div class="timeline">
        {items.length === 0 ? (
          <div class="empty">No snapshots yet. Publish or save one to start the history.</div>
        ) : (
          <div data-timeline-list>
            {items.map((entry) => {
              const isPub = entry.reason === 'publish';
              const isLive = entry.id === liveId;
              const classes = ['vrow'];
              if (isPub) classes.push('pub');
              if (isLive) classes.push('now');
              const label = isLive ? `Current — live version` : entryLabel(entry);
              const ago = relativeWhen(entry.capturedAt);
              return (
                <div
                  class={classes.join(' ')}
                  data-timeline-entry={entry.id}
                  data-timeline-label={entryLabel(entry)}
                >
                  <div class="vt">
                    <b>{label}</b>
                    <small>{ago}</small>
                  </div>
                  {isLive ? (
                    <span class="chip chip-ok">
                      <span class="dot" />
                      Live
                    </span>
                  ) : (
                    <div class="acts">
                      <Button variant="ghost" size="sm" data-timeline-action="preview">
                        Preview
                      </Button>
                      <Button variant="secondary" size="sm" data-timeline-action="restore">
                        Restore
                      </Button>
                    </div>
                  )}
                  <span class="vno">{entryVersionTag(entry)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <form class="snapshot-form" data-timeline-form>
        <input
          type="text"
          class="field"
          name="label"
          placeholder="Save snapshot label…"
          maxlength={200}
          required
        />
        <Button variant="primary" type="submit" size="sm">
          Save snapshot
        </Button>
      </form>

      <section class="preview-card" data-timeline-preview>
        <h2>Preview</h2>
        <p class="empty-preview">
          Click &ldquo;Preview&rdquo; on a timeline entry to see how the site looked then.
        </p>
      </section>
      <script>{raw(inlineScript)}</script>
    </DashboardShell>,
  );
});

export default versionTimeline;
