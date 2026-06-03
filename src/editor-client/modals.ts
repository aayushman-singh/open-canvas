// src/editor-client/modals.ts
//
// ADR 0058 Phase 2q.a — modal cluster.
// canvas-client.ts:1194-1957 carries the inline twin for the six modal
// openers (openTextModal, openSelectModal, openConfirmModal,
// openAlertModal, openAiMediaModal, openNewPageModal) plus the shared
// modalOpen flag and the window.__opencanvasModal global registration
// that wraps three of them as confirm/alert/prompt helpers. All retire
// on ADR 0015 Phase 3 atomic cutover; until then, the inline IIFE is
// the production source-of-truth and this module is dead code.
//
// Six openers live here, each enforcing the same hard sync gate against
// ctx.modalOpen and each restoring the flag in their close() path:
//
//   - openTextModalImpl(ctx, opts) — single- or multi-line text prompt.
//     Resolves to the input value on OK/Enter (Ctrl/Cmd+Enter when
//     multiline), null on Cancel/Escape/backdrop click. Used for rename,
//     "Save to library" name + description, AI brief prompts, snapshot
//     labels, and the rest of the prompt-style modal callers.
//
//   - openSelectModalImpl(ctx, opts) — single-pick from a fixed option
//     list. Resolves to the chosen value on OK/Enter, null on Cancel/
//     Escape. Used for visibility pickers ("public" / "private") in the
//     "Save to library" / "Save as template" flows.
//
//   - openConfirmModalImpl(ctx, opts) — OK/Cancel confirmation with
//     optional danger styling on the confirm button. Resolves true on
//     OK/Enter, false on Cancel/Escape/backdrop click. Drives the
//     destructive-action confirms (delete page, delete asset, delete
//     snapshot) and the "open the live site after publish" prompt.
//
//   - openAlertModalImpl(ctx, opts) — single-button OK acknowledgement,
//     wired with role="alertdialog" so AT announces it as an alert. Both
//     OK/Enter and Escape close. Resolves to void. Used for AI preview
//     failures, publish failures, and the publish-error toast escape.
//
//   - openAiMediaModalImpl(ctx, opts) — prompt textarea + aspect-ratio
//     radio row + 4-up preview gallery. requestFn(prompt, aspectRatio)
//     is invoked four times in parallel on click; picking a tile
//     resolves the outer promise with {blob, mediaType, aspectRatio,
//     prompt}. Cancel resolves with null. Tile object URLs are revoked
//     in the close() path so the modal never leaks bytes — the chosen
//     blob is handed back as a Blob (not a URL) so the caller creates
//     its own URL for the preview lifetime.
//
//   - openNewPageModalImpl(ctx, opts) — title + slug + locale capture
//     for the "+ New Page" flow (ADR 0034). Slug auto-derives from
//     title and freezes on first manual slug edit (re-arms on slug
//     clear). Locale dropdown offers the top-10 BCP-47 tags + "Site
//     default" + an "Other..." escape that reveals a raw-tag input.
//     Reserved-slug pre-validation blocks _404/404; duplicate-slug
//     pre-validation blocks slugs already taken on the site. Resolves
//     to {title, slug, locale} on submit or null on cancel.
//
// CRITICAL — modal stacking semantics: every opener throws synchronously
// if ctx.modalOpen is already true. Callers serialise modals themselves
// (e.g. saveToLibrary chains name → description → visibility through
// three sequential awaits). The throw is preserved verbatim from the
// inline twin so a forgotten serialisation surfaces as a loud error
// rather than two stacked dialogs.
//
// The window.__opencanvasModal global registration (canvas-client.ts:
// 1953-1957) is NOT extracted — it stays inline at the IIFE boundary so
// the boot order remains identical. After Phase 3 cutover, createEditor
// will perform the registration against the bound ctx methods.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { EditorContext } from './editor-context.js';

// ---- Option shapes -----------------------------------------------------

export interface TextModalOpts {
  title?: string | undefined;
  label?: string | undefined;
  defaultValue?: string | undefined;
  placeholder?: string | undefined;
  multiline?: boolean | undefined;
}

export interface SelectModalOption {
  value: string;
  label?: string | undefined;
}

export interface SelectModalOpts {
  title?: string | undefined;
  label?: string | undefined;
  options: SelectModalOption[];
  defaultValue?: string | undefined;
}

