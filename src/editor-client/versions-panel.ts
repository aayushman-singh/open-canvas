// src/editor-client/versions-panel.ts
//
// ADR 0058 Phase 2q.j — sidebar Versions tab + tab-switching helper.
// canvas-client.ts:13625-13645 (activateSidebarTab),
// canvas-client.ts:13652-13681 (ensureVersionsTabMounted),
// canvas-client.ts:13683-13691 (formatVersionDate),
// canvas-client.ts:13693-13911 (renderVersionsPanel) carry the inline
// twins. All retire on ADR 0015 Phase 3 atomic cutover; until then,
// the inline IIFE is the production source-of-truth and this module
// is dead code.
//
// activateSidebarTab is co-located here (not in a dedicated sidebar
// module) because the only tab that does meaningful work on
// activation is "versions" → renderVersionsPanel; the other two
// branches (`sections` → ensureSectionsPanelLoaded, `pages` →
// updatePageSidebar) are forward calls into ctx that the versions
// panel already imports through ctx.
//
// Four functions live here:
//
//   - activateSidebarTabImpl(ctx, tabName) — toggle the active class +
//     aria-selected on tab buttons, flip the `hidden` flag on panels,
//     and dispatch the tab's lazy-load (sections / versions / pages).
//
//   - ensureVersionsTabMountedImpl(ctx) — lazy-mount the Versions tab
//     button + panel onto the sidebar. Idempotent — returns the
//     existing panel if already mounted. Returns null when the sidebar
//     itself hasn't been cached.
//
//   - formatVersionDate(iso) — human-readable timestamp for snapshot
//     entries. Pure helper, no ctx — exported for tests but the IIFE
//     twin uses it as a closure-local. Format: "Mon D, h:mma" in the
//     browser's local timezone.
//
//   - renderVersionsPanelImpl(ctx) — render the Versions panel body:
//     "Save snapshot" button + per-snapshot row with restore / delete
//     actions. First call kicks the GET + renders a "Loading..."
//     placeholder; subsequent calls render synchronously from
//     ctx.versionsList. The snapshot reason field switches between
//     "vN" (publish-anchored) and "manual" (user-saved) badges.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type {
  DomContext,
  EditorContext,
  PersistContext,
  StatusEmitterContext,
} from './editor-context.js';

interface VersionSnapshot {
  id: string;
  capturedAt: string;
  reason?: string;
  publishedVersion?: number;
  label?: string;
}

// ADR 0064 — activateSidebarTab touches one canonical cluster
// (DomContext for the sidebar root) plus three lazy-load verbs that no
// canonical alias owns yet; the inline `Pick` declares those honestly.
export type ActivateSidebarTabContext = DomContext &
  Pick<
    EditorContext,
    'ensureSectionsPanelLoaded' | 'renderVersionsPanel' | 'updatePageSidebar'
  >;

// ADR 0064 — ensureVersionsTabMounted touches the sidebar DOM ref and
// dispatches the tab activation verb; the two-verb `Pick` rides alone
// because no canonical alias owns either field yet.
export type EnsureVersionsTabMountedContext = DomContext &
  Pick<EditorContext, 'activateSidebarTab'>;

// ADR 0064 — renderVersionRow is the per-snapshot row renderer; it
// rides PersistContext (authFetch + apiBase + siteId for the
// restore/delete network calls), StatusEmitterContext for the result
// toasts, plus the confirm-modal verb, the versions-cache invalidation
// pair, and the parent re-render dispatch.
export type RenderVersionRowContext = PersistContext &
  StatusEmitterContext &
  Pick<
    EditorContext,
    'openConfirmModal' | 'versionsLoaded' | 'renderVersionsPanel'
  >;

// ADR 0064 — renderVersionsPanel extends the row surface with the
// lazy-mount lookup, the snapshot-label prompt, and read access to
// the versions list (the cache flag + re-render are already in
// RenderVersionRowContext).
export type RenderVersionsPanelContext = RenderVersionRowContext &
  Pick<
    EditorContext,
    'ensureVersionsTabMounted' | 'openTextModal' | 'versionsList'
  >;

