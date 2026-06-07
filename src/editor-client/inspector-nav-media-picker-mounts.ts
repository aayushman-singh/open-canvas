// src/editor-client/inspector-nav-media-picker-mounts.ts
//
// ADR 0058 Phase 2h.2.d — nav-link list + media-picker mount functions.
// canvas-client.ts:5643-5776 (mountNavLinks) and canvas-client.ts:7437-7604
// (mountMediaPicker) carry the inline twins; retires on Phase 3 cutover.
// Behavioural parity assertion lives in src/editor/inspector-smoke.ts against
// the production inline path (no DOM in Bun, so this module skips its own
// parity smoke).
//
// Two mounts:
//   - mountNavLinks: per-link card editor for nav elements. Label / Href /
//     Kind selector (internal | external | anchor) with per-kind href
//     validation — anchor targets MUST start with '#', otherwise we revert
//     the input value and surface ctx.setStatus(..., 'error') without
//     mutating the link. Reorder is up/down arrows (no drag handle —
//     nav links flow inside a slot, not at canvas coordinates) hidden
//     when there's only one link, plus a remove button. "Add link"
//     pushes { label: 'New link', href: '/', kind: 'internal' }.
//   - mountMediaPicker: three-row picker UI for media elements. Current
//     thumb + alt + upload button; "Recent in this slot" row pulled from
//     GET /sites/<id>/elements/<id>/history?limit=4; "Your gallery" grid
//     pulled from GET /owner/assets filtered to the current media kind.
//     Selecting a thumb routes through ctx.applyAssetIdToElement;
//     uploading routes through ctx.uploadMediaForElement; the gallery's
//     per-cell delete button routes through ctx.runDeleteAsset. All three
//     refresh paths re-fetch both rows so the picker can't show stale data
//     after a mutation lands.

import type { EditorContext } from './editor-context.js';
import type { NavElement } from '../canvas/elements/nav.js';
import type { MediaElement } from '../canvas/elements/media.js';
import { field, selectInput } from './dom-builders.js';
import { createInspectorEntry } from './inspector-leaf-builders.js';