export interface ConfirmModalOpts {
  title?: string | undefined;
  message?: string | undefined;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
  danger?: boolean | undefined;
}

export interface AlertModalOpts {
  title?: string | undefined;
  message?: string | undefined;
}

/** Result shape of one AI media preview request. */
export interface AiMediaPayload {
  blob: Blob;
  mediaType: string;
}

export interface AiMediaModalOpts {
  title?: string | undefined;
  defaultPrompt?: string | undefined;
  defaultAspect?: string | undefined;
  /** Function-shape (not method-shape) so callers can pull `opts.requestFn`
   *  into a local without ESLint's unbound-method false-positive — the
   *  modal calls it four times in parallel, never bound to opts. */
  requestFn: (prompt: string, aspectRatio: string) => Promise<AiMediaPayload>;
}

export interface AiMediaModalResult {
  blob: Blob;
  mediaType: string;
  aspectRatio: string;
  prompt: string;
}

export interface NewPageModalOpts {
  existingSlugs?: string[] | undefined;
}

export interface NewPageModalResult {
  title: string;
  slug: string;
  /** null when "Site default" is chosen; otherwise a BCP-47 tag. */
  locale: string | null;
}

// ---- Error narrowing helper -------------------------------------------

/** Inline twin reads `err.message` directly. exactOptionalPropertyTypes +
 *  the strict-error-narrowing lint forbid that on `unknown` — round-trip
 *  through this helper so the extracted code reports the same string the
 *  inline path would have. */
function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown';
}

// ---- openTextModal -----------------------------------------------------

export function openTextModalImpl(
  ctx: EditorContext,
  opts: TextModalOpts,
): Promise<string | null> {
  if (ctx.modalOpen) {
    throw new Error('openTextModal: another modal is already open');
  }
  const title = typeof opts.title === 'string' ? opts.title : '';
  const label = typeof opts.label === 'string' ? opts.label : '';
  const defaultValue = typeof opts.defaultValue === 'string' ? opts.defaultValue : '';
  const placeholder = typeof opts.placeholder === 'string' ? opts.placeholder : '';
  const multiline = opts.multiline === true;
  ctx.modalOpen = true;
  return new Promise<string | null>((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'opencanvas-modal-backdrop';
    const panel = document.createElement('div');
    panel.className = 'opencanvas-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    if (title) panel.setAttribute('aria-label', title);

    if (title) {
      const h = document.createElement('h3');
      h.textContent = title;
      panel.appendChild(h);
    }
    const lbl = document.createElement('label');
    lbl.textContent = label;
    panel.appendChild(lbl);

    const input: HTMLInputElement | HTMLTextAreaElement = multiline
      ? document.createElement('textarea')
      : document.createElement('input');
    if (!multiline) (input as HTMLInputElement).type = 'text';
    input.value = defaultValue;
    input.placeholder = placeholder;
    if (multiline) (input as HTMLTextAreaElement).rows = 4;
    panel.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'opencanvas-modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'OK';
    actions.appendChild(cancel);
    actions.appendChild(ok);
    panel.appendChild(actions);

    backdrop.appendChild(panel);

    function close(value: string | null): void {
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      document.body.classList.remove('opencanvas-modal-open');
      ctx.modalOpen = false;
      resolve(value);
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        close(null);
        return;
      }
      if (ev.key === 'Enter') {
        if (multiline) {
          if (ev.ctrlKey || ev.metaKey) {
            ev.preventDefault();
            ev.stopPropagation();
            close(input.value);
          }
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        close(input.value);
      }
    }
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) close(null);
    });
    cancel.addEventListener('click', () => close(null));
    ok.addEventListener('click', () => close(input.value));
    document.addEventListener('keydown', onKey, true);

    document.body.classList.add('opencanvas-modal-open');
    document.body.appendChild(backdrop);
    // Autofocus after mount so the input is ready to type.
    input.focus();
    if (typeof (input as HTMLInputElement).select === 'function') {
      (input as HTMLInputElement).select();
    }
  });
}

// ---- openSelectModal ---------------------------------------------------

