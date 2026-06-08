// src/dashboard-client/page-settings.ts
//
// ADR 0021 — per-page SEO + metadata client. Migrated from the inline
// `clientScript(siteId, pageId)` IIFE pair in
// `src/routes/dashboard/page-settings.tsx`. DOM contract preserved
// (`form.seo`, `#metadata-form`, the `[data-preview-*]` nodes, the
// asset-picker modal hooks `[data-picker-modal]` / `[data-picker-grid]`
// / `[data-picker-empty]` / `[data-picker-status]` / `[data-picker-close]`
// / `[data-picker-upload]`, the per-picker `[data-asset-picker]` /
// `[data-picker-thumb]` / `[data-picker-choose]` / `[data-picker-clear]`
// / `[data-picker-meta]`, the canonical-warning `[data-canonical-warning]`
// / `[data-warning-host]` / `[data-publishing-host]` / `[data-preview-canonical]`
// / `[data-published-url]` / `[data-site-noindex]`). API contract
// preserved (PUT `/api/canvas/sites/:siteId/pages/:pageId/seo`,
// PUT `/api/canvas/sites/:siteId/pages/:pageId/metadata`, GET + POST
// `/api/owner/assets`, GET `/api/canvas/sites/:siteId/assets/:id`).
//
// First migration to ship TWO per-request keys on the boot blob
// (`siteId` + `pageId`). `readBoot()` reads both and throws loudly if
// either is missing — same posture as the other migrated mounts.
//
// Exported as `mountPageSettings(): void` so the dashboard dispatcher
// (`src/dashboard-client/index.ts`) can call into it from the bundle
// entry's switch on `__opencanvasDashboardBoot.route`.

interface BootKeys {
  siteId: string;
  pageId: string;
}

function readBoot(): BootKeys {
  const boot = window.__opencanvasDashboardBoot;
  if (!boot || boot.route !== 'page-settings') {
    throw new Error(
      '[dashboard-client/page-settings] boot blob missing or wrong route — expected { route: "page-settings", siteId, pageId }',
    );
  }
  if (typeof boot.siteId !== 'string' || boot.siteId.length === 0) {
    throw new Error(
      '[dashboard-client/page-settings] boot blob missing siteId — page-settings client cannot wire DOM',
    );
  }
  if (typeof boot.pageId !== 'string' || boot.pageId.length === 0) {
    throw new Error(
      '[dashboard-client/page-settings] boot blob missing pageId — page-settings client cannot wire DOM',
    );
  }
  return { siteId: boot.siteId, pageId: boot.pageId };
}

// Asset thumbnails on the dashboard host go through the owner-auth canvas
// API. The bare /assets/<id> URL only resolves on a published-site host.
function assetUrl(siteId: string, id: string): string {
  return (
    '/api/canvas/sites/' +
    encodeURIComponent(siteId) +
    '/assets/' +
    encodeURIComponent(id)
  );
}

interface SeoSaveResponse {
  error?: string;
}

interface MetadataSaveResponse {
  error?: string;
}

interface AssetListItem {
  id: string;
  alt?: string;
  kind?: string;
  mediaType?: string;
}

interface AssetListResponse {
  assets?: AssetListItem[];
}

interface AssetUploadResponse {
  id?: string;
  error?: string;
}