export function mountNavLinks(
  ctx: EditorContext,
  element: NavElement,
  host: HTMLElement,
): void {
  if (!Array.isArray(element.links)) element.links = [];
  const linkListHost = document.createElement('div');

  function validateNavLinkEdit(kind: string, href: string): boolean {
    if (kind === 'anchor' && (typeof href !== 'string' || href.charAt(0) !== '#')) {
      ctx.setStatus('Anchor targets must start with #.', 'error');
      return false;
    }
    return true;
  }

  function renderLinkList(): void {
    linkListHost.replaceChildren();
    for (let li = 0; li < element.links.length; li++) {
      (function (idx: number) {
        const lnk = element.links[idx]!;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'opencanvas-inspector-remove';
        removeBtn.textContent = '\\u00d7';
        removeBtn.title = 'Remove link';
        removeBtn.setAttribute('aria-label', 'Remove link');
        removeBtn.addEventListener('click', function () {
          element.links.splice(idx, 1);
          renderLinkList();
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        const card = createInspectorEntry('Link ' + (idx + 1), removeBtn);

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.value = lnk.label;
        labelInput.placeholder = 'Label';
        labelInput.addEventListener('change', function () {
          lnk.label = labelInput.value;
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        card.appendChild(field('Label', labelInput));

        const hrefInput = document.createElement('input');
        hrefInput.type = 'text';
        hrefInput.value = lnk.href;
        hrefInput.placeholder = lnk.kind === 'anchor' ? '#section' : (lnk.kind === 'external' ? 'https://...' : '/page');
        hrefInput.addEventListener('change', function () {
          if (!validateNavLinkEdit(lnk.kind, hrefInput.value)) {
            hrefInput.value = lnk.href;
            return;
          }
          lnk.href = hrefInput.value;
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        card.appendChild(field('Href', hrefInput));

        const kindSel = selectInput(['internal', 'external', 'anchor'], lnk.kind);
        kindSel.addEventListener('change', function () {
          if (!validateNavLinkEdit(kindSel.value, lnk.href)) {
            kindSel.value = lnk.kind;
            return;
          }
          lnk.kind = kindSel.value as typeof lnk.kind;
          hrefInput.placeholder = lnk.kind === 'anchor' ? '#section' : (lnk.kind === 'external' ? 'https://...' : '/page');
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        card.appendChild(field('Kind', kindSel));

        // Reorder row. Nav links flow inside a slot rather than sit at
        // individual canvas coordinates, so there's no drag handle on the
        // page — the up/down arrows are the only way to change the on-page
        // link order. Hidden when there's only one link. The remove button
        // lives in the entry header (top-right) via createInspectorEntry.
        if (element.links.length > 1) {
          const actions = document.createElement('div');
          actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

          const upBtn = document.createElement('button');
          upBtn.type = 'button';
          upBtn.textContent = '\\u2191';
          upBtn.title = 'Move link up';
          upBtn.disabled = idx === 0;
          upBtn.addEventListener('click', function () {
            if (idx === 0) return;
            const tmp = element.links[idx - 1]!;
            element.links[idx - 1] = element.links[idx]!;
            element.links[idx] = tmp;
            renderLinkList();
            ctx.rebuildElement(element.id);
            ctx.scheduleSave();
          });
          actions.appendChild(upBtn);

          const downBtn = document.createElement('button');
          downBtn.type = 'button';
          downBtn.textContent = '\\u2193';
          downBtn.title = 'Move link down';
          downBtn.disabled = idx === element.links.length - 1;
          downBtn.addEventListener('click', function () {
            if (idx === element.links.length - 1) return;
            const tmp = element.links[idx + 1]!;
            element.links[idx + 1] = element.links[idx]!;
            element.links[idx] = tmp;
            renderLinkList();
            ctx.rebuildElement(element.id);
            ctx.scheduleSave();
          });
          actions.appendChild(downBtn);
          card.appendChild(actions);
        }

        linkListHost.appendChild(card);
      })(li);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'opencanvas-inspector-add';
    addBtn.textContent = 'Add link';
    addBtn.addEventListener('click', function () {
      element.links.push({ label: 'New link', href: '/', kind: 'internal' });
      renderLinkList();
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    linkListHost.appendChild(addBtn);
  }
  renderLinkList();
  host.appendChild(field('Links', linkListHost));
}

// Logo picker for the nav element. Same shape as mountMediaPicker minus the
// per-slot history row — the nav logo is a single brand asset, not a slot
// that gets swapped across versions. Three sections:
//   Current   — thumb of element.logoAssetId + Upload / Clear actions.
//   Your gallery — filtered to image-kind assets; click to assign.
// Upload routes through ctx.postAssetUpload directly (the typed
// uploadMediaForElement path assumes a MediaElement with .assetId, which
// NavElement is not — postAssetUpload returns { assetId, kind } and we
// assign element.logoAssetId ourselves).
export function mountNavLogo(
  ctx: EditorContext,
  element: NavElement,
  host: HTMLElement,
): void {
  const pickerWrap = document.createElement('div');
  pickerWrap.className = 'media-picker';

  const currentRowLabel = document.createElement('div');
  currentRowLabel.className = 'picker-row-label';
  currentRowLabel.textContent = 'Current';
  pickerWrap.appendChild(currentRowLabel);

  const currentRow = document.createElement('div');
  currentRow.className = 'picker-current-row';
  pickerWrap.appendChild(currentRow);

  const currentAssetId = typeof element.logoAssetId === 'string' ? element.logoAssetId : '';
  let currentThumb = ctx.buildPickerThumb(currentAssetId, currentAssetId, () => {});
  currentRow.appendChild(currentThumb);

  const actionsCol = document.createElement('div');
  actionsCol.className = 'picker-current-actions';
  currentRow.appendChild(actionsCol);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';

  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.textContent = 'Upload logo';
  uploadBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });
  actionsCol.appendChild(uploadBtn);
  actionsCol.appendChild(fileInput);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear';
  clearBtn.title = 'Remove logo';
  clearBtn.addEventListener('click', () => {
    if (typeof element.logoAssetId !== 'string' || element.logoAssetId.length === 0) return;
    delete element.logoAssetId;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
    void refreshAll();
  });
  actionsCol.appendChild(clearBtn);

  const galleryLabel = document.createElement('div');
  galleryLabel.className = 'picker-row-label';
  galleryLabel.textContent = 'Your gallery';
  pickerWrap.appendChild(galleryLabel);

  const galleryGrid = document.createElement('div');
  galleryGrid.className = 'picker-gallery-grid';
  pickerWrap.appendChild(galleryGrid);

  host.appendChild(pickerWrap);

  function refreshCurrentThumb(): void {
    const id = typeof element.logoAssetId === 'string' ? element.logoAssetId : '';
    const nextThumb = ctx.buildPickerThumb(id, id, () => {});
    currentRow.replaceChild(nextThumb, currentThumb);
    currentThumb = nextThumb;
  }

  function assignLogo(nextAssetId: string): void {
    element.logoAssetId = nextAssetId;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
    void refreshAll();
  }

  async function refreshGalleryGrid(): Promise<void> {
    galleryGrid.replaceChildren();
    let entries: Array<{ id?: string; assetId?: string; kind?: string }>;
    try {
      const resp = await ctx.authFetch(ctx.apiBase + '/owner/assets');
      if (!resp.ok) {
        console.error('logo gallery fetch failed', resp.status);
        return;
      }
      const body = (await resp.json()) as {
        assets?: Array<{ id?: string; assetId?: string; kind?: string }>;
      };
      entries = Array.isArray(body.assets)
        ? body.assets.filter((entry) => entry && entry.kind === 'image')
        : [];
    } catch (err) {
      console.error('logo gallery fetch failed', err);
      return;
    }
    const selected = typeof element.logoAssetId === 'string' ? element.logoAssetId : '';
    for (const entry of entries) {
      const assetId = typeof entry.id === 'string' ? entry.id : entry.assetId;
      if (typeof assetId !== 'string' || assetId.length === 0) continue;
      const cell = document.createElement('div');
      cell.className = 'picker-gallery-cell';

      const thumb = ctx.buildPickerThumb(assetId, selected, (id: string) => assignLogo(id));
      cell.appendChild(thumb);

      const delBtn = document.createElement('button');
      delBtn.className = 'picker-delete';
      delBtn.type = 'button';
      delBtn.textContent = 'x';
      delBtn.title = 'Delete asset';
      delBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void ctx.runDeleteAsset(assetId, refreshAll);
      });
      cell.appendChild(delBtn);

      galleryGrid.appendChild(cell);
    }
    if (entries.length === 0) {
      const hint = document.createElement('span');
      hint.style.cssText =
        'font-size:11px;color:var(--opencanvas-fg-faint);font-family:var(--opencanvas-font-mono);grid-column:1/-1;';
      hint.textContent = 'No images yet';
      galleryGrid.appendChild(hint);
    }
  }

  function refreshAll(): Promise<unknown> {
    refreshCurrentThumb();
    return refreshGalleryGrid();
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    ctx.setStatus('Uploading logo…', 'info');
    void ctx
      .postAssetUpload(file, '', element.id)
      .then(({ assetId }) => {
        assignLogo(assetId);
        ctx.setStatus('Logo uploaded', 'ok');
      })
      .catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : 'upload failed';
        ctx.setStatus('Logo upload failed: ' + detail, 'error');
      });
  });

  void refreshGalleryGrid();
}

export function mountNavPrimaryAction(
  ctx: EditorContext,
  element: NavElement,
  host: HTMLElement,
): void {
  const wrap = document.createElement('div');

  function validatePrimaryActionEdit(kind: string, href: string): boolean {
    if (kind === 'anchor' && (typeof href !== 'string' || href.charAt(0) !== '#')) {
      ctx.setStatus('Anchor targets must start with #.', 'error');
      return false;
    }
    return true;
  }

  function renderBody(): void {
    wrap.replaceChildren();
    if (element.primaryAction === undefined) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'opencanvas-inspector-add';
      addBtn.textContent = 'Add primary action';
      addBtn.addEventListener('click', function () {
        element.primaryAction = { label: 'Get started', href: '/', kind: 'internal' };
        renderBody();
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      wrap.appendChild(addBtn);
      return;
    }

    const pa = element.primaryAction;
    const card = document.createElement('div');
    card.className = 'inspector-list-card';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = pa.label;
    labelInput.placeholder = 'Label';
    labelInput.addEventListener('change', function () {
      pa.label = labelInput.value;
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    card.appendChild(field('Label', labelInput));

    const hrefInput = document.createElement('input');
    hrefInput.type = 'text';
    hrefInput.value = pa.href;
    hrefInput.placeholder =
      pa.kind === 'anchor' ? '#section' : pa.kind === 'external' ? 'https://...' : '/page';
    hrefInput.addEventListener('change', function () {
      if (!validatePrimaryActionEdit(pa.kind, hrefInput.value)) {
        hrefInput.value = pa.href;
        return;
      }
      pa.href = hrefInput.value;
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    card.appendChild(field('Href', hrefInput));

    const kindSel = selectInput(['internal', 'external', 'anchor'], pa.kind);
    kindSel.addEventListener('change', function () {
      if (!validatePrimaryActionEdit(kindSel.value, pa.href)) {
        kindSel.value = pa.kind;
        return;
      }
      pa.kind = kindSel.value as typeof pa.kind;
      hrefInput.placeholder =
        pa.kind === 'anchor' ? '#section' : pa.kind === 'external' ? 'https://...' : '/page';
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    card.appendChild(field('Kind', kindSel));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'opencanvas-inspector-remove';
    removeBtn.textContent = '\\u00d7';
    removeBtn.title = 'Remove primary action';
    removeBtn.setAttribute('aria-label', 'Remove primary action');
    removeBtn.addEventListener('click', function () {
      delete element.primaryAction;
      renderBody();
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    card.appendChild(removeBtn);

    wrap.appendChild(card);
  }

  renderBody();
  host.appendChild(field('Primary action', wrap));
}

export function mountMediaPicker(
  ctx: EditorContext,
  element: MediaElement,
  host: HTMLElement,
): void {
  const pickerWrap = document.createElement('div');
  pickerWrap.className = 'media-picker';

  const currentRowLabel = document.createElement('div');
  currentRowLabel.className = 'picker-row-label';
  currentRowLabel.textContent = 'Current';
  pickerWrap.appendChild(currentRowLabel);

  const currentRow = document.createElement('div');
  currentRow.className = 'picker-current-row';
  pickerWrap.appendChild(currentRow);

  let currentThumb = ctx.buildPickerThumb(element.assetId, element.assetId, () => {});
  currentRow.appendChild(currentThumb);

  const actionsCol = document.createElement('div');
  actionsCol.className = 'picker-current-actions';
  currentRow.appendChild(actionsCol);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = element.mediaKind === 'image' ? 'image/*' : 'video/*';

  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.textContent = element.mediaKind === 'image' ? 'Upload image' : 'Upload video';
  uploadBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });
  actionsCol.appendChild(uploadBtn);
  actionsCol.appendChild(fileInput);

  const altInput = document.createElement('input');
  altInput.type = 'text';
  altInput.id = 'media-upload-alt-' + element.id;
  altInput.value = typeof element.alt === 'string' ? element.alt : '';
  altInput.placeholder = 'Alt text';
  altInput.addEventListener('change', () => {
    element.alt = altInput.value;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  actionsCol.appendChild(altInput);

  const historyLabel = document.createElement('div');
  historyLabel.className = 'picker-row-label';
  historyLabel.textContent = 'Recent in this slot';
  pickerWrap.appendChild(historyLabel);

  const historyRow = document.createElement('div');
  historyRow.className = 'picker-history-row';
  pickerWrap.appendChild(historyRow);

  const galleryLabel = document.createElement('div');
  galleryLabel.className = 'picker-row-label';
  galleryLabel.textContent = 'Your gallery';
  pickerWrap.appendChild(galleryLabel);

  const galleryGrid = document.createElement('div');
  galleryGrid.className = 'picker-gallery-grid';
  pickerWrap.appendChild(galleryGrid);

  host.appendChild(pickerWrap);

  function refreshCurrentThumb(): void {
    const nextThumb = ctx.buildPickerThumb(element.assetId, element.assetId, () => {});
    currentRow.replaceChild(nextThumb, currentThumb);
    currentThumb = nextThumb;
  }

  function refreshAll(): Promise<unknown> {
    refreshCurrentThumb();
    return Promise.all([refreshHistoryRow(), refreshGalleryGrid()]);
  }

  async function refreshHistoryRow(): Promise<void> {
    historyRow.replaceChildren();
    let entries: Array<{ assetId: string }>;
    try {
      const resp = await ctx.authFetch(
        ctx.apiBase + '/sites/' + encodeURIComponent(ctx.siteId) +
        '/elements/' + encodeURIComponent(element.id) + '/history?limit=4',
      );
      if (!resp.ok) {
        console.error('slot-history fetch failed', resp.status);
        return;
      }
      const body = (await resp.json()) as { entries?: Array<{ assetId: string }> };
      entries = Array.isArray(body.entries) ? body.entries : [];
    } catch (err) {
      console.error('slot-history fetch failed', err);
      return;
    }
    for (const entry of entries) {
      const assetId = entry.assetId;
      const thumb = ctx.buildPickerThumb(assetId, element.assetId, (id: string) => {
        void ctx.applyAssetIdToElement(element, id, refreshAll);
      });
      historyRow.appendChild(thumb);
    }
    if (entries.length === 0) {
      const hint = document.createElement('span');
      hint.style.cssText = 'font-size:11px;color:var(--opencanvas-fg-faint);font-family:var(--opencanvas-font-mono);';
      hint.textContent = 'None yet';
      historyRow.appendChild(hint);
    }
  }

  async function refreshGalleryGrid(): Promise<void> {
    galleryGrid.replaceChildren();
    let entries: Array<{ id?: string; assetId?: string; kind?: string }>;
    try {
      const resp = await ctx.authFetch(ctx.apiBase + '/owner/assets');
      if (!resp.ok) {
        console.error('gallery fetch failed', resp.status);
        return;
      }
      const body = (await resp.json()) as {
        assets?: Array<{ id?: string; assetId?: string; kind?: string }>;
      };
      entries = Array.isArray(body.assets)
        ? body.assets.filter((entry) => entry && entry.kind === element.mediaKind)
        : [];
    } catch (err) {
      console.error('gallery fetch failed', err);
      return;
    }
    for (const entry of entries) {
      const assetId = typeof entry.id === 'string' ? entry.id : entry.assetId;
      if (typeof assetId !== 'string' || assetId.length === 0) continue;
      const cell = document.createElement('div');
      cell.className = 'picker-gallery-cell';

      const thumb = ctx.buildPickerThumb(assetId, element.assetId, (id: string) => {
        void ctx.applyAssetIdToElement(element, id, refreshAll);
      });
      cell.appendChild(thumb);

      const delBtn = document.createElement('button');
      delBtn.className = 'picker-delete';
      delBtn.type = 'button';
      delBtn.textContent = 'x';
      delBtn.title = 'Delete asset';
      delBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void ctx.runDeleteAsset(assetId, refreshAll);
      });
      cell.appendChild(delBtn);

      galleryGrid.appendChild(cell);
    }
    if (entries.length === 0) {
      const hint = document.createElement('span');
      hint.style.cssText = 'font-size:11px;color:var(--opencanvas-fg-faint);font-family:var(--opencanvas-font-mono);grid-column:1/-1;';
      hint.textContent = 'No assets yet';
      galleryGrid.appendChild(hint);
    }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    void ctx.uploadMediaForElement(element, file, refreshAll);
  });

  void refreshHistoryRow();
  void refreshGalleryGrid();
}