export function openSelectModalImpl(
  ctx: EditorContext,
  opts: SelectModalOpts,
): Promise<string | null> {
  if (ctx.modalOpen) {
    throw new Error('openSelectModal: another modal is already open');
  }
  const title = typeof opts.title === 'string' ? opts.title : '';
  const label = typeof opts.label === 'string' ? opts.label : '';
  const options = Array.isArray(opts.options) ? opts.options : [];
  const defaultValue = typeof opts.defaultValue === 'string' ? opts.defaultValue : '';
  ctx.modalOpen = true;
  return new Promise<string | null>((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'opencanvas-modal-backdrop';
    const panel = document.createElement('div');
    panel.className = 'opencanvas-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    if (title) panel.setAttribute('aria-label', title);

    if (title) {
      const h = document.createElement('h3');
      h.textContent = title;
      panel.appendChild(h);
    }
    const lbl = document.createElement('label');
    lbl.textContent = label;
    panel.appendChild(lbl);

    const select = document.createElement('select');
    let matched = false;
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (!opt || typeof opt.value !== 'string') continue;
      const optEl = document.createElement('option');
      optEl.value = opt.value;
      optEl.textContent = typeof opt.label === 'string' ? opt.label : opt.value;
      if (opt.value === defaultValue) {
        optEl.selected = true;
        matched = true;
      }
      select.appendChild(optEl);
    }
    if (!matched && options.length > 0) {
      select.selectedIndex = 0;
    }
    panel.appendChild(select);

    const actions = document.createElement('div');
    actions.className = 'opencanvas-modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'OK';
    actions.appendChild(cancel);
    actions.appendChild(ok);
    panel.appendChild(actions);

    backdrop.appendChild(panel);

    function close(value: string | null): void {
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      document.body.classList.remove('opencanvas-modal-open');
      ctx.modalOpen = false;
      resolve(value);
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        close(null);
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        close(select.value);
      }
    }
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) close(null);
    });
    cancel.addEventListener('click', () => close(null));
    ok.addEventListener('click', () => close(select.value));
    document.addEventListener('keydown', onKey, true);

    document.body.classList.add('opencanvas-modal-open');
    document.body.appendChild(backdrop);
    select.focus();
  });
}

// ---- openConfirmModal --------------------------------------------------

export function openConfirmModalImpl(
  ctx: EditorContext,
  opts: ConfirmModalOpts,
): Promise<boolean> {
  if (ctx.modalOpen) {
    throw new Error('openConfirmModal: another modal is already open');
  }
  const title = typeof opts.title === 'string' ? opts.title : '';
  const message = typeof opts.message === 'string' ? opts.message : '';
  const confirmLabel = typeof opts.confirmLabel === 'string' ? opts.confirmLabel : 'OK';
  const cancelLabel = typeof opts.cancelLabel === 'string' ? opts.cancelLabel : 'Cancel';
  const danger = opts.danger === true;
  ctx.modalOpen = true;
  return new Promise<boolean>((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'opencanvas-modal-backdrop';
    const panel = document.createElement('div');
    panel.className = 'opencanvas-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    if (title) panel.setAttribute('aria-label', title);
    if (title) {
      const h = document.createElement('h3');
      h.textContent = title;
      panel.appendChild(h);
    }
    const p = document.createElement('p');
    p.style.cssText =
      'margin:0 0 14px;font-size:13px;color:var(--opencanvas-fg-mute);line-height:1.5;white-space:pre-line';
    p.textContent = message;
    panel.appendChild(p);
    const actions = document.createElement('div');
    actions.className = 'opencanvas-modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = cancelLabel;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = confirmLabel;
    if (danger) {
      ok.style.background = '#ef4444';
      ok.style.borderColor = '#ef4444';
      ok.style.color = '#fff';
    }
    actions.appendChild(cancel);
    actions.appendChild(ok);
    panel.appendChild(actions);
    backdrop.appendChild(panel);
    function close(value: boolean): void {
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      document.body.classList.remove('opencanvas-modal-open');
      ctx.modalOpen = false;
      resolve(value);
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        close(false);
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        close(true);
      }
    }
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) close(false);
    });
    cancel.addEventListener('click', () => {
      close(false);
    });
    ok.addEventListener('click', () => {
      close(true);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.classList.add('opencanvas-modal-open');
    document.body.appendChild(backdrop);
    ok.focus();
  });
}

// ---- openAiMediaModal --------------------------------------------------

