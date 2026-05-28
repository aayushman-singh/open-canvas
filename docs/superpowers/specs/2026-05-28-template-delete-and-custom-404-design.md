# Personal-Template Delete + Custom 404 Affordance — Design Spec

**Date:** 2026-05-28
**Status:** Approved
**Codebase facts verified against:** `src/routes/dashboard/templates.tsx`, `src/routes/api/custom-templates.ts`, `src/editor/canvas-client.ts`, `src/canvas/page-routing.ts`, `src/canvas/elements/render-utils.ts` (sanitizer reference).

**Anchor note:** Cited line numbers in `canvas-client.ts` may drift slightly; durable anchors: `updatePageSidebar`, `renamePage`, `window.__rev01Modal`. `CUSTOM_404_PAGE_SLUG` at `page-routing.ts:10` is verified current. `CustomTemplateTile` location in `templates.tsx` should be re-located by name if needed.

## WHY

Two unrelated but small UI gaps, bundled into one spec to avoid two near-empty design documents:

1. **Personal templates cannot be deleted from the dashboard.** The DELETE endpoint exists at `src/routes/api/custom-templates.ts:240-261`, fully ownership-gated. Multi-phrased greps confirm no `deleteTemplate / delete-template / data-template-delete / removeTemplate` reference in `src/routes/dashboard/`. The only way to delete a personal template today is `curl`.

2. **A page cannot be marked as the site's 404 from the editor.** The renderer's 404 mechanic uses the magic slug `_404` (`src/canvas/page-routing.ts:10` exports `CUSTOM_404_PAGE_SLUG = '_404'`). The editor's slug-rename pipeline at [canvas-client.ts:1045](src/editor/canvas-client.ts#L1045) derives slug from title via the regex `/[^a-z0-9]+/g` — **which strips underscores**. So an owner who names a page "_404" gets `slug = '404'`, not `'_404'`. There is no path from the editor's UI to produce `slug === '_404'`. The only way to mark a page as the site's 404 today is direct JSON edit of `editableState`.

(The originally-bundled "sign-in link on landing" was dropped: the three existing "Launch dashboard" CTAs trigger the Clerk sign-in redirect for unauthenticated visitors. Adding a separate "Sign in" link is a labeling preference, not a functional gap.)

## Success Criteria

- Owner on `/dashboard/templates` sees a Delete button on each personal-tab tile (`visibility === 'private'`). Community-tab tiles do not show Delete.
- Clicking Delete opens a confirm modal. Confirming sends `DELETE /api/custom-templates/{id}`. On 200, the tile is removed from the DOM; on failure the modal status shows the API error.
- After deleting the last personal template, the personal grid's empty-state node appears (already implemented for the first-time empty case).
- Owner sees a `404` button on each row of the editor page sidebar, between SEO and Del.
- Clicking it marks the page's slug as `_404` and the button becomes pressed (`aria-pressed="true"`, accent-styled). The displayed slug in the row updates to `/_404`.
- Clicking the `404` button on a different page when one page is already `_404` opens a confirm modal naming the current 404 page. On confirm, the slug-switch happens atomically: the old 404 demotes (slug re-derived from its title), the new one becomes `_404`.
- Renaming a page whose slug is `_404` updates only the displayed title; the slug stays `_404`. This guards against accidental demotion via the rename pipeline.
- Clicking 404 on the currently-set 404 page un-sets it (slug re-derived from title).

## Non-Goals

- No "Sign in" link on landing (dropped per push-back).
- No bulk template management (search, multi-select, sort).
- No soft-delete / restore for templates.
- No "are you sure" for the simple toggle-off case (only the conflict-switch case shows a modal).
- No sitemap / robots.txt adjustments from this work.
- No schema changes — both features use existing fields.
- No analytics on template deletes or 404 switches.

## Hard Constraints

