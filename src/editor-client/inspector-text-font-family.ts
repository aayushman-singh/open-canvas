// src/editor-client/inspector-text-font-family.ts
//
// Custom-mount handler for the text element inspector's "Font family"
// field. Two source lists, one dropdown:
//
//   1. Preloaded free presets (FONT_PRESETS) — pulled directly off the
//      shared catalog so the editor + the published page render the
//      same set of names. The Google Fonts `<link>` on the document
//      shell preloads every preset; selecting one in the dropdown is
//      instant.
//
//   2. Site-uploaded custom fonts — read off `ctx.siteFonts`, which the
//      boot payload seeds from a server-side fetch of
//      `GET /api/sites/:siteId/fonts`. Refreshed in place after every
//      successful upload + delete so the dropdown re-renders against
//      the current set without a round-trip per open.
//
// The "+ Upload custom font…" sentinel option opens a hidden file
// picker; on selection the file POSTs multipart to
// `/api/sites/:siteId/fonts`, the cached list updates, the @font-face
// stylesheet refreshes, and the new font is auto-selected on the
// current text element.
//
// Each custom font row has an inline "×" delete affordance that
// confirms via `window.__opencanvasModal.confirm`, then DELETEs the
// row and unsets the element.elementStyle.fontFamily slot only if the
// deleted font was the active selection (no point clearing a different
// element's choice).
//
// Failure modes (per the All-or-Nothing policy):
//   - Upload server failure → red toast via ctx.setStatus(..., 'error');
//     dropdown stays on the prior selection.
//   - Delete server failure → red toast; the row stays visible.
//   - Confirm dismissed → no-op.
//   - Mount fired on a non-text element → mount is silently inert
//     (renderInspectorSpec only dispatches text-font-family for text
//     elements; defensive guard surfaces a console.error and bails).

import type { CanvasElement, TextElement } from '../canvas/schema.js';
import { emitAllFontFaceBlocks } from '../fonts/face-emit.js';
import { FONT_PRESETS, type FontPreset } from '../fonts/preset-catalog.js';

import type { EditorContext, SiteFontEntry } from './editor-context.js';

export const KIT_DEFAULT_VALUE = '__kit-default__';
export const UPLOAD_TRIGGER_VALUE = '__upload-custom-font__';
/** Server-side limit lives in src/fonts/validate.ts; mirror here for the
 *  pre-flight UX so the user sees a status line BEFORE the multipart
 *  upload eats the network budget. Kept loose: the server is the source
 *  of truth and will reject anything oversize regardless. */
export const CLIENT_FILE_SIZE_CAP_BYTES = 2 * 1024 * 1024;
export const EDITOR_FONT_FACE_STYLE_TAG_ID = 'opencanvas-editor-custom-fonts';
const STYLE_TAG_ID = EDITOR_FONT_FACE_STYLE_TAG_ID;

/**
 * Recompute and write the `<style id="opencanvas-editor-custom-fonts">`
 * tag so the editor canvas resolves any custom-font family name the
 * Owner has on an element. Called after every list mutation (upload +
 * delete) so the editor preview matches the published page byte for
 * byte.
 *
 * SSR primes this tag on the initial page; subsequent client-side
 * refreshes replace the whole block (no per-font diffing because the
 * full list is small — 10s of rows at most per site).
 */
export function refreshEditorFontFaceStyleTag(siteFonts: ReadonlyArray<SiteFontEntry>): void {
  let tag = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement('style');
    tag.id = STYLE_TAG_ID;
    document.head.appendChild(tag);
  }
  // Share the @font-face emitter with the public-page render path so the
  // editor preview and the published page stay byte-identical. The
  // emitter is pure string-ops over the row shape, no
  // Cloudflare-Worker- or Node-specific bindings, so it imports cleanly
  // under the editor-client tsconfig.
  tag.textContent = emitAllFontFaceBlocks(siteFonts);
}

/**
 * Build the dropdown <option> list: a "(Style kit default)" sentinel,
 * each preset chain, every uploaded custom font, then the "+ Upload"
 * sentinel last. Custom fonts are appended after presets so the Owner's
 * own additions stay together and don't get visually shuffled by alpha
 * sorting across the whole list.
 */