export function activateSidebarTabImpl(
  ctx: ActivateSidebarTabContext,
  tabName: string,
): void {
  const tabButtons = ctx.sidebar
    ? ctx.sidebar.querySelectorAll('[data-sidebar-tab]')
    : ([] as unknown as NodeListOf<Element>);
  const panels = ctx.sidebar
    ? ctx.sidebar.querySelectorAll('[data-sidebar-panel]')
    : ([] as unknown as NodeListOf<Element>);
  tabButtons.forEach((button) => {
    const isActive = button.getAttribute('data-sidebar-tab') === tabName;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  panels.forEach((p) => {
    (p as HTMLElement).hidden = p.getAttribute('data-sidebar-panel') !== tabName;
  });
  if (tabName === 'sections') {
    void ctx.ensureSectionsPanelLoaded();
  }
  if (tabName === 'versions') {
    ctx.renderVersionsPanel();
  }
  if (tabName === 'pages') {
    ctx.updatePageSidebar();
  }
}

export function ensureVersionsTabMountedImpl(
  ctx: EnsureVersionsTabMountedContext,
): HTMLElement | null {
  if (!ctx.sidebar) return null;
  const tabsRow = ctx.sidebar.querySelector('.opencanvas-sidebar-tabs');
  if (!tabsRow) return null;
  if (ctx.sidebar.querySelector('[data-sidebar-tab="versions"]')) {
    return ctx.sidebar.querySelector<HTMLElement>('[data-sidebar-panel="versions"]');
  }

  const tabButton = document.createElement('button');
  tabButton.type = 'button';
  tabButton.setAttribute('role', 'tab');
  tabButton.setAttribute('aria-selected', 'false');
  tabButton.setAttribute('data-sidebar-tab', 'versions');
  tabButton.textContent = 'Versions';
  tabsRow.appendChild(tabButton);

  const panel = document.createElement('div');
  panel.className = 'opencanvas-sidebar-panel';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-label', 'Versions');
  panel.setAttribute('data-sidebar-panel', 'versions');
  panel.hidden = true;
  ctx.sidebar.appendChild(panel);

  tabButton.addEventListener('click', () => {
    ctx.activateSidebarTab('versions');
  });

  return panel;
}

export function formatVersionDate(iso: string): string {
  const d = new Date(iso);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + h + ':' + m + ampm;
}

export function renderVersionsPanelImpl(ctx: RenderVersionsPanelContext): void {
  const panel = ctx.ensureVersionsTabMounted();
  if (!panel) return;
  panel.replaceChildren();

  const group = document.createElement('section');
  group.className = 'opencanvas-sidebar-group';

  const heading = document.createElement('h2');
  heading.textContent = 'Version History';
  group.appendChild(heading);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'opencanvas-sidebar-command';
  saveBtn.textContent = 'Save snapshot';
  saveBtn.style.marginBottom = '12px';
  saveBtn.addEventListener('click', () => {
    void (async () => {
      const label = await ctx.openTextModal({
        title: 'Save snapshot',
        label: 'Snapshot label',
        defaultValue: '',
      });
      if (!label || !label.trim()) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      ctx
        .authFetch(ctx.apiBase + '/sites/' + ctx.siteId + '/snapshots', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: label.trim() }),
        })
        .then((r) => {
          if (!r.ok) {
            return r.json().then((d: { error?: string }) => {
              throw new Error(d.error || 'Failed');
            });
          }
          ctx.setStatus('Snapshot saved', 'ok');
          ctx.versionsLoaded = false;
          ctx.renderVersionsPanel();
          return undefined;
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          ctx.setStatus('Snapshot failed: ' + message, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save snapshot';
        });
    })();
  });
  group.appendChild(saveBtn);

  if (!ctx.versionsLoaded) {
    const loading = document.createElement('p');
    loading.style.opacity = '0.5';
    loading.style.fontSize = '12px';
    loading.textContent = 'Loading versions...';
    group.appendChild(loading);
    panel.appendChild(group);

    ctx
      .authFetch(ctx.apiBase + '/sites/' + ctx.siteId + '/snapshots?limit=30')
      .then(async (r) => {
        // Bug #11: previously this skipped r.ok and forwarded straight to
        // `r.json()`, so a 404 ("site not found" — what the owner-only
        // route returned to collaborators) was silently coerced into an
        // empty `data.items` and rendered as "No snapshots yet." Surface
        // the real failure so the panel + status bar both report it.
        if (!r.ok) {
          const errBody = (await r.json().catch(() => null)) as
            | { error?: string }
            | null;
          const detail = errBody?.error ?? String(r.status);
          throw new Error('versions list failed: ' + detail);
        }
        return r.json() as Promise<{ items?: VersionSnapshot[] }>;
      })
      .then((data: { items?: VersionSnapshot[] }) => {
        ctx.versionsList = data.items || [];
        ctx.versionsLoaded = true;
        ctx.renderVersionsPanel();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        loading.textContent = 'Failed to load versions: ' + message;
        loading.style.color = '#fca5a5';
        ctx.setStatus('Versions: ' + message, 'error');
      });
    return;
  }

  if (ctx.versionsList.length === 0) {
    const empty = document.createElement('p');
    empty.style.opacity = '0.7';
    empty.style.fontSize = '12px';
    empty.textContent = 'No snapshots yet. Publish or save a snapshot.';
    group.appendChild(empty);
    panel.appendChild(group);
    return;
  }

  const list = document.createElement('ul');
  list.style.listStyle = 'none';
  list.style.margin = '0';
  list.style.padding = '0';
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '6px';

  for (let i = 0; i < ctx.versionsList.length; i++) {
    const snap = ctx.versionsList[i] as VersionSnapshot;
    renderVersionRow(ctx, list, snap);
  }

  group.appendChild(list);
  panel.appendChild(group);
}