- The DELETE custom-templates endpoint is not modified.
- The renderer's 404 path (`isCustom404Page`, `resolvePrimaryPage`) is not modified.
- `page.slug` remains the single source of truth for "is this page the 404." No parallel `is404` boolean.
- Sanitizer behavior in `renamePage` is unchanged; only the call site adds a guard to skip slug rewrite when `page.slug === '_404'`.
- Personal-template Delete UI never renders for community templates.
- The 404 toggle reuses `window.__rev01Modal.confirm` (defined at canvas-client.ts:871 (`window.__rev01Modal`), available in the editor context).

---

## 1. Personal-Template Delete

### 1.1 Per-tile Delete button

Modify `CustomTemplateTile` ([templates.tsx:317](src/routes/dashboard/templates.tsx#L317)). Add a Delete button as the last child of the existing `<span class="template-body">`, positioned absolutely in the bottom-right corner via CSS so it doesn't displace the existing preview + copy layout:

```jsx
{dt.visibility === 'private' ? (
  <button
    type="button"
    class="template-delete"
    data-template-delete={dt.id}
    title={`Delete "${dt.name}"`}
    aria-label={`Delete template ${dt.name}`}
  >
    Delete
  </button>
) : null}
```

Only the private (personal) tiles render the button. Community templates (`visibility === 'global'`) do not.

CSS rule added to `templates.styles.ts`:

```css
.template-delete {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  background: transparent;
  color: var(--rev01-danger, #c0392b);
  border: 1px solid var(--rev01-danger, #c0392b);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
.template-delete:hover {
  background: var(--rev01-danger, #c0392b);
  color: white;
}
```

`--rev01-danger` is a placeholder for whichever danger / red variable the dashboard theme uses; implementation reads the actual variable from `templates.styles.ts` or `shell.tsx`.

### 1.2 Client-side delete handler

Inline `<script>` block in templates.tsx (sibling to whatever client logic already exists; if none, this is the first):

```js
document.addEventListener('click', async (ev) => {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;
  const id = target.getAttribute('data-template-delete');
  if (!id) return;

  // Prefer __rev01Modal if available (editor pages); otherwise fall back
  // to window.confirm so the page works in the dashboard context.
  const modal = (typeof window !== 'undefined' && window.__rev01Modal) || null;
  const ok = modal
    ? await modal.confirm(
        'Delete this template permanently? Sites that used it as a starter are unaffected; only the template entry is removed.',
        { title: 'Delete template', confirmLabel: 'Delete', danger: true }
      )
    : window.confirm(`Delete "${target.title || 'this template'}"? This cannot be undone.`);
  if (!ok) return;

  const resp = await fetch(`/api/custom-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    alert(`Delete failed: ${body?.error || resp.statusText}`);
    return;
  }

  const tile = target.closest('.template');
  if (tile) tile.remove();

  // If the personal grid is now empty, surface the empty-state node.
  const personalGrid = document.querySelector('[data-personal-grid]');
  if (personalGrid && personalGrid.querySelectorAll('.template').length === 0) {
    const empty = document.querySelector('[data-personal-empty]');
    if (empty) empty.hidden = false;
  }
});
```

(The `[data-personal-grid]` and `[data-personal-empty]` attributes are added to the existing parent containers in `templates.tsx` so the JS can find them — small additive markup.)

### 1.3 Auth + ownership

Server endpoint at custom-templates.ts:240-261 already enforces:
- Clerk-authenticated session (`requireAuth()`).
- Ownership check via `customerId` matches plus `visibility === 'private'`.

No new server work.

### 1.4 Edge cases

- Deleting a personal template that is currently selected by the radio input: the tile is removed; the selected radio disappears with it. Owner picks a different template before starting a site. Acceptable for v1.
- A failed DELETE (network error or 404) surfaces via `alert()` because the modal helper has already closed; this is consistent with the existing dashboard's failure handling and meets the all-or-nothing fail-loud requirement.

## 2. Custom 404 Affordance

### 2.1 New 404 toggle in the page sidebar

Modify `updatePageSidebar` at [canvas-client.ts:952 (`updatePageSidebar`)](src/editor/canvas-client.ts#L953-L1004). Insert a button after the SEO link and before the Del button:

```js
var is404 = page.slug === '_404';
var fourOhFourBtn = document.createElement('button');
fourOhFourBtn.type = 'button';
fourOhFourBtn.textContent = '404';
fourOhFourBtn.setAttribute('data-page-action', 'toggle-404');
fourOhFourBtn.setAttribute('data-page-id', page.id);
fourOhFourBtn.setAttribute('aria-pressed', is404 ? 'true' : 'false');
fourOhFourBtn.title = is404
  ? "Site's 404 page — click to unset"
  : "Set as site's 404 page";