function wireSeoForm(siteId: string, pageId: string): void {
  const form = document.querySelector<HTMLFormElement>('form.seo');
  if (!form) return;
  const err = form.querySelector<HTMLElement>('.err');
  const ok = form.querySelector<HTMLElement>('.ok');
  function clearStatus(): void {
    if (err) err.textContent = '';
    if (ok) ok.textContent = '';
  }
  function showError(msg: string): void {
    clearStatus();
    if (err) err.textContent = msg;
  }
  function showOk(msg: string): void {
    clearStatus();
    if (ok) ok.textContent = msg;
  }

  // Soft char-limit warnings: 60 chars for title, 160 for description.
  function wireCount(inputName: string, limit: number): void {
    const input = form!.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[name="' + inputName + '"]',
    );
    const counter = form!.querySelector<HTMLElement>(
      '[data-count-for="' + inputName + '"]',
    );
    if (!input || !counter) return;
    function update(): void {
      const n = input!.value.length;
      counter!.textContent = n + ' / ' + limit;
      counter!.classList.toggle('warn', n > limit);
    }
    input.addEventListener('input', update);
    update();
  }
  wireCount('title', 60);
  wireCount('description', 160);

  // ---- Live previews -----------------------------------------------------
  // Bind title/description inputs to every [data-preview-title|desc] node so
  // OG card, Twitter, LinkedIn and SERP cards stay in sync as the user types.
  // Empty-state rules per element:
  //   data-empty-hide    → set hidden=true when input is empty (OG card desc)
  //   data-empty-text=X  → fall back to X when input is empty (Twitter / SERP)
  //   neither            → clear textContent (rare; effectively invisible)
  function bindPreview(inputName: string, attr: string): void {
    const input = form!.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[name="' + inputName + '"]',
    );
    if (!input) return;
    const targets = document.querySelectorAll<HTMLElement>('[' + attr + ']');
    function update(): void {
      const v = input!.value;
      for (const t of targets) {
        if (v.length === 0) {
          if (t.hasAttribute('data-empty-hide')) {
            t.textContent = '';
            t.hidden = true;
          } else if (t.hasAttribute('data-empty-text')) {
            t.textContent = t.getAttribute('data-empty-text') || '';
            t.hidden = false;
          } else {
            t.textContent = '';
          }
        } else {
          t.textContent = v;
          t.hidden = false;
        }
      }
    }
    input.addEventListener('input', update);
    update();
  }
  bindPreview('title', 'data-preview-title');
  bindPreview('description', 'data-preview-desc');

  // Canonical URL preview (SERP) + host-mismatch warning. The SERP preview
  // shows whatever URL the renderer will emit (canonical override when set,
  // auto-derived publishedUrl when blank). The warning fires when the
  // canonical's hostname does not match the site's publishing host — that's
  // either a fixture leak (the dashboard never edited a stale value baked
  // in by a template) or a deliberate cross-host canonical (umbrella site).
  // We don't auto-clear or block save; the field is the Owner's to control.
  const canonicalInput = form.querySelector<HTMLInputElement>('[name="canonical"]');
  const canonicalPreviewNode = document.querySelector<HTMLElement>(
    '[data-preview-canonical]',
  );
  const publishedUrlDefault = canonicalPreviewNode
    ? canonicalPreviewNode.getAttribute('data-published-url') || ''
    : '';
  const publishingHost = canonicalInput
    ? canonicalInput.getAttribute('data-publishing-host') || ''
    : '';
  const canonicalWarningNode = document.querySelector<HTMLElement>(
    '[data-canonical-warning]',
  );
  const warningHostNode = document.querySelector<HTMLElement>('[data-warning-host]');
  function evaluateCanonicalState(): void {
    if (!canonicalInput) return;
    const v = canonicalInput.value.trim();
    if (canonicalPreviewNode) {
      canonicalPreviewNode.textContent = v.length > 0 ? v : publishedUrlDefault;
    }
    if (canonicalWarningNode) {
      let mismatchHost: string | null = null;
      if (v.length > 0 && publishingHost.length > 0) {
        try {
          const parsedHost = new URL(v).host;
          if (parsedHost.toLowerCase() !== publishingHost.toLowerCase()) {
            mismatchHost = parsedHost;
          }
        } catch {
          /* malformed URL — skip the warning */
        }
      }
      if (mismatchHost !== null) {
        if (warningHostNode) warningHostNode.textContent = mismatchHost;
        canonicalWarningNode.hidden = false;
      } else {
        canonicalWarningNode.hidden = true;
      }
    }
  }
  if (canonicalInput) {
    canonicalInput.addEventListener('input', evaluateCanonicalState);
  }
  evaluateCanonicalState();

  // noIndex toggle → toggle the SERP "Google won't show this" notice live.
  const noIndexCb = form.querySelector<HTMLInputElement>('[name="noIndex"]');
  if (noIndexCb) {
    // Site-level noIndex still wins even if the user clears the per-page
    // checkbox, so we OR baseline (site) with the live page-level value.
    const serpEl = document.querySelector<HTMLElement>('[data-preview="serp"]');
    noIndexCb.addEventListener('change', () => {
      if (!serpEl) return;
      const siteBaseline = serpEl.getAttribute('data-site-noindex') === 'true';
      serpEl.setAttribute(
        'data-noindex',
        siteBaseline || noIndexCb.checked ? 'true' : 'false',
      );
    });
  }

  // ---- Asset picker ------------------------------------------------------
  const modal = document.querySelector<HTMLElement>('[data-picker-modal]');
  const modalGrid = document.querySelector<HTMLElement>('[data-picker-grid]');
  const modalEmpty = document.querySelector<HTMLElement>('[data-picker-empty]');
  const modalStatus = document.querySelector<HTMLElement>('[data-picker-status]');
  const modalClose = document.querySelector<HTMLElement>('[data-picker-close]');
  const modalUpload = document.querySelector<HTMLInputElement>('[data-picker-upload]');
  let activePicker: HTMLElement | null = null; // The .asset-picker element that opened the modal.

  function setStatus(msg: string, isError: boolean): void {
    if (!modalStatus) return;
    modalStatus.textContent = msg || '';
    modalStatus.classList.toggle('error', !!isError);
  }

  async function loadAssets(): Promise<void> {
    setStatus('Loading…', false);
    try {
      const r = await fetch('/api/owner/assets', {
        headers: { accept: 'application/json' },
      });
      if (!r.ok) {
        setStatus('Could not load assets (' + r.status + ')', true);
        return;
      }
      const body = (await r.json()) as AssetListResponse;
      const assets = Array.isArray(body.assets) ? body.assets : [];
      renderAssetGrid(assets);
      setStatus(
        assets.length + ' image' + (assets.length === 1 ? '' : 's') + ' available',
        false,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus('Network error: ' + msg, true);
    }
  }

  function renderAssetGrid(assets: AssetListItem[]): void {
    if (!modalGrid || !modalEmpty) return;
    modalGrid.innerHTML = '';
    const imageAssets = assets.filter(
      (a) =>
        a.kind === 'image' ||
        (typeof a.mediaType === 'string' && a.mediaType.startsWith('image/')),
    );
    if (imageAssets.length === 0) {
      modalEmpty.hidden = false;
      return;
    }
    modalEmpty.hidden = true;
    for (const a of imageAssets) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'picker-tile';
      tile.style.backgroundImage = 'url(' + assetUrl(siteId, a.id) + ')';
      tile.setAttribute('data-asset-id', a.id);
      tile.title = a.alt || a.id;
      if (a.alt) {
        const alt = document.createElement('span');
        alt.className = 'alt';
        alt.textContent = a.alt;
        tile.appendChild(alt);
      }
      tile.addEventListener('click', () => selectAsset(a.id));
      modalGrid.appendChild(tile);
    }
  }

  function openPicker(picker: HTMLElement): void {
    activePicker = picker;
    if (modal) modal.setAttribute('data-open', 'true');
    loadAssets();
  }

  function closePicker(): void {
    activePicker = null;
    if (modal) modal.removeAttribute('data-open');
  }

  function selectAsset(assetId: string): void {
    if (!activePicker) return;
    const hidden = activePicker.querySelector<HTMLInputElement>(
      'input[type="hidden"]',
    );
    const thumb = activePicker.querySelector<HTMLElement>('[data-picker-thumb]');
    const meta = activePicker.querySelector<HTMLElement>('[data-picker-meta]');
    const clearBtn = activePicker.querySelector<HTMLElement>('[data-picker-clear]');
    const chooseBtn = activePicker.querySelector<HTMLElement>('[data-picker-choose]');
    if (hidden) hidden.value = assetId;
    activePicker.setAttribute('data-asset-id', assetId);
    if (thumb) {
      thumb.style.backgroundImage = 'url(' + assetUrl(siteId, assetId) + ')';
      thumb.setAttribute('data-has-image', 'true');
      thumb.textContent = '';
    }
    if (meta) meta.textContent = 'Custom image overrides the generated card.';
    if (clearBtn) clearBtn.hidden = false;
    if (chooseBtn) chooseBtn.textContent = 'Change image';
    // Update every OG card preview (standalone + the embedded copies inside
    // the Twitter and LinkedIn image slots) and the platform image slots.
    const url = 'url(' + assetUrl(siteId, assetId) + ')';
    document.querySelectorAll<HTMLElement>('[data-preview="og"]').forEach((og) => {
      og.setAttribute('data-has-custom', 'true');
      og.style.backgroundImage = url;
    });
    for (const sel of [
      '[data-preview-img="twitter"]',
      '[data-preview-img="linkedin"]',
    ]) {
      const img = document.querySelector<HTMLElement>(sel);
      if (!img) continue;
      img.style.backgroundImage = url;
      img.style.backgroundSize = 'cover';
      img.style.backgroundPosition = 'center';
      img.setAttribute('data-has-custom', 'true');
    }
    closePicker();
  }

  function clearAsset(picker: HTMLElement): void {
    const hidden = picker.querySelector<HTMLInputElement>('input[type="hidden"]');
    const thumb = picker.querySelector<HTMLElement>('[data-picker-thumb]');
    const meta = picker.querySelector<HTMLElement>('[data-picker-meta]');
    const clearBtn = picker.querySelector<HTMLElement>('[data-picker-clear]');
    const chooseBtn = picker.querySelector<HTMLElement>('[data-picker-choose]');
    if (hidden) hidden.value = '';
    picker.setAttribute('data-asset-id', '');
    if (thumb) {
      thumb.style.backgroundImage = '';
      thumb.setAttribute('data-has-image', 'false');
      thumb.textContent = 'auto';
    }
    if (meta) meta.textContent = 'Leave blank to use the auto-generated card.';
    if (clearBtn) clearBtn.hidden = true;
    if (chooseBtn) chooseBtn.textContent = 'Choose image';
    document.querySelectorAll<HTMLElement>('[data-preview="og"]').forEach((og) => {
      og.removeAttribute('data-has-custom');
      og.style.backgroundImage = '';
    });
    for (const sel of [
      '[data-preview-img="twitter"]',
      '[data-preview-img="linkedin"]',
    ]) {
      const img = document.querySelector<HTMLElement>(sel);
      if (!img) continue;
      img.style.backgroundImage = '';
      img.removeAttribute('data-has-custom');
    }
  }

  document.querySelectorAll<HTMLElement>('[data-asset-picker]').forEach((picker) => {
    const choose = picker.querySelector<HTMLElement>('[data-picker-choose]');
    const clear = picker.querySelector<HTMLElement>('[data-picker-clear]');
    if (choose) choose.addEventListener('click', () => openPicker(picker));
    if (clear) clear.addEventListener('click', () => clearAsset(picker));
  });
  if (modalClose) modalClose.addEventListener('click', closePicker);
  if (modal)
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) closePicker();
    });
  document.addEventListener('keydown', (ev) => {
    if (
      ev.key === 'Escape' &&
      modal &&
      modal.getAttribute('data-open') === 'true'
    )
      closePicker();
  });

  if (modalUpload) {
    modalUpload.addEventListener('change', async () => {
      const file = modalUpload.files && modalUpload.files[0];
      if (!file) return;
      setStatus('Uploading ' + file.name + '…', false);
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await fetch('/api/owner/assets', { method: 'POST', body: fd });
        if (!r.ok) {
          let detail = r.statusText;
          try {
            const b = (await r.json()) as AssetUploadResponse;
            if (b && b.error) detail = b.error;
          } catch {
            /* noop */
          }
          setStatus('Upload failed: ' + detail, true);
          modalUpload.value = '';
          return;
        }
        const body = (await r.json()) as AssetUploadResponse;
        modalUpload.value = '';
        if (body && body.id) {
          await loadAssets();
          selectAsset(body.id);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus('Network error: ' + msg, true);
        modalUpload.value = '';
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus();
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    const titleInput = form.querySelector<HTMLInputElement>('[name="title"]');
    const descriptionInput = form.querySelector<HTMLTextAreaElement>(
      '[name="description"]',
    );
    const ogImageAssetIdInput = form.querySelector<HTMLInputElement>(
      '[name="ogImageAssetId"]',
    );
    const canonicalInput = form.querySelector<HTMLInputElement>('[name="canonical"]');
    const noIndexInput = form.querySelector<HTMLInputElement>('[name="noIndex"]');
    const localeInput = form.querySelector<HTMLInputElement>('[name="locale"]');
    const data = {
      title: titleInput ? titleInput.value.trim() : '',
      description: descriptionInput ? descriptionInput.value.trim() : '',
      ogImageAssetId: ogImageAssetIdInput ? ogImageAssetIdInput.value.trim() : '',
      canonical: canonicalInput ? canonicalInput.value.trim() : '',
      noIndex: noIndexInput ? noIndexInput.checked : false,
      locale: localeInput ? localeInput.value.trim() : '',
    };
    if (data.title.length === 0) {
      showError('Title is required.');
      if (button) button.disabled = false;
      return;
    }
    try {
      const response = await fetch(
        '/api/canvas/sites/' +
          encodeURIComponent(siteId) +
          '/pages/' +
          encodeURIComponent(pageId) +
          '/seo',
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(data),
        },
      );
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = (await response.json()) as SeoSaveResponse;
          if (body && body.error) detail = body.error;
        } catch {
          /* noop */
        }
        showError(detail);
        if (button) button.disabled = false;
        return;
      }
      showOk('Saved.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showError('Network error: ' + msg);
    } finally {
      if (button) button.disabled = false;
    }
  });
}