function renderVersionRow(
  ctx: RenderVersionRowContext,
  list: HTMLElement,
  snap: VersionSnapshot,
): void {
  const li = document.createElement('li');
  li.style.padding = '8px 10px';
  li.style.borderRadius = '6px';
  li.style.background = 'rgba(255,255,255,0.04)';
  li.style.border = '1px solid rgba(255,255,255,0.08)';
  li.style.fontSize = '12px';

  const top = document.createElement('div');
  top.style.display = 'flex';
  top.style.justifyContent = 'space-between';
  top.style.alignItems = 'center';
  top.style.marginBottom = '4px';

  const dateEl = document.createElement('span');
  dateEl.style.color = '#f6f7fb';
  dateEl.style.fontWeight = '500';
  dateEl.textContent = formatVersionDate(snap.capturedAt);
  top.appendChild(dateEl);

  const badge = document.createElement('span');
  badge.style.fontSize = '10px';
  badge.style.padding = '2px 6px';
  badge.style.borderRadius = '4px';
  badge.style.fontWeight = '500';
  if (snap.reason === 'publish') {
    badge.style.background = 'rgba(74,222,128,0.12)';
    badge.style.color = '#4ade80';
    badge.textContent = 'v' + (snap.publishedVersion || '?');
  } else {
    badge.style.background = 'rgba(125,211,252,0.12)';
    badge.style.color = '#7dd3fc';
    badge.textContent = 'manual';
  }
  top.appendChild(badge);
  li.appendChild(top);

  if (snap.label) {
    const labelEl = document.createElement('div');
    labelEl.style.color = '#aeb7c8';
    labelEl.style.fontSize = '11px';
    labelEl.style.marginBottom = '6px';
    labelEl.textContent = snap.label;
    li.appendChild(labelEl);
  }

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '6px';

  const restoreBtn = document.createElement('button');
  restoreBtn.type = 'button';
  restoreBtn.textContent = 'Restore';
  restoreBtn.style.fontSize = '11px';
  restoreBtn.style.padding = '3px 10px';
  restoreBtn.style.borderRadius = '4px';
  restoreBtn.style.border = '1px solid rgba(255,255,255,0.12)';
  restoreBtn.style.background = 'rgba(255,255,255,0.06)';
  restoreBtn.style.color = '#f6f7fb';
  restoreBtn.style.cursor = 'pointer';
  restoreBtn.style.fontFamily = 'inherit';
  restoreBtn.addEventListener('click', () => {
    void (async () => {
      if (
        !(await ctx.openConfirmModal({
          title: 'Restore version',
          message:
            'Restore to this version? Current state will be saved as a snapshot first.',
        }))
      ) {
        return;
      }
      restoreBtn.disabled = true;
      restoreBtn.textContent = 'Restoring...';
      ctx
        .authFetch(
          ctx.apiBase +
            '/sites/' +
            ctx.siteId +
            '/snapshots/' +
            snap.id +
            '/restore',
          { method: 'POST' },
        )
        .then((r) => {
          if (!r.ok) {
            return r.json().then((d: { error?: string }) => {
              throw new Error(d.error || 'Restore failed');
            });
          }
          return r.json();
        })
        .then(() => {
          ctx.setStatus('Restored — reloading editor...', 'ok');
          setTimeout(() => {
            location.reload();
          }, 800);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          ctx.setStatus('Restore failed: ' + message, 'error');
          restoreBtn.disabled = false;
          restoreBtn.textContent = 'Restore';
        });
    })();
  });
  actions.appendChild(restoreBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Delete';
  deleteBtn.style.fontSize = '11px';
  deleteBtn.style.padding = '3px 10px';
  deleteBtn.style.borderRadius = '4px';
  deleteBtn.style.border = '1px solid rgba(255,255,255,0.12)';
  deleteBtn.style.background = 'rgba(255,255,255,0.06)';
  deleteBtn.style.color = '#f6f7fb';
  deleteBtn.style.cursor = 'pointer';
  deleteBtn.style.fontFamily = 'inherit';
  deleteBtn.addEventListener('mouseenter', () => {
    deleteBtn.style.background = 'rgba(248,113,113,0.16)';
    deleteBtn.style.borderColor = 'rgba(248,113,113,0.45)';
    deleteBtn.style.color = '#fca5a5';
  });
  deleteBtn.addEventListener('mouseleave', () => {
    deleteBtn.style.background = 'rgba(255,255,255,0.06)';
    deleteBtn.style.borderColor = 'rgba(255,255,255,0.12)';
    deleteBtn.style.color = '#f6f7fb';
  });
  deleteBtn.addEventListener('click', () => {
    void (async () => {
      if (
        !(await ctx.openConfirmModal({
          title: 'Delete snapshot',
          message:
            'This permanently removes the snapshot. The current state is not affected.',
        }))
      ) {
        return;
      }
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';
      ctx
        .authFetch(
          ctx.apiBase + '/sites/' + ctx.siteId + '/snapshots/' + snap.id,
          { method: 'DELETE' },
        )
        .then((r) => {
          if (!r.ok) {
            return r.json().then((d: { error?: string }) => {
              throw new Error(d.error || 'Delete failed');
            });
          }
          return r.json();
        })
        .then(() => {
          ctx.setStatus('Snapshot deleted', 'ok');
          ctx.versionsLoaded = false;
          ctx.renderVersionsPanel();
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          ctx.setStatus('Delete failed: ' + message, 'error');
          deleteBtn.disabled = false;
          deleteBtn.textContent = 'Delete';
        });
    })();
  });
  actions.appendChild(deleteBtn);

  li.appendChild(actions);
  list.appendChild(li);
}