if (is404) fourOhFourBtn.classList.add('active');
actions.appendChild(fourOhFourBtn);
```

CSS rule appended to `canvas-styles.ts`:

```css
.rev01-page-item button[data-page-action="toggle-404"] {
  font-size: 11px;
  padding: 2px 6px;
}
.rev01-page-item button[data-page-action="toggle-404"].active {
  background: var(--EDITOR-ACCENT-VAR, #5b8def);
  color: white;
  font-weight: 600;
  border-color: var(--EDITOR-ACCENT-VAR, #5b8def);
}
```

`--EDITOR-ACCENT-VAR` is a placeholder — implementation reads the actual editor accent CSS variable used elsewhere in `canvas-styles.ts`.

### 2.2 Toggle handler `toggle404Page`

Add a new branch to the existing page-action dispatch (the delegated click handler that already routes `data-page-action="rename"` and `data-page-action="delete"` to their respective functions):

```js
} else if (action === 'toggle-404') {
  toggle404Page(pageId);
}
```

```js
async function toggle404Page(pageId) {
  if (!state) return;
  var page = state.pages.find(function (p) { return p.id === pageId; });
  if (!page) return;

  function deriveSlugFromTitle(title, excludePageId) {
    var slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (slug.length === 0) slug = 'page';
    var base = slug;
    var counter = 2;
    while (state.pages.some(function (p) { return p.id !== excludePageId && p.slug === slug; })) {
      slug = base + '-' + counter; counter++;
    }
    return slug;
  }

  if (page.slug === '_404') {
    // Unset: re-derive slug from current title.
    page.slug = deriveSlugFromTitle(page.title, page.id);
  } else {
    // Set: check for an existing 404 page.
    var conflict = state.pages.find(function (p) { return p.id !== pageId && p.slug === '_404'; });
    if (conflict) {
      var ok = await window.__rev01Modal.confirm(
        '"' + conflict.title + '" is currently the 404 page. Switch the 404 to "' + page.title + '"?',
        { title: 'Switch 404 page', confirmLabel: 'Switch' }
      );
      if (!ok) return;
      conflict.slug = deriveSlugFromTitle(conflict.title, conflict.id);
    }
    page.slug = '_404';
  }

  captureForUndo();
  renderAll();
  updatePageSidebar();
  scheduleSave();
  setStatus(
    page.slug === '_404'
      ? '"' + page.title + '" is now the 404 page'
      : '"' + page.title + '" is no longer the 404 page',
    'ok'
  );
}
```

### 2.3 Rename gate — preserve `_404`

Modify `renamePage` at canvas-client.ts:`renamePage` (~1034). Currently:

```js
// derive newSlug from newTitle ...
page.slug = newSlug;
```

Change to:

```js
// derive newSlug from newTitle ...
if (page.slug !== '_404') {
  page.slug = newSlug;
}
page.title = newTitle;  // always update title
```

The 404 page can be renamed (its visible title changes) but the slug stays `_404`. The owner uses the 404 toggle button to demote.

### 2.4 No new schema

`page.slug` is the only mutated field. No `is404` boolean. The renderer's `isCustom404Page` already treats `slug === '_404'` as canonical.

### 2.5 Sitemap and renderer concerns

`resolvePrimaryPage` in `src/canvas/page-routing.ts` already filters `_404` out of the primary-page candidates. The published sitemap emission likely already excludes `_404` (pre-existing renderer concern). If it doesn't, that's a separate bug — out of scope here.

## 3. Testing

### 3.1 Personal-template delete `src/routes/dashboard/templates-delete.smoke.ts`

- Boot templates page authenticated as an owner with 2 personal templates and 6 community templates.
- Assert each personal tile renders `[data-template-delete]`; assert community tiles do NOT.
- Click Delete on personal tile #1. Assert confirm modal appears. Click Confirm.
- Assert `DELETE /api/custom-templates/{id}` fires and returns 200.
- Assert the tile is removed from DOM and the radio for it is gone.
- Reload page. Assert the deleted template does not return.
- Click Delete on the last remaining personal tile and confirm. Assert empty-state node becomes visible.
- Click Delete then Cancel in modal. Assert no DELETE fires.
- Stub the API to return 500. Assert alert surfaces the error message.

### 3.2 404 toggle `src/editor/page-404.smoke.ts`

Fixture state: three pages — Home (`/`), About (`/about`), Custom 404 (`/custom-404`).

- Boot editor; open the page sidebar.
- Assert each row has `[data-page-action="toggle-404"]` with `aria-pressed="false"`.
- Click 404 on "Custom 404". Assert `page.slug === '_404'`, button `aria-pressed="true"`, the row's slug span shows `/_404`.
- Click 404 on "About". Assert confirm modal appears naming "Custom 404". Click Confirm.
- Assert "About"'s slug is `_404` and "Custom 404"'s slug is `custom-404` (derived from its title).
- Rename "About" (now the 404 page) to "Oops Not Found". Assert title updates but slug stays `_404`.
- Click 404 on "About" again to unset. Assert slug becomes `oops-not-found` (sanitized from the new title).

### 3.3 Renderer integration

If `src/routes/public-404.smoke.ts` exists, ensure it still passes; this work doesn't modify the renderer. If it doesn't exist, no new test added in this spec — the renderer behavior is covered by `page-routing.ts` unit tests (if any) and the existing publish path.

## 4. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `window.__rev01Modal` may not be available on the templates dashboard page (it's defined in canvas-client.ts which loads in the editor only). | The delete handler falls back to `window.confirm`. Acceptable for the dashboard. If a project-wide modal helper exists in the dashboard shell, prefer it; otherwise the native confirm is honest enough. |
| Deleting a personal template that's selected as the active radio leaves the form in an inconsistent state. | v1 punts: the tile removes itself; owner picks another. A second-tab race condition is out of scope. |
| The 404 toggle button is rendered inside an already-narrow actions span next to Rename / SEO / Del. | Text "404" is the narrowest reasonable label. CSS `font-size: 11px` keeps it compact. On extremely narrow viewports the actions wrap; acceptable. |
| Conflict modal uses `__rev01Modal.confirm`; in the editor this is always loaded (canvas-client.ts:871 (`window.__rev01Modal`)). | No mitigation — verified call site is editor-only. |
| `renamePage` gate preserves `_404` when the page is renamed. If an owner expects rename to also clear the 404 status, they may be surprised. | Documented behavior. The status text after rename always shows the new title; if the slug stayed `_404` the displayed slug span shows `/_404`, so it's visible. |
| Owner deletes their normal "Home" page while a `_404` page exists; `resolvePrimaryPage` then throws on publish. | Existing gate `if (state.pages.length > 1)` allows delete in this scenario. The renderer's loud failure is the right behavior — publish surfaces the error rather than serving a 404-only site. Out of scope to also gate Delete by "is this the only non-404 page". File as follow-up if owners report. |
| Sanitizer-derived demoted slug may collide with another page's slug, leading to the `-2` suffix appearing without warning. | The numeric suffix is the standard collision resolution already used by `renamePage`. Documented. Owner can rename later if they dislike the suffix. |
| Sub-project E (section inspector) also adds `--EDITOR-ACCENT-VAR` placeholder. Both specs converge on the same variable name at implementation. | Implementation reads the actual variable once and uses it in both places. No spec change needed. |

## 5. Out-of-Scope Follow-Ups

- Bulk template management.
- Template restore / soft-delete.
- "Sign in" link on landing (dropped per push-back).
- Sitemap / robots.txt adjustments related to 404.
- Tooltip in the slug-rename input warning when the typed value sanitizes to a different string (e.g. owner types `_404`, gets `404`).
- Real-time delete event so other tabs see the template disappear immediately.
- Gate `Del` on the last non-404 page.