function wireMetadataForm(siteId: string, pageId: string): void {
  const form = document.querySelector<HTMLFormElement>('#metadata-form');
  if (!form) return;
  const err = form.querySelector<HTMLElement>('.err');
  const ok = form.querySelector<HTMLElement>('.ok');
  function clearStatus(): void {
    if (err) err.textContent = '';
    if (ok) ok.textContent = '';
  }
  function showError(msg: string): void {
    clearStatus();
    if (err) err.textContent = msg;
  }
  function showOk(msg: string): void {
    clearStatus();
    if (ok) ok.textContent = msg;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus();
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    const publishedDateInput = form.querySelector<HTMLInputElement>(
      '[name="publishedDate"]',
    );
    const authorInput = form.querySelector<HTMLInputElement>('[name="author"]');
    const tagsInput = form.querySelector<HTMLInputElement>('[name="tags"]');
    const categoryInput = form.querySelector<HTMLInputElement>('[name="category"]');
    const rawTags = tagsInput ? tagsInput.value.trim() : '';
    const data = {
      publishedDate:
        publishedDateInput && publishedDateInput.value.trim().length > 0
          ? publishedDateInput.value.trim()
          : null,
      author:
        authorInput && authorInput.value.trim().length > 0
          ? authorInput.value.trim()
          : null,
      tags:
        rawTags.length > 0
          ? rawTags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : null,
      category:
        categoryInput && categoryInput.value.trim().length > 0
          ? categoryInput.value.trim()
          : null,
    };
    try {
      const response = await fetch(
        '/api/canvas/sites/' +
          encodeURIComponent(siteId) +
          '/pages/' +
          encodeURIComponent(pageId) +
          '/metadata',
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(data),
        },
      );
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = (await response.json()) as MetadataSaveResponse;
          if (body && body.error) detail = body.error;
        } catch {
          /* noop */
        }
        showError(detail);
        if (button) button.disabled = false;
        return;
      }
      showOk('Saved.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showError('Network error: ' + msg);
    } finally {
      if (button) button.disabled = false;
    }
  });
}

export function mountPageSettings(): void {
  const { siteId, pageId } = readBoot();
  wireSeoForm(siteId, pageId);
  wireMetadataForm(siteId, pageId);
}