export function buildFontOptions(
  select: HTMLSelectElement,
  presets: ReadonlyArray<FontPreset>,
  siteFonts: ReadonlyArray<SiteFontEntry>,
  current: string | undefined,
): void {
  select.replaceChildren();
  const defaultOpt = document.createElement('option');
  defaultOpt.value = KIT_DEFAULT_VALUE;
  defaultOpt.textContent = '(Style kit default)';
  select.appendChild(defaultOpt);

  const sansGroup = document.createElement('optgroup');
  sansGroup.label = 'Sans';
  const serifGroup = document.createElement('optgroup');
  serifGroup.label = 'Serif';
  const monoGroup = document.createElement('optgroup');
  monoGroup.label = 'Mono';
  for (const preset of presets) {
    const opt = document.createElement('option');
    opt.value = preset.cssFamily;
    opt.textContent = preset.label;
    if (preset.group === 'sans') sansGroup.appendChild(opt);
    else if (preset.group === 'serif') serifGroup.appendChild(opt);
    else monoGroup.appendChild(opt);
  }
  if (sansGroup.children.length > 0) select.appendChild(sansGroup);
  if (serifGroup.children.length > 0) select.appendChild(serifGroup);
  if (monoGroup.children.length > 0) select.appendChild(monoGroup);

  if (siteFonts.length > 0) {
    const customGroup = document.createElement('optgroup');
    customGroup.label = 'Custom (uploaded)';
    for (const font of siteFonts) {
      const opt = document.createElement('option');
      opt.value = font.name;
      opt.textContent = `${font.name} (custom)`;
      opt.setAttribute('data-site-font-id', font.id);
      customGroup.appendChild(opt);
    }
    select.appendChild(customGroup);
  }

  const uploadOpt = document.createElement('option');
  uploadOpt.value = UPLOAD_TRIGGER_VALUE;
  uploadOpt.textContent = '+ Upload custom font…';
  select.appendChild(uploadOpt);

  // Reflect current selection. If the element's stored fontFamily doesn't
  // match any option (e.g. an arbitrary value set by the AI agent), we
  // synthesize an extra option so the value isn't silently dropped — the
  // dropdown shows what's actually on the element, no fallback magic.
  if (current === undefined || current === '') {
    select.value = KIT_DEFAULT_VALUE;
  } else {
    const exists = Array.from(select.options).some((o) => o.value === current);
    if (!exists) {
      const extra = document.createElement('option');
      extra.value = current;
      extra.textContent = `(current) ${current}`;
      select.insertBefore(extra, select.options[1] ?? null);
    }
    select.value = current;
  }
}

/**
 * Derive a sensible Owner-visible display name from an uploaded
 * filename. The font-upload route requires both `name` (CSS family) and
 * `family` (classification). We map filename → name via title-case +
 * extension strip; the user can rename later via a manage-fonts UI (not
 * shipped in v1 — display name editing is deferred).
 */
export function deriveDisplayName(filename: string): string {
  const base = filename.replace(/\.[A-Za-z0-9]+$/, '');
  const words = base.replace(/[_-]+/g, ' ').trim().split(/\s+/);
  if (words.length === 0 || words[0] === '') return 'Custom Font';
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Crude classification from filename — "Serif" → 'serif',
 * "Mono"/"Code" → 'mono', everything else → 'sans'. The route validates
 * for non-empty string; the actual classification only feeds future
 * group filtering in the inspector, so a wrong guess is reversible.
 */
export function guessFontFamilyClass(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes('mono') || lower.includes('code')) return 'mono';
  if (lower.includes('serif') || lower.includes('garamond') || lower.includes('playfair'))
    return 'serif';
  return 'sans';
}

async function uploadFontFile(
  ctx: EditorContext,
  file: File,
): Promise<SiteFontEntry> {
  const displayName = deriveDisplayName(file.name);
  const familyClass = guessFontFamilyClass(file.name);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', displayName);
  formData.append('family', familyClass);
  const url = `${ctx.apiBase}/sites/${encodeURIComponent(ctx.siteId)}/fonts`;
  const response = await ctx.authFetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body && typeof body.error === 'string' && body.error.length > 0) {
        detail = body.error;
      }
    } catch {
      // body wasn't JSON — keep the status-line detail
    }
    throw new Error(detail);
  }
  const body = (await response.json()) as {
    id?: string;
    siteId?: string;
    name?: string;
    family?: string;
    weight?: number;
    style?: 'normal' | 'italic';
    contentHash?: string;
  };
  if (
    !body ||
    typeof body.id !== 'string' ||
    typeof body.name !== 'string' ||
    typeof body.family !== 'string' ||
    typeof body.weight !== 'number' ||
    typeof body.contentHash !== 'string' ||
    (body.style !== 'normal' && body.style !== 'italic')
  ) {
    throw new Error('upload response missing expected fields (id/name/family/weight/style/contentHash)');
  }
  return {
    id: body.id,
    name: body.name,
    family: body.family,
    weight: body.weight,
    style: body.style,
    contentHash: body.contentHash,
  };
}