export function openAiMediaModalImpl(
  ctx: EditorContext,
  opts: AiMediaModalOpts,
): Promise<AiMediaModalResult | null> {
  if (ctx.modalOpen) {
    throw new Error('openAiMediaModal: another modal is already open');
  }
  const title = typeof opts.title === 'string' ? opts.title : 'AI media';
  const defaultPrompt = typeof opts.defaultPrompt === 'string' ? opts.defaultPrompt : '';
  const requestFn = typeof opts.requestFn === 'function' ? opts.requestFn : null;
  if (!requestFn) {
    throw new Error('openAiMediaModal: requestFn is required');
  }
  const aspectOptions: Array<{ label: string; value: string }> = [
    { label: '1:1', value: '1:1' },
    { label: '16:9', value: '16:9' },
    { label: '4:3', value: '4:3' },
    { label: '9:16', value: '9:16' },
  ];
  const defaultAspect = typeof opts.defaultAspect === 'string' ? opts.defaultAspect : '1:1';
  let selectedAspect = defaultAspect;
  ctx.modalOpen = true;
  return new Promise<AiMediaModalResult | null>((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'opencanvas-modal-backdrop';
    const panel = document.createElement('div');
    panel.className = 'opencanvas-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', title);
    panel.style.minWidth = '440px';
    panel.style.maxWidth = '560px';

    const h = document.createElement('h3');
    h.textContent = title;
    panel.appendChild(h);

    const promptLabel = document.createElement('label');
    promptLabel.textContent = 'Describe the image';
    panel.appendChild(promptLabel);
    const promptInput = document.createElement('textarea');
    promptInput.rows = 3;
    promptInput.placeholder = 'Sunset over ocean';
    promptInput.value = defaultPrompt;
    panel.appendChild(promptInput);

    const aspectLabel = document.createElement('label');
    aspectLabel.textContent = 'Aspect ratio';
    panel.appendChild(aspectLabel);

    const aspectRow = document.createElement('div');
    aspectRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    const aspectButtons: HTMLButtonElement[] = [];
    function paintAspect(): void {
      for (let i = 0; i < aspectButtons.length; i++) {
        const b = aspectButtons[i];
        if (!b) continue;
        const on = b.getAttribute('data-aspect') === selectedAspect;
        b.style.background = on ? 'var(--red)' : 'var(--surface)';
        b.style.color = on ? '#fff' : 'var(--ink-2)';
        b.style.borderColor = on ? 'var(--red)' : 'var(--line-2)';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    for (let ai = 0; ai < aspectOptions.length; ai++) {
      const option = aspectOptions[ai];
      if (!option) continue;
      ((opt: { label: string; value: string }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = opt.label;
        btn.setAttribute('data-aspect', opt.value);
        btn.setAttribute('role', 'radio');
        btn.style.cssText =
          'appearance:none;font:inherit;font-family:var(--sans);font-weight:650;' +
          'font-size:13px;padding:7px 14px;border-radius:var(--r-pill);cursor:pointer;' +
          'background:var(--surface);border:1.5px solid var(--line-2);color:var(--ink-2);' +
          'transition:border-color .15s,background-color .15s,color .15s;';
        btn.addEventListener('click', () => {
          selectedAspect = opt.value;
          paintAspect();
        });
        aspectButtons.push(btn);
        aspectRow.appendChild(btn);
      })(option);
    }
    paintAspect();
    panel.appendChild(aspectRow);

    // Generate row: button + status line.
    const genRow = document.createElement('div');
    genRow.style.cssText = 'display:flex;gap:10px;align-items:center;margin-top:4px;';
    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.textContent = 'Generate with AI';
    genBtn.style.cssText =
      'appearance:none;font:inherit;font-family:var(--sans);font-weight:650;font-size:13.5px;' +
      'padding:9px 18px;border-radius:var(--r-pill);cursor:pointer;background:var(--red);' +
      'border:1.5px solid var(--red);color:#fff;box-shadow:var(--shadow-red);transition:background-color .15s,transform .12s;';
    const genStatus = document.createElement('span');
    genStatus.style.cssText = 'font-size:12.5px;color:var(--ink-3);';
    genRow.appendChild(genBtn);
    genRow.appendChild(genStatus);
    panel.appendChild(genRow);

    // 4-up gallery host — hidden until the first generate fires.
    const galleryLabel = document.createElement('label');
    galleryLabel.textContent = 'Pick one';
    galleryLabel.style.display = 'none';
    panel.appendChild(galleryLabel);
    const gallery = document.createElement('div');
    gallery.style.cssText =
      'display:grid;grid-template-columns:repeat(2, 1fr);gap:10px;margin-top:4px;';
    panel.appendChild(gallery);

    // Tile object URLs we need to revoke on close (whether by cancel or
    // by pick — we keep only the chosen one alive via a fresh URL on the
    // resolver side and let the caller manage it).
    let liveTiles: Array<string | undefined> = [];
    function clearGallery(): void {
      for (let t = 0; t < liveTiles.length; t++) {
        const u = liveTiles[t];
        if (u) URL.revokeObjectURL(u);
      }
      liveTiles = [];
      while (gallery.firstChild) gallery.removeChild(gallery.firstChild);
      galleryLabel.style.display = 'none';
    }

    function makeTile(
      index: number,
      payload: AiMediaPayload,
      promptText: string,
      aspect: string,
    ): void {
      const url = URL.createObjectURL(payload.blob);
      liveTiles[index] = url;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.style.cssText =
        'appearance:none;padding:0;border:2px solid var(--line-2);border-radius:var(--r-sm);' +
        'overflow:hidden;cursor:pointer;background:var(--surface);transition:border-color .15s,transform .12s;';
      tile.addEventListener('mouseenter', () => {
        tile.style.borderColor = 'var(--red)';
      });
      tile.addEventListener('mouseleave', () => {
        tile.style.borderColor = 'var(--line-2)';
      });
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'AI preview ' + (index + 1);
      img.style.cssText = 'display:block;width:100%;height:auto;';
      tile.appendChild(img);
      tile.addEventListener('click', () => {
        // Hand the chosen blob back to the caller. The tile URL is only for
        // this modal; the preview flow creates and owns its own object URL.
        close({
          blob: payload.blob,
          mediaType: payload.mediaType,
          aspectRatio: aspect,
          prompt: promptText,
        });
      });
      gallery.appendChild(tile);
    }

    function makeFailureTile(_index: number, err: unknown): void {
      const tile = document.createElement('div');
      tile.style.cssText =
        'border:1.5px dashed var(--line-2);border-radius:var(--r-sm);padding:14px;' +
        'display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--red-ink);' +
        'min-height:80px;text-align:center;';
      tile.textContent = 'Failed: ' + errorToString(err);
      gallery.appendChild(tile);
    }

    let generating = false;
    let closed = false;
    genBtn.addEventListener('click', () => {
      if (generating) return;
      const promptText = promptInput.value.trim();
      if (promptText.length === 0) {
        genStatus.textContent = 'Enter a prompt first';
        genStatus.style.color = 'var(--red-ink)';
        promptInput.focus();
        return;
      }
      generating = true;
      genBtn.disabled = true;
      const prev = genBtn.textContent;
      genBtn.textContent = 'Generating...';
      genStatus.textContent = 'Asking the model for 4 previews';
      genStatus.style.color = 'var(--ink-3)';
      clearGallery();
      galleryLabel.style.display = '';

      const aspectAtRequest = selectedAspect;
      const calls: Array<Promise<AiMediaPayload>> = [];
      for (let i = 0; i < 4; i++) {
        calls.push(requestFn(promptText, aspectAtRequest));
      }
      type Settled =
        | { ok: true; value: AiMediaPayload }
        | { ok: false; error: unknown };
      void Promise.all(
        calls.map(
          (p): Promise<Settled> =>
            p.then(
              (r): Settled => ({ ok: true, value: r }),
              (e): Settled => ({ ok: false, error: e }),
            ),
        ),
      ).then((results) => {
        if (closed) return;
        generating = false;
        genBtn.disabled = false;
        genBtn.textContent = prev;
        let okCount = 0;
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (!r) continue;
          if (r.ok) {
            makeTile(i, r.value, promptText, aspectAtRequest);
            okCount++;
          } else {
            makeFailureTile(i, r.error);
          }
        }
        if (okCount === 0) {
          genStatus.textContent = 'All previews failed';
          genStatus.style.color = 'var(--red-ink)';
        } else if (okCount < 4) {
          genStatus.textContent = okCount + ' of 4 previews ready';
          genStatus.style.color = 'var(--ink-3)';
        } else {
          genStatus.textContent = 'Pick one to apply';
          genStatus.style.color = 'var(--ink-3)';
        }
      });
    });

    const actions = document.createElement('div');
    actions.className = 'opencanvas-modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    actions.appendChild(cancel);
    panel.appendChild(actions);

    backdrop.appendChild(panel);

    function close(value: AiMediaModalResult | null): void {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      clearGallery();
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      document.body.classList.remove('opencanvas-modal-open');
      ctx.modalOpen = false;
      resolve(value);
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        close(null);
      }
    }
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) close(null);
    });
    cancel.addEventListener('click', () => {
      close(null);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.classList.add('opencanvas-modal-open');
    document.body.appendChild(backdrop);
    promptInput.focus();
  });
}

