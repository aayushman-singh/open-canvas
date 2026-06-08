// src/routes/dashboard/entries.tsx
//
// Dashboard route — GET /dashboard/sites/:siteId/entries
//                   GET /dashboard/sites/:siteId/entries/new?collection=<slug>
//                   GET /dashboard/sites/:siteId/entries/:entryId
//
// ADR 0060 Stream C — CMS-style entries dashboard tab.
//
// The Editor canvas owns shape (template + index pages); this surface owns
// content. Owners pick a collection from the segmented pill, see a table of
// entries (newest first), and create/edit/delete one row at a time. Writes
// go through the REST endpoints defined in Stream A:
//
//   POST   /api/sites/:siteId/entries          — create
//   PATCH  /api/sites/:siteId/entries/:entryId — update
//   DELETE /api/sites/:siteId/entries/:entryId — delete
//
// Collections are derived from two sources:
//   1. Distinct `collection_slug` values already present in this site's
//      `collection_entry` rows.
//   2. Any `pageKind`-marked pages in the site's `editableState.pages[]`
//      (after ADR 0063 F5 this is only `collection-item-template`; the
//      `collection-index` value was retired in favour of element-level
//      `CollectionElement.collectionSlug`). The page's `collectionSlug`
//      still names the bound collection for the template page.
//
// When neither source produces a collection, we render an empty state telling
// the Owner to add a Collection element (via the editor's Add sidebar) and
// bind it to a slug in the inspector.
//
// Open Canvas chrome — `.entries-toolbar`, `.entries-table`, `.entry-form`
// live in `pageStyles` and reuse the existing CSS tokens (`var(--ink)`,
// `var(--surface)`, `var(--r)`, `var(--shadow-sm)`).

import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';

import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { CanvasPage, EditableSite } from '../../canvas/schema';
import { db } from '../../db/client';
import {
  collectionEntry,
  site,
  type CollectionEntry,
  type CollectionEntryStatus,
} from '../../db/schema';

import { DashboardShell, buildSiteNav } from './shell';
import { readThemeCookie } from '../../ui';
import { EDITOR_CLIENT_MANIFEST } from '../../_assets/manifest.generated';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const entriesDashboardRoute = new Hono<Env>();
entriesDashboardRoute.use('*', clerkAuth());
entriesDashboardRoute.use('*', requireAuth());