async function deleteFontRow(ctx: EditorContext, fontId: string): Promise<void> {
  const url = `${ctx.apiBase}/sites/${encodeURIComponent(ctx.siteId)}/fonts/${encodeURIComponent(fontId)}`;
  const response = await ctx.authFetch(url, { method: 'DELETE' });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body && typeof body.error === 'string' && body.error.length > 0) {
        detail = body.error;
      }
    } catch {
      // non-JSON body
    }
    throw new Error(detail);
  }
}

/**
 * Public mount handler — registered in
 * src/editor-client/runtime-helpers.ts under the key 'text-font-family'.
 * The interpreter (renderInspectorSpec) hands us the element + the
 * inspector host element; we own the imperative DOM from there.
 */
export function mountTextFontFamily(
  ctx: EditorContext,
  element: CanvasElement,
  host: HTMLElement,
): void {
  if (element.type !== 'text') {
    // Defensive: only text elements wire this mount, but a fixture drift
    // shouldn't silently render an inspector mid-text.
    console.error(
      `mountTextFontFamily: refused to mount on element type ${JSON.stringify(element.type)}`,
    );
    return;
  }
  // After the type guard above the discriminated union narrows to
  // TextElement; the explicit `: TextElement` annotation pins the local
  // alias for downstream reads (`text.elementStyle`, `text.id`, etc.).
  const text: TextElement = element;

  // -- DOM scaffolding -------------------------------------------------
  const row = document.createElement('div');
  row.className = 'style-row';
  row.style.flexDirection = 'column';
  row.style.alignItems = 'stretch';
  row.style.gap = '6px';

  const select = document.createElement('select');
  select.setAttribute('data-text-font-family', 'true');
  select.style.width = '100%';

  // Hidden file input lives inside the row so .click() works under
  // Chromium's user-gesture security policy — mirrors the bg-image
  // upload pattern in element-inspector.ts.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.woff2,.woff,.ttf,.otf,font/woff2';
  fileInput.style.display = 'none';
  fileInput.setAttribute('data-text-font-family-upload', 'true');

  const customRowsHost = document.createElement('div');
  customRowsHost.style.display = 'flex';
  customRowsHost.style.flexDirection = 'column';
  customRowsHost.style.gap = '2px';
  customRowsHost.setAttribute('data-text-font-family-custom-list', 'true');

  row.appendChild(select);
  row.appendChild(customRowsHost);
  row.appendChild(fileInput);

  const label = document.createElement('label');
  label.className = 'field';
  const labelText = document.createElement('span');
  labelText.className = 'field-label';
  labelText.textContent = 'Font family';
  label.appendChild(labelText);
  label.appendChild(row);
  host.appendChild(label);

  // -- Initial render --------------------------------------------------
  function repaintDropdown(): void {
    buildFontOptions(select, FONT_PRESETS, ctx.siteFonts, text.elementStyle?.fontFamily);
    repaintCustomList();
  }

  function repaintCustomList(): void {
    customRowsHost.replaceChildren();
    if (ctx.siteFonts.length === 0) return;
    const header = document.createElement('div');
    header.style.fontSize = '11px';
    header.style.opacity = '0.65';
    header.style.marginTop = '4px';
    header.textContent = 'Uploaded fonts';
    customRowsHost.appendChild(header);
    for (const font of ctx.siteFonts) {
      const itemRow = document.createElement('div');
      itemRow.style.display = 'flex';
      itemRow.style.alignItems = 'center';
      itemRow.style.justifyContent = 'space-between';
      itemRow.style.gap = '6px';
      itemRow.style.padding = '2px 0';
      itemRow.setAttribute('data-site-font-row', font.id);

      const name = document.createElement('span');
      name.textContent = font.name;
      name.style.fontFamily = `'${font.name}', system-ui, sans-serif`;
      name.style.fontSize = '12px';
      name.style.flex = '1';
      name.style.overflow = 'hidden';
      name.style.textOverflow = 'ellipsis';
      name.style.whiteSpace = 'nowrap';
      itemRow.appendChild(name);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'style-btn-clear';
      delBtn.textContent = '×';
      delBtn.title = `Delete ${font.name}`;
      delBtn.setAttribute('aria-label', `Delete ${font.name}`);
      delBtn.setAttribute('data-text-font-family-delete', font.id);
      delBtn.addEventListener('click', function () {
        void handleDelete(font);
      });
      itemRow.appendChild(delBtn);

      customRowsHost.appendChild(itemRow);
    }
  }

  function setElementFontFamily(value: string | null): void {
    ctx.captureForUndo();
    const es = text.elementStyle ?? {};
    if (value === null) {
      delete es.fontFamily;
    } else {
      es.fontFamily = value;
    }
    // Drop the slot entirely when no per-element overrides remain so the
    // saved JSON doesn't carry an empty `elementStyle: {}` shell.
    let empty = true;
    for (const k in es) {
      if ((es as Record<string, unknown>)[k] !== undefined) {
        empty = false;
        break;
      }
    }
    if (empty) {
      delete text.elementStyle;
    } else {
      text.elementStyle = es;
    }
    ctx.rebuildElement(text.id);
    ctx.scheduleSave();
  }

  // -- Upload trigger --------------------------------------------------
  function openFilePicker(): void {
    fileInput.value = '';
    fileInput.click();
  }

  fileInput.addEventListener('change', function () {
    const files = fileInput.files;
    if (!files || files.length === 0) return;
    const file = files[0]!;
    if (file.size > CLIENT_FILE_SIZE_CAP_BYTES) {
      ctx.setStatus(
        `Font file too large (${String(Math.round(file.size / 1024))} KB) — ${String(
          Math.round(CLIENT_FILE_SIZE_CAP_BYTES / 1024),
        )} KB limit`,
        'error',
      );
      // Reset dropdown to whatever was active before — DON'T leave the
      // upload sentinel selected.
      buildFontOptions(select, FONT_PRESETS, ctx.siteFonts, text.elementStyle?.fontFamily);
      return;
    }
    ctx.setStatus('Uploading font…', 'info');
    uploadFontFile(ctx, file)
      .then(function (uploaded) {
        // Replace any prior row with the same id (re-upload-dedup);
        // otherwise append.
        const existingIdx = ctx.siteFonts.findIndex((f) => f.id === uploaded.id);
        if (existingIdx >= 0) {
          ctx.siteFonts[existingIdx] = uploaded;
        } else {
          ctx.siteFonts.push(uploaded);
        }
        refreshEditorFontFaceStyleTag(ctx.siteFonts);
        setElementFontFamily(uploaded.name);
        repaintDropdown();
        ctx.setStatus(`Font "${uploaded.name}" added`, 'ok');
      })
      .catch(function (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.setStatus(`Font upload failed: ${message}`, 'error');
        // Restore the prior selection in the dropdown.
        buildFontOptions(select, FONT_PRESETS, ctx.siteFonts, text.elementStyle?.fontFamily);
      });
  });

  select.addEventListener('change', function () {
    const value = select.value;
    if (value === UPLOAD_TRIGGER_VALUE) {
      openFilePicker();
      // Reset visual selection to the active value — the upload sentinel
      // is a trigger, not a persistent choice.
      buildFontOptions(select, FONT_PRESETS, ctx.siteFonts, text.elementStyle?.fontFamily);
      return;
    }
    if (value === KIT_DEFAULT_VALUE) {
      setElementFontFamily(null);
      return;
    }
    setElementFontFamily(value);
  });

  async function handleDelete(font: SiteFontEntry): Promise<void> {
    const confirmFn =
      typeof window !== 'undefined' && window.__opencanvasModal && window.__opencanvasModal.confirm
        ? window.__opencanvasModal.confirm
        : null;
    let confirmed = false;
    if (confirmFn) {
      confirmed = await confirmFn({
        title: 'Delete font?',
        message: `"${font.name}" will be removed from this site. Any element still pointing at it will fall back to the style-kit default.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep',
      });
    } else {
      // Defensive fallback only — the editor route registers the modal
      // helper at boot; the absence is a boot-order bug. Surface it
      // instead of silently confirming.
      ctx.setStatus('Cannot confirm delete — modal helper missing', 'error');
      return;
    }
    if (!confirmed) return;
    try {
      await deleteFontRow(ctx, font.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.setStatus(`Delete failed: ${message}`, 'error');
      return;
    }
    const idx = ctx.siteFonts.findIndex((f) => f.id === font.id);
    if (idx >= 0) ctx.siteFonts.splice(idx, 1);
    refreshEditorFontFaceStyleTag(ctx.siteFonts);
    // If the deleted font was the active selection on THIS element,
    // clear it. Other elements that referenced the same name are
    // unchanged here — they'll surface a fallback at next render.
    if (text.elementStyle?.fontFamily === font.name) {
      setElementFontFamily(null);
    }
    repaintDropdown();
    ctx.setStatus(`Font "${font.name}" deleted`, 'ok');
  }

  repaintDropdown();
}

declare global {
  interface Window {
    __opencanvasModal?: {
      confirm?: (opts: {
        title?: string;
        message?: string;
        confirmLabel?: string;
        cancelLabel?: string;
      }) => Promise<boolean>;
    };
  }
}