// ---- openNewPageModal --------------------------------------------------

export function openNewPageModalImpl(
  ctx: EditorContext,
  opts: NewPageModalOpts,
): Promise<NewPageModalResult | null> {
  if (ctx.modalOpen) {
    throw new Error('openNewPageModal: another modal is already open');
  }
  const existingSlugs = opts && Array.isArray(opts.existingSlugs) ? opts.existingSlugs : [];
  ctx.modalOpen = true;
  return new Promise<NewPageModalResult | null>((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'opencanvas-modal-backdrop';
    const panel = document.createElement('div');
    panel.className = 'opencanvas-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Create new page');

    const h = document.createElement('h3');
    h.textContent = 'New page';
    panel.appendChild(h);

    // -- Title ---------------------------------------------------------
    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Title';
    panel.appendChild(titleLabel);
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'About us';
    panel.appendChild(titleInput);

    // -- Slug ----------------------------------------------------------
    const slugLabel = document.createElement('label');
    slugLabel.textContent = 'Slug';
    panel.appendChild(slugLabel);
    const slugInput = document.createElement('input');
    slugInput.type = 'text';
    slugInput.placeholder = 'about-us';
    panel.appendChild(slugInput);
    const slugHint = document.createElement('div');
    slugHint.style.cssText = 'font-size:11px;color:var(--opencanvas-fg-mute);margin:-6px 0 8px';
    slugHint.textContent = 'Auto-derived from title. Edit to override; clear to re-link.';
    panel.appendChild(slugHint);

    // -- Locale --------------------------------------------------------
    const localeLabel = document.createElement('label');
    localeLabel.textContent = 'Locale';
    panel.appendChild(localeLabel);
    const localeSel = document.createElement('select');
    const localeOptions: Array<{ value: string; label: string }> = [
      { value: '', label: 'Site default' },
      { value: 'en', label: 'en (English)' },
      { value: 'ar', label: 'ar (Arabic)' },
      { value: 'ja', label: 'ja (Japanese)' },
      { value: 'zh-CN', label: 'zh-CN (Chinese simplified)' },
      { value: 'es', label: 'es (Spanish)' },
      { value: 'fr', label: 'fr (French)' },
      { value: 'de', label: 'de (German)' },
      { value: 'pt', label: 'pt (Portuguese)' },
      { value: 'ru', label: 'ru (Russian)' },
      { value: 'hi', label: 'hi (Hindi)' },
      { value: '__other__', label: 'Other (type BCP-47 tag)' },
    ];
    for (let i = 0; i < localeOptions.length; i++) {
      const lo = localeOptions[i];
      if (!lo) continue;
      const localeOpt = document.createElement('option');
      localeOpt.value = lo.value;
      localeOpt.textContent = lo.label;
      localeSel.appendChild(localeOpt);
    }
    panel.appendChild(localeSel);
    const otherLocaleInput = document.createElement('input');
    otherLocaleInput.type = 'text';
    otherLocaleInput.placeholder = 'e.g. en-GB or fr-CA';
    otherLocaleInput.style.cssText = 'margin-top:6px;display:none';
    panel.appendChild(otherLocaleInput);
    localeSel.addEventListener('change', () => {
      otherLocaleInput.style.display = localeSel.value === '__other__' ? 'block' : 'none';
      if (localeSel.value === '__other__') otherLocaleInput.focus();
    });

    // -- Inline error + actions ---------------------------------------
    const errorLine = document.createElement('div');
    errorLine.style.cssText = 'min-height:18px;font-size:12px;color:#ef4444;margin:8px 0';
    panel.appendChild(errorLine);

    const actions = document.createElement('div');
    actions.className = 'opencanvas-modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'Create';
    actions.appendChild(cancel);
    actions.appendChild(ok);
    panel.appendChild(actions);

    backdrop.appendChild(panel);

    // -- Slug auto-derive + freeze/re-arm logic -----------------------
    let slugManuallyEdited = false;
    function slugify(str: string): string {
      const s = str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      return s.length === 0 ? 'page' : s;
    }
    titleInput.addEventListener('input', () => {
      if (!slugManuallyEdited) {
        slugInput.value = slugify(titleInput.value);
        validate();
      }
    });
    slugInput.addEventListener('input', () => {
      if (slugInput.value.length === 0) {
        slugManuallyEdited = false;
        slugInput.value = slugify(titleInput.value);
      } else {
        slugManuallyEdited = true;
      }
      validate();
    });

    function validate(): void {
      const title = titleInput.value.trim();
      const slug = slugInput.value.trim();
      if (title.length === 0) {
        errorLine.textContent = 'Title is required.';
        ok.disabled = true;
        return;
      }
      if (slug.length === 0) {
        errorLine.textContent = 'Slug is required.';
        ok.disabled = true;
        return;
      }
      if (slug === '_404' || slug === '404') {
        errorLine.textContent =
          "Slug '" +
          slug +
          "' is reserved for the custom 404 page (toggle in the page inspector after create).";
        ok.disabled = true;
        return;
      }
      if (existingSlugs.indexOf(slug) !== -1) {
        errorLine.textContent =
          "Slug '" + slug + "' is already used by another page on this site.";
        ok.disabled = true;
        return;
      }
      errorLine.textContent = '';
      ok.disabled = false;
    }

    function close(value: NewPageModalResult | null): void {
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      document.body.classList.remove('opencanvas-modal-open');
      ctx.modalOpen = false;
      resolve(value);
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        close(null);
        return;
      }
      if (ev.key === 'Enter' && !ok.disabled) {
        // Ignore Enter from the "Other locale" input so the user can
        // type a tag containing whitespace handling without
        // accidentally submitting.
        if (document.activeElement === otherLocaleInput) return;
        ev.preventDefault();
        ev.stopPropagation();
        submit();
      }
    }
    function submit(): void {
      let locale: string | null;
      if (localeSel.value === '') locale = null;
      else if (localeSel.value === '__other__') {
        const custom = otherLocaleInput.value.trim();
        locale = custom.length > 0 ? custom : null;
      } else {
        locale = localeSel.value;
      }
      close({
        title: titleInput.value.trim(),
        slug: slugInput.value.trim(),
        locale: locale,
      });
    }
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) close(null);
    });
    cancel.addEventListener('click', () => {
      close(null);
    });
    ok.addEventListener('click', submit);
    document.addEventListener('keydown', onKey, true);

    document.body.classList.add('opencanvas-modal-open');
    document.body.appendChild(backdrop);
    titleInput.focus();
    // Start in disabled state; validate runs after the first input.
    ok.disabled = true;
    validate();
  });
}