// --------------------------------------------------------------------------
// Styles — Open Canvas chrome for the Entries surface. Keeps the route
// self-contained the same way forms-inbox does; tokens come from theme.css.
// --------------------------------------------------------------------------
const pageStyles = `
  .content > h1 { font-size: 32px; letter-spacing: -.03em; }
  .content > .sub { color: var(--ink-2); margin: 6px 0 28px; }

  .entries-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }
  .entries-toolbar .sp { flex: 1; }
  .entries-toolbar .formsel {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
  }
  .entries-toolbar .formsel a {
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
  .entries-toolbar .formsel a.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-sm);
  }

  .entries-table {
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }
  .entries-table .et-head {
    display: grid;
    grid-template-columns: 1.4fr 1fr 110px 110px 130px 130px 40px;
    gap: 16px;
    padding: 12px 20px;
    background: var(--surface-2);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .entries-table .et-row {
    display: grid;
    grid-template-columns: 1.4fr 1fr 110px 110px 130px 130px 40px;
    gap: 16px;
    align-items: center;
    padding: 14px 20px;
    border-top: 1px solid var(--line);
    transition: background .12s;
  }
  .entries-table .et-row:hover { background: var(--surface-2); }
  .entries-table .et-row .row-main {
    display: contents;
    color: inherit;
    text-decoration: none;
  }
  .entries-table .et-row .et-title b {
    font-size: 14px;
    color: var(--ink);
  }
  .entries-table .et-row .et-slug {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entries-table .et-row .et-date {
    font-size: 13px;
    color: var(--ink-2);
  }
  .entries-table .et-row .et-updated {
    font-size: 12.5px;
    color: var(--ink-3);
  }
  .entries-table .et-row .et-folder {
    font-size: 13px;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entries-table .et-row .et-folder.is-empty { color: var(--ink-3); }

  /* ADR 0063 dec 7 — folder filter chip row above the list table. Sits
     between the collection pill row and the table, mirroring the .formsel
     pill chrome but in a less-emphatic shape so the two filter rows do not
     visually compete. */
  .folder-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    padding: 4px 0;
    font-family: var(--sans);
    font-size: 12.5px;
  }
  .folder-chips .lbl {
    color: var(--ink-3);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 11px;
    margin-right: 4px;
  }
  .folder-chips a {
    display: inline-flex;
    align-items: center;
    padding: 5px 12px;
    border-radius: var(--r-pill);
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink-2);
    text-decoration: none;
    font-weight: 600;
    transition: background .12s, color .12s, border-color .12s;
  }
  .folder-chips a:hover { background: var(--surface-3); color: var(--ink); }
  .folder-chips a.on {
    background: var(--red-soft);
    color: var(--red-ink);
    border-color: var(--red-soft);
  }
  .folder-chips a.ungrouped { font-style: italic; }

  .status-pill {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    font-size: 11.5px;
    font-weight: 700;
    border-radius: var(--r-pill);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .status-pill.draft {
    background: var(--surface-2);
    color: var(--ink-2);
    border: 1px solid var(--line);
  }
  .status-pill.published {
    background: var(--red-soft);
    color: var(--red-ink);
    border: 1px solid var(--red-soft);
  }

  .et-delete {
    background: transparent;
    border: none;
    color: var(--ink-3);
    cursor: pointer;
    padding: 6px;
    border-radius: var(--r-sm);
    display: flex;
    justify-content: flex-end;
    transition: color .12s, background .12s;
  }
  .et-delete:hover { color: var(--red-ink); background: var(--surface-3); }

  .empty {
    padding: 28px 20px;
    text-align: center;
    color: var(--ink-3);
    font-size: 14px;
  }

  .entry-form {
    display: grid;
    gap: 16px;
    max-width: 760px;
  }
  .entry-form label {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .entry-form label > span {
    font-weight: 600;
  }
  .entry-form input[type="text"],
  .entry-form input[type="date"],
  .entry-form select,
  .entry-form textarea {
    border: 1.5px solid var(--line-2);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--ink);
    padding: 10px 12px;
    font: inherit;
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .entry-form input:focus,
  .entry-form select:focus,
  .entry-form textarea:focus {
    border-color: var(--red);
    box-shadow: var(--ring);
  }
  .entry-form textarea { resize: vertical; font-family: var(--mono); font-size: 13px; }
  .entry-form .row-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .entry-form .ro {
    color: var(--ink-3);
    font-family: var(--mono);
    font-size: 13px;
    padding: 9px 12px;
    background: var(--surface-2);
    border: 1px dashed var(--line);
    border-radius: var(--r-sm);
  }
  .entry-form .actions {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 6px;
  }
  .entry-form .actions .sp { flex: 1; }
  .entry-form .msg {
    min-height: 20px;
    font-size: 13px;
  }
  .entry-form .msg.err { color: var(--red-ink); }
  .entry-form .msg.ok { color: var(--ink-2); }
`;

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

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

interface OwnedSite {
  id: string;
  name: string;
  editableState: EditableSite;
}

async function lookupOwnedSite(
  env: Bindings,
  customerId: string,
  siteId: string,
): Promise<OwnedSite | null> {
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

/**
 * Derives the set of collections for this site from two sources:
 *   1. Distinct `collection_slug` values present in the entries table.
 *   2. Any `pageKind`-marked pages in `EditableSite.pages` that carry a
 *      `collectionSlug`.
 * Result is ordered alphabetically and de-duplicated.
 */
function deriveCollections(
  pages: CanvasPage[],
  entrySlugs: string[],
): string[] {
  const set = new Set<string>();
  for (const page of pages) {
    if (page.pageKind && page.collectionSlug) {
      set.add(page.collectionSlug);
    }
  }
  for (const slug of entrySlugs) set.add(slug);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
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

// --------------------------------------------------------------------------
// Icons
// --------------------------------------------------------------------------

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

// --------------------------------------------------------------------------
// View components — exported so the smoke test can render them directly
// without spinning up the full Hono request lifecycle.
// --------------------------------------------------------------------------

// ADR 0063 dec 7 — folder filter state on the list view.
//   * `activeFolder = undefined` → "All" chip selected, show every entry.
//   * `activeFolder = null`      → "Ungrouped" chip selected, show only
//                                  rows whose `folder` column IS NULL.
//   * `activeFolder = <string>`  → exact-match chip selected.
// The view derives the chip list itself from `entries` (see comment in
// the route handler — we already load every entry for the collection, so a
// client-side `Set<>` is strictly cheaper than a second query).
export type FolderFilter = string | null | undefined;

export interface EntriesListViewProps {
  siteId: string;
  siteName: string;
  collections: string[];
  activeCollection: string | null;
  activeFolder: FolderFilter;
  entries: CollectionEntry[];
}

export function EntriesListView({
  siteId,
  siteName,
  collections,
  activeCollection,
  activeFolder,
  entries,
}: EntriesListViewProps) {
  if (collections.length === 0) {
    return (
      <>
        <div class="entries-toolbar">
          <h1 style="margin:0;font-size:32px;letter-spacing:-.03em;">Entries</h1>
          <div class="sp" />
          <button type="button" class="btn btn-primary btn-sm" data-new-collection>
            <PlusIcon />
            New collection
          </button>
        </div>
        <p class="sub">
          Content collections for <b>{siteName}</b>.
        </p>
        <div class="entries-table">
          <div class="empty">
            No collections yet. Click <b>+ New collection</b> above to
            scaffold an index page, a template page, and a sample entry —
            ready to publish.
          </div>
        </div>
      </>
    );
  }

  const current = activeCollection ?? collections[0]!;
  const newHref = `/dashboard/sites/${esc(siteId)}/entries/new?collection=${encodeURIComponent(current)}`;

  // ADR 0063 dec 7 — distinct folder values for the chip row are derived
  // client-side from the `entries` array we already loaded. The brief
  // permits either an API aggregation (`?folders=true`) or this in-process
  // derivation; we picked the latter because the dashboard route always
  // hydrates the full collection's entries to render the table, so a second
  // query would be pure overhead. Trade-off: a folder that has no entries
  // never appears as a chip. That matches the Owner's mental model — if
  // there are no entries in a folder, there is nothing to filter to.
  const folderSet = new Set<string>();
  let hasUngrouped = false;
  for (const e of entries) {
    if (e.folder === null) hasUngrouped = true;
    else folderSet.add(e.folder);
  }
  const folderChips = Array.from(folderSet).sort((a, b) => a.localeCompare(b));

  // Apply the folder filter to the visible rows. The route handler already
  // loaded the full collection (so distinct-folder derivation is cheap);
  // the narrowing here keeps the visible rows in sync with the chip
  // selection without an extra query.
  const visibleEntries = entries.filter((e) => {
    if (activeFolder === undefined) return true;
    if (activeFolder === null) return e.folder === null;
    return e.folder === activeFolder;
  });

  // Chip hrefs share the active collection but vary the `folder` param:
  //   * All       → ?collection=<slug>            (folder param absent)
  //   * Ungrouped → ?collection=<slug>&folder=    (empty value = IS NULL)
  //   * <name>    → ?collection=<slug>&folder=<name>
  const collectionParam = `?collection=${encodeURIComponent(current)}`;
  const listBase = `/dashboard/sites/${esc(siteId)}/entries`;

  return (
    <>
      <div class="entries-toolbar">
        <h1 style="margin:0;font-size:32px;letter-spacing:-.03em;">Entries</h1>
        <div class="sp" />
        <button type="button" class="btn btn-outline btn-sm" data-new-collection>
          <PlusIcon />
          New collection
        </button>
        <a href={newHref} class="btn btn-primary btn-sm">
          <PlusIcon />
          New entry
        </a>
      </div>
      <p class="sub">
        Content collections for <b>{siteName}</b>. Pick a collection, then
        add, edit or delete entries.
      </p>

      <div class="entries-toolbar">
        <div class="formsel" role="tablist" aria-label="Collections">
          {collections.map((slug) => (
            <a
              href={`${listBase}?collection=${encodeURIComponent(slug)}`}
              class={slug === current ? 'on' : ''}
            >
              {slug}
            </a>
          ))}
        </div>
      </div>

      {folderChips.length > 0 || hasUngrouped ? (
        <div
          class="folder-chips"
          role="tablist"
          aria-label="Filter by folder"
          data-folder-chips
        >
          <span class="lbl">Folder</span>
          <a
            href={`${listBase}${collectionParam}`}
            class={activeFolder === undefined ? 'on' : ''}
            data-folder-chip="all"
          >
            All
          </a>
          {hasUngrouped ? (
            <a
              href={`${listBase}${collectionParam}&folder=`}
              class={`ungrouped${activeFolder === null ? ' on' : ''}`}
              data-folder-chip=""
            >
              Ungrouped
            </a>
          ) : null}
          {folderChips.map((f) => (
            <a
              href={`${listBase}${collectionParam}&folder=${encodeURIComponent(f)}`}
              class={activeFolder === f ? 'on' : ''}
              data-folder-chip={f}
            >
              {f}
            </a>
          ))}
        </div>
      ) : null}

      <div
        class="entries-table"
        data-collection={current}
        data-active-folder={
          activeFolder === undefined
            ? ''
            : activeFolder === null
            ? '__ungrouped__'
            : activeFolder
        }
      >
        <div class="et-head">
          <span>Title</span>
          <span>Slug</span>
          <span>Status</span>
          <span>Folder</span>
          <span>Published</span>
          <span>Updated</span>
          <span></span>
        </div>
        {visibleEntries.length === 0 ? (
          <div class="empty">
            {activeFolder === undefined ? (
              <>
                No entries in <b>{current}</b> yet. Click <b>+ New entry</b>{' '}
                to write the first one.
              </>
            ) : activeFolder === null ? (
              <>
                No ungrouped entries in <b>{current}</b>. Every entry is in a
                folder — pick a folder chip above, or set one on the entry
                form.
              </>
            ) : (
              <>
                No entries in folder <b>{activeFolder}</b>. Pick another
                folder chip above, or clear the filter to see all entries.
              </>
            )}
          </div>
        ) : (
          visibleEntries.map((entry) => (
            <div class="et-row" data-entry-id={entry.id} data-entry-folder={entry.folder ?? ''}>
              <a
                class="row-main"
                href={`/dashboard/sites/${esc(siteId)}/entries/${esc(entry.id)}`}
              >
                <div class="et-title">
                  <b>{entry.title}</b>
                </div>
                <div class="et-slug">{entry.collectionSlug}/{entry.slug}</div>
                <div>
                  <span class={`status-pill ${entry.status}`}>{entry.status}</span>
                </div>
                <div class={`et-folder${entry.folder === null ? ' is-empty' : ''}`}>
                  {entry.folder ?? '—'}
                </div>
                <div class="et-date">{entry.publishedDate}</div>
                <div class="et-updated">{relativeWhen(entry.updatedAt)}</div>
              </a>
              <button
                type="button"
                class="et-delete"
                data-delete-entry={entry.id}
                data-entry-title={entry.title}
                aria-label={`Delete entry ${entry.title}`}
                title="Delete entry"
              >
                <TrashIcon />
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}

export interface EntryFormViewProps {
  siteId: string;
  siteName: string;
  mode: 'new' | 'edit';
  entry: {
    id: string | null;
    collectionSlug: string;
    slug: string;
    title: string;
    excerpt: string;
    body: string;
    publishedDate: string;
    author: string;
    category: string;
    tags: string[];
    status: CollectionEntryStatus;
    // ADR 0063 dec 7 — `null` = ungrouped (empty input). On submit the
    // client serialises empty string → null so the API write boundary
    // never sees a synonym for "no folder."
    folder: string | null;
  };
}

export function EntryFormView({ siteId, siteName, mode, entry }: EntryFormViewProps) {
  const isEdit = mode === 'edit';
  const heading = isEdit ? `Edit entry` : 'New entry';
  const listHref = `/dashboard/sites/${esc(siteId)}/entries?collection=${encodeURIComponent(entry.collectionSlug)}`;

  return (
    <>
      <div class="entries-toolbar">
        <h1 style="margin:0;font-size:32px;letter-spacing:-.03em;">{heading}</h1>
        <div class="sp" />
        <a href={listHref} class="btn btn-outline btn-sm">
          Back to {entry.collectionSlug}
        </a>
      </div>
      <p class="sub">
        {isEdit ? (
          <>
            Editing <b>{entry.title}</b> in <b>{siteName}</b> /{' '}
            <code>{entry.collectionSlug}</code>.
          </>
        ) : (
          <>
            Creating a new entry in <b>{siteName}</b> /{' '}
            <code>{entry.collectionSlug}</code>.
          </>
        )}
      </p>

      <form
        class="entry-form"
        id="entry-form"
        data-site-id={siteId}
        data-mode={mode}
        data-entry-id={entry.id ?? ''}
        autocomplete="off"
      >
        <label>
          <span>Collection</span>
          <div class="ro">{entry.collectionSlug}</div>
          <input type="hidden" name="collectionSlug" value={entry.collectionSlug} />
        </label>

        <label>
          <span>Title</span>
          <input
            type="text"
            name="title"
            value={entry.title}
            required
            maxlength={200}
            placeholder="e.g. Shipping CMS entries"
          />
        </label>

        <label>
          <span>Slug</span>
          <input
            type="text"
            name="slug"
            value={entry.slug}
            required
            maxlength={120}
            placeholder="auto-suggested from title"
          />
        </label>

        <label>
          <span>Excerpt</span>
          <textarea name="excerpt" rows={4} maxlength={1000} placeholder="Short summary that appears in the index list.">{raw(esc(entry.excerpt))}</textarea>
        </label>

        <label>
          <span>Body (Markdown)</span>
          <textarea name="body" rows={14} placeholder="# Heading&#10;Markdown body...">{raw(esc(entry.body))}</textarea>
        </label>

        <div class="row-2">
          <label>
            <span>Published date</span>
            <input
              type="date"
              name="publishedDate"
              value={entry.publishedDate}
              required
            />
          </label>
          <label>
            <span>Status</span>
            <select name="status">
              <option value="draft" selected={entry.status === 'draft'}>
                Draft
              </option>
              <option value="published" selected={entry.status === 'published'}>
                Published
              </option>
            </select>
          </label>
        </div>

        <div class="row-2">
          <label>
            <span>Author</span>
            <input type="text" name="author" value={entry.author} maxlength={200} />
          </label>
          <label>
            <span>Category</span>
            <input type="text" name="category" value={entry.category} maxlength={100} />
          </label>
        </div>

        <label>
          <span>Tags (comma-separated)</span>
          <input
            type="text"
            name="tags"
            value={entry.tags.join(', ')}
            placeholder="launch, design, case-study"
          />
        </label>

        {/* ADR 0063 dec 7 — folder input. Empty = ungrouped (null). The
            client script serialises `''` → `null` before posting so the API
            never sees the empty-string-as-synonym case. Validation feedback
            renders in the shared `.msg` area below the action buttons. */}
        <label>
          <span>Folder (optional)</span>
          <input
            type="text"
            name="folder"
            value={entry.folder ?? ''}
            maxlength={64}
            placeholder="e.g. tech, design — leave empty for ungrouped"
            data-folder-input
          />
        </label>

        <div class="actions">
          <button type="submit" class="btn btn-primary">
            {isEdit ? 'Save changes' : 'Create entry'}
          </button>
          {isEdit ? (
            <a href={listHref} class="btn btn-outline">
              Cancel
            </a>
          ) : null}
          <div class="sp" />
        </div>
        <p class="msg" data-form-msg role="status" aria-live="polite"></p>
      </form>
    </>
  );
}

// --------------------------------------------------------------------------
// Client boot — ADR 0021 migration. The three inline `<script>` blocks
// (listClientScript + two formClientScript emissions) collapsed into the
// shared dashboard bundle (`EDITOR_CLIENT_MANIFEST.dashboardClientUrl`).
// The route emits a tiny boot blob with `route: 'entries'` and the
// per-request `siteId`; the bundle's dispatcher reads it and calls
// `mountEntries()`. DOM contract unchanged (`form#entry-form`,
// `ul.entries-list` + per-row hooks `[data-new-collection]`,
// `[data-delete-entry]`, `[data-entry-id]`, `[data-entry-title]`,
// `[data-form-msg]`, `[data-folder-input]`, the form's `data-mode` +
// `data-entry-id` attributes, and the named form inputs). API contract
// unchanged (POST `/api/sites/:siteId/entries`, PATCH
// `/api/sites/:siteId/entries/:id`, DELETE
// `/api/sites/:siteId/entries/:id`, POST `/api/sites/:siteId/collections`).
// `siteId` flows through the boot blob via `JSON.stringify`, so quotes /
// braces in the value cannot break out of the inline script.
function clientBoot(siteId: string) {
  return raw(
    '<script>window.__opencanvasDashboardBoot = ' +
      JSON.stringify({ route: 'entries', siteId }) +
      ';</script>' +
      '<script src="' +
      EDITOR_CLIENT_MANIFEST.dashboardClientUrl +
      '" defer></script>',
  );
}

// Legacy `formClientScript(siteId)` and `listClientScript(siteId)` exports
// removed in the ADR 0021 migration — their three IIFE emissions moved
// verbatim into `mountEntries()` in src/dashboard-client/entries.ts (with
// the kebab + validateFolder + slugify helpers preserved inline so the
// smoke can pin them as source-level invariants). Same DOM hooks, same
// fetch URLs, same event handlers; the deletion is mechanical.

// --------------------------------------------------------------------------
// Route handlers
// --------------------------------------------------------------------------

entriesDashboardRoute.get('/sites/:siteId/entries', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('entries route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) return c.text('site not found', 404);
  const customerId = c.get('customer')?.id;
  if (!customerId) return c.text('site not found', 404);
  const owned = await lookupOwnedSite(c.env, customerId, siteId);
  if (!owned) return c.text('site not found', 404);

  const database = db(c.env);

  // Distinct collection_slug values for this site. Drizzle's
  // `selectDistinct` would also work; a `groupBy` produces the same plan and
  // keeps the import surface minimal.
  const slugRows = await database
    .select({ collectionSlug: collectionEntry.collectionSlug })
    .from(collectionEntry)
    .where(eq(collectionEntry.siteId, siteId))
    .groupBy(collectionEntry.collectionSlug)
    .orderBy(asc(collectionEntry.collectionSlug));
  const entrySlugs = slugRows.map((r) => r.collectionSlug);

  const collections = deriveCollections(owned.editableState.pages, entrySlugs);

  // Active collection — query string `?collection=` wins, then first entry,
  // then the first derived collection. Null when the site has none.
  const requested = c.req.query('collection');
  const active =
    requested && collections.includes(requested)
      ? requested
      : collections[0] ?? null;

  // ADR 0063 dec 7 — folder filter. Query-string semantics mirror the API:
  //   * `?folder` absent             → activeFolder = undefined ("All")
  //   * `?folder=`     (empty value) → activeFolder = null      ("Ungrouped")
  //   * `?folder=<v>`  (non-empty)   → activeFolder = '<v>'
  // We accept the request shape liberally on the dashboard — the API write
  // boundary still rejects malformed folders loudly. An invalid filter value
  // here just renders an empty list; that's a "no entries match" UX, not
  // an error worth surfacing in the page chrome.
  const folderQuery = c.req.query('folder');
  const activeFolder: FolderFilter =
    folderQuery === undefined ? undefined : folderQuery.length === 0 ? null : folderQuery;

  const entries: CollectionEntry[] = active
    ? await database
        .select()
        .from(collectionEntry)
        .where(
          and(
            eq(collectionEntry.siteId, siteId),
            eq(collectionEntry.collectionSlug, active),
          ),
        )
        .orderBy(desc(collectionEntry.publishedDate))
    : [];

  // Per-Owner HTML — never let shared caches store it. `max-age=0` keeps
  // disk-cache hits cheap on back-button + reload but the must-revalidate
  // forces the browser to recheck freshness before showing stale content.
  c.header('Cache-Control', 'private, max-age=0, must-revalidate');
  return c.html(
    <DashboardShell
      title={`${owned.name} — entries`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${esc(siteId)}/edit`, label: owned.name },
        { label: 'Entries' },
      ]}
      siteNav={buildSiteNav(siteId, owned.name, `/dashboard/sites/${siteId}/entries`)}
      pageStyles={pageStyles}
      theme={readThemeCookie(c)}
    >
      <EntriesListView
        siteId={siteId}
        siteName={owned.name}
        collections={collections}
        activeCollection={active}
        activeFolder={activeFolder}
        entries={entries}
      />
      {clientBoot(siteId)}
    </DashboardShell>,
  );
});

entriesDashboardRoute.get('/sites/:siteId/entries/new', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('entries route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) return c.text('site not found', 404);
  const customerId = c.get('customer')?.id;
  if (!customerId) return c.text('site not found', 404);
  const owned = await lookupOwnedSite(c.env, customerId, siteId);
  if (!owned) return c.text('site not found', 404);

  const database = db(c.env);
  const slugRows = await database
    .select({ collectionSlug: collectionEntry.collectionSlug })
    .from(collectionEntry)
    .where(eq(collectionEntry.siteId, siteId))
    .groupBy(collectionEntry.collectionSlug);
  const collections = deriveCollections(
    owned.editableState.pages,
    slugRows.map((r) => r.collectionSlug),
  );

  const requested = c.req.query('collection');
  const collection =
    requested && collections.includes(requested)
      ? requested
      : collections[0];
  if (!collection) {
    // No collections to write into — bounce back to the list page, which
    // shows the empty-state hint.
    return c.redirect(`/dashboard/sites/${siteId}/entries`);
  }

  // Default the published date to today so the form is immediately valid.
  const today = new Date().toISOString().slice(0, 10);

  return c.html(
    <DashboardShell
      title={`${owned.name} — new entry`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${esc(siteId)}/edit`, label: owned.name },
        { href: `/dashboard/sites/${esc(siteId)}/entries`, label: 'Entries' },
        { label: 'New entry' },
      ]}
      siteNav={buildSiteNav(siteId, owned.name, `/dashboard/sites/${siteId}/entries`)}
      pageStyles={pageStyles}
      theme={readThemeCookie(c)}
    >
      <EntryFormView
        siteId={siteId}
        siteName={owned.name}
        mode="new"
        entry={{
          id: null,
          collectionSlug: collection,
          slug: '',
          title: '',
          excerpt: '',
          body: '',
          publishedDate: today,
          author: '',
          category: '',
          tags: [],
          status: 'draft',
          folder: null,
        }}
      />
      {clientBoot(siteId)}
    </DashboardShell>,
  );
});

entriesDashboardRoute.get('/sites/:siteId/entries/:entryId', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('entries route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  const entryId = c.req.param('entryId');
  if (!siteId || !entryId) return c.text('entry not found', 404);
  const customerId = c.get('customer')?.id;
  if (!customerId) return c.text('site not found', 404);
  const owned = await lookupOwnedSite(c.env, customerId, siteId);
  if (!owned) return c.text('site not found', 404);

  const database = db(c.env);
  const rows = await database
    .select()
    .from(collectionEntry)
    .where(
      and(eq(collectionEntry.siteId, siteId), eq(collectionEntry.id, entryId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return c.text('entry not found', 404);

  return c.html(
    <DashboardShell
      title={`${owned.name} — ${row.title}`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${esc(siteId)}/edit`, label: owned.name },
        {
          href: `/dashboard/sites/${esc(siteId)}/entries?collection=${encodeURIComponent(row.collectionSlug)}`,
          label: 'Entries',
        },
        { label: row.title },
      ]}
      siteNav={buildSiteNav(siteId, owned.name, `/dashboard/sites/${siteId}/entries`)}
      pageStyles={pageStyles}
      theme={readThemeCookie(c)}
    >
      <EntryFormView
        siteId={siteId}
        siteName={owned.name}
        mode="edit"
        entry={{
          id: row.id,
          collectionSlug: row.collectionSlug,
          slug: row.slug,
          title: row.title,
          excerpt: row.excerpt,
          body: row.body,
          publishedDate: row.publishedDate,
          author: row.author,
          category: row.category,
          tags: row.tags,
          status: row.status,
          folder: row.folder,
        }}
      />
      {clientBoot(siteId)}
    </DashboardShell>,
  );
});

export default entriesDashboardRoute;