// ---- openAlertModal ----------------------------------------------------

export function openAlertModalImpl(
  ctx: EditorContext,
  opts: AlertModalOpts,
): Promise<void> {
  if (ctx.modalOpen) {
    throw new Error('openAlertModal: another modal is already open');
  }
  const title = typeof opts.title === 'string' ? opts.title : '';
  const message = typeof opts.message === 'string' ? opts.message : '';
  ctx.modalOpen = true;
  return new Promise<void>((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'opencanvas-modal-backdrop';
    const panel = document.createElement('div');
    panel.className = 'opencanvas-modal';
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    if (title) panel.setAttribute('aria-label', title);
    if (title) {
      const h = document.createElement('h3');
      h.textContent = title;
      panel.appendChild(h);
    }
    const p = document.createElement('p');
    p.style.cssText =
      'margin:0 0 14px;font-size:13px;color:var(--opencanvas-fg-mute);line-height:1.5';
    p.textContent = message;
    panel.appendChild(p);
    const actions = document.createElement('div');
    actions.className = 'opencanvas-modal-actions';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'OK';
    actions.appendChild(ok);
    panel.appendChild(actions);
    backdrop.appendChild(panel);
    function close(): void {
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      document.body.classList.remove('opencanvas-modal-open');
      ctx.modalOpen = false;
      resolve(undefined);
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === 'Escape' || ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        close();
      }
    }
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) close();
    });
    ok.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.classList.add('opencanvas-modal-open');
    document.body.appendChild(backdrop);
    ok.focus();
  });
}
