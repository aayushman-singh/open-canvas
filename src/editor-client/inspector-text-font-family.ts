// src/editor-client/inspector-text-font-family.ts
//
// Custom-mount handler for the text element inspector's "Font family"
// field (text-font-family). Two source lists feed one dropdown:
//
//   1. Preloaded free presets (FONT_PRESETS) — the curated 11-font list
//      shipped to both editor + published page. The Google Fonts
//      <link> on the document shell preloads every preset, so selecting
//      one in the dropdown is instant.
//
//   2. Site-uploaded custom fonts — read off `ctx.customFonts`, which
//      the boot path seeds from `GET /api/sites/:siteId/fonts` and
//      refreshes after every upload + delete so the dropdown reflects
//      the current set without a per-open round-trip.
//
// A "(Style kit default)" sentinel option appears at the top and clears
// `element.pinnedStyle["font-family"]` (deleting the key so the element
// inherits whichever font-family the active Style Kit's
// `--opencanvas-kit-font-*` variables resolve to).
//
// A "+ Upload custom font…" sentinel option appears at the bottom and
// opens a hidden `<input type="file">` constrained to `.woff2` (the
// server-side validator at src/fonts/validate.ts accepts WOFF2 only).
// On selection the file POSTs multipart to `/api/sites/:siteId/fonts`,
// the cached list refreshes, the @font-face stylesheet refreshes, and
// the new font is auto-selected on the current text element.
//
// Each custom font row has an inline "×" delete affordance below the
// dropdown that confirms via `window.__opencanvasModal.confirm`, then
// DELETEs the row. After the delete the active selection on this
// element is cleared if it was pointing at the deleted font; other
// elements that referenced the same name fall back to the kit default
// at next render.
//
// Storage: `pinnedStyle["font-family"]`. NOT `elementStyle.fontFamily`
// — per BaseElement.pinnedStyle's docblock, `font-family` is an
// explicitly named typography-ornament key that lives in pinnedStyle
// rather than being promoted to a structured ElementStyle field. The
// schema validator (validatePinnedStyle) accepts arbitrary CSS-key
// strings under /^[a-zA-Z-]+$/ and rejects only structural delimiters
// (`;`, `{`, `}`, control chars, `</`) in the value — the family chain
// `"Inter", sans-serif` passes cleanly.
//
// Failure modes (per the All-or-Nothing policy in CLAUDE.md):
//   - Upload server failure → red toast via ctx.setStatus(..., 'error');
//     dropdown reverts to the prior selection. No silent retry.
//   - Delete server failure → red toast; the row stays visible.
//   - Confirm dismissed → no-op.
//   - Mount fired on a non-text element → console.error + bail. The
//     spec-driven dispatcher only fires this mount for text elements;
//     a defensive guard here surfaces a fixture drift loudly.

import type { TextElement } from '../canvas/elements/text.js';
import { FONT_PRESETS, type FontPreset } from '../fonts/preset-catalog.js';
import { emitAllSiteFontFaceBlocks } from '../fonts/face-emit.js';

import type { CanvasElement } from '../canvas/schema.js';
import type { EditorContext, EditorCustomFont } from './editor-context.js';
import { field } from './dom-builders.js';

/** Sentinel `<option>` value for "(Style kit default)". `__`-prefixed so
 *  it cannot collide with a real CSS font-family chain. */
export const KIT_DEFAULT_VALUE = '__kit-default__';
/** Sentinel `<option>` value for "+ Upload custom font…". */
export const UPLOAD_TRIGGER_VALUE = '__upload-custom-font__';
/** id of the editor-only `<style>` block emitting @font-face for every
 *  uploaded custom font. Shared with smoke + boot path so refresh is
 *  idempotent. */
export const EDITOR_FONT_FACE_STYLE_TAG_ID = 'opencanvas-editor-custom-fonts';
/** Mirror of src/fonts/validate.ts:MAX_FONT_BYTES so the picker can pre-
 *  flight oversized uploads before crossing the network. Server remains
 *  the source of truth; this is the UX latency optimisation. */
export const CLIENT_FILE_SIZE_CAP_BYTES = 1_048_576;

/**
 * Recompute and write the `<style id="opencanvas-editor-custom-fonts">`
 * tag so the editor canvas resolves any custom-font family name the
 * Owner has on an element. Called after every list mutation (upload +
 * delete) so the editor preview matches the published page byte for
 * byte. Idempotent — re-invocation replaces the tag's textContent.
 *
 * `document.head` is guarded because the smoke runs without a full DOM;
 * absence silently no-ops rather than crashing the smoke chain.
 */
export function refreshEditorFontFaceStyleTag(
  customFonts: ReadonlyArray<EditorCustomFont>,
): void {
  const head = (document as Document & { head?: HTMLHeadElement }).head;
  if (!head) return;
  let tag = document.getElementById(EDITOR_FONT_FACE_STYLE_TAG_ID);
  if (!tag) {
    tag = document.createElement('style');
    tag.id = EDITOR_FONT_FACE_STYLE_TAG_ID;
    head.appendChild(tag);
  }
  // Share the @font-face emitter with the public-page render path so the
  // editor preview and the published page stay byte-identical. The
  // emitter is pure string-ops over the row shape — no Cloudflare-Worker-
  // or Node-specific bindings — so it imports cleanly under the
  // editor-client tsconfig.
  tag.textContent = emitAllSiteFontFaceBlocks(customFonts);
}

/**
 * Build the dropdown <option> list:
 *   - "(Style kit default)" sentinel (first)
 *   - Sans / Serif / Mono preset groups
 *   - "Custom (uploaded)" group with one option per uploaded font
 *   - "+ Upload custom font…" sentinel (last)
 *
 * Reflects the current selection by matching the stored font-family
 * chain against either a preset cssFamily or an uploaded font's chain.
 * Anything unrecognised gets a synthesised "(current)" entry so the
 * dropdown never silently drops what's actually on the element.
 */
export function buildFontOptions(
  select: HTMLSelectElement,
  presets: ReadonlyArray<FontPreset>,
  customFonts: ReadonlyArray<EditorCustomFont>,
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

  if (customFonts.length > 0) {
    const customGroup = document.createElement('optgroup');
    customGroup.label = 'Custom (uploaded)';
    for (const font of customFonts) {
      const opt = document.createElement('option');
      opt.value = customFontFamilyValue(font.name);
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

  if (current === undefined || current === '') {
    select.value = KIT_DEFAULT_VALUE;
    return;
  }
  const exists = Array.from(select.options).some((o) => o.value === current);
  if (!exists) {
    const extra = document.createElement('option');
    extra.value = current;
    extra.textContent = `(current) ${current}`;
    // Insert just after the default sentinel so the literal stays
    // visible without burying it inside a group.
    const after = select.options[1] ?? null;
    select.insertBefore(extra, after);
  }
  select.value = current;
}

/**
 * Construct the canonical CSS font-family chain used for an uploaded
 * custom font. The fallback tail (`system-ui, sans-serif`) keeps the
 * paragraph readable while the WOFF2 finishes streaming over the wire —
 * `@font-face { font-display: swap }` then promotes the real face once
 * it lands. `JSON.stringify` quotes the family name so multi-word names
 * (e.g. `"My Display Font"`) stay a single token in the chain.
 */
export function customFontFamilyValue(name: string): string {
  return `${JSON.stringify(name)}, system-ui, sans-serif`;
}

/**
 * Derive a default display name from an uploaded filename. The font
 * upload route requires a non-empty `name` field; we strip the
 * extension and title-case the remaining tokens. The user can rename
 * later via a manage-fonts UI (deferred — out of scope for v1).
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
 * Apply a picker selection to a TextElement's pinnedStyle["font-family"].
 *
 *   - KIT_DEFAULT_VALUE → delete the pin; remove the pinnedStyle object
 *                          when no other keys remain so JSON output
 *                          stays minimal.
 *   - Any other value   → write the value as-is into
 *                          pinnedStyle["font-family"].
 *
 * Returns the resolved CSS value (or empty string when cleared) so
 * callers can surface it in a status line.
 */
export function applyFontFamilySelection(
  element: TextElement,
  selectedValue: string,
): string {
  if (selectedValue === KIT_DEFAULT_VALUE) {
    if (element.pinnedStyle) {
      delete element.pinnedStyle['font-family'];
      if (Object.keys(element.pinnedStyle).length === 0) {
        delete element.pinnedStyle;
      }
    }
    return '';
  }
  if (!element.pinnedStyle) element.pinnedStyle = {};
  element.pinnedStyle['font-family'] = selectedValue;
  return selectedValue;
}

async function uploadFontFile(
  ctx: EditorContext,
  file: File,
): Promise<EditorCustomFont> {
  const displayName = deriveDisplayName(file.name);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', displayName);
  // The server requires a non-empty `family` field but does not render
  // it today; PR #36's discovery was that 'sans-serif' is the safe
  // default until a per-family classifier ships.
  formData.append('family', 'sans-serif');
  const url = `${ctx.apiBase}/sites/${encodeURIComponent(ctx.siteId)}/fonts`;
  const response = await ctx.authFetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (body && typeof body.error === 'string' && body.error.length > 0) {
      detail = body.error;
    }
    throw new Error(detail);
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (
    typeof body.id !== 'string' ||
    typeof body.name !== 'string' ||
    typeof body.family !== 'string' ||
    typeof body.weight !== 'number' ||
    (body.style !== 'normal' && body.style !== 'italic') ||
    typeof body.contentHash !== 'string' ||
    typeof body.byteSize !== 'number'
  ) {
    throw new Error(
      'upload response missing expected fields (id/name/family/weight/style/contentHash/byteSize)',
    );
  }
  return {
    id: body.id,
    name: body.name,
    family: body.family,
    weight: body.weight,
    style: body.style,
    contentHash: body.contentHash,
    byteSize: body.byteSize,
  };
}

async function deleteFontRow(ctx: EditorContext, fontId: string): Promise<void> {
  const url = `${ctx.apiBase}/sites/${encodeURIComponent(ctx.siteId)}/fonts/${encodeURIComponent(fontId)}`;
  const response = await ctx.authFetch(url, { method: 'DELETE' });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (body && typeof body.error === 'string' && body.error.length > 0) {
      detail = body.error;
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
    // Defensive: the spec-driven dispatcher only fires this mount for
    // text elements; a fixture drift shouldn't silently render an
    // inspector mid-text. Surface loudly.
    console.error(
      `mountTextFontFamily: refused to mount on element type ${JSON.stringify(element.type)}`,
    );
    return;
  }
  const text: TextElement = element;

  const select = document.createElement('select');
  select.setAttribute('data-text-font-family', 'true');
  select.style.width = '100%';

  // Hidden file input lives in the same wrapper so .click() works under
  // Chromium's user-gesture security policy — mirrors the bg-image
  // upload pattern used by other inspector mounts.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  // Server validator accepts only WOFF2; we restrict the picker the
  // same way so the Owner cannot stage a doomed upload.
  fileInput.accept = '.woff2';
  fileInput.style.display = 'none';
  fileInput.setAttribute('data-text-font-family-upload', 'true');

  const customRowsHost = document.createElement('div');
  customRowsHost.setAttribute('data-text-font-family-custom-list', 'true');
  customRowsHost.style.display = 'flex';
  customRowsHost.style.flexDirection = 'column';
  customRowsHost.style.gap = '2px';
  customRowsHost.style.marginTop = '6px';

  function repaintCustomList(): void {
    customRowsHost.replaceChildren();
    if (ctx.customFonts.length === 0) return;
    const header = document.createElement('div');
    header.style.fontSize = '11px';
    header.style.opacity = '0.65';
    header.style.marginTop = '4px';
    header.textContent = 'Uploaded fonts';
    customRowsHost.appendChild(header);
    for (const font of ctx.customFonts) {
      const itemRow = document.createElement('div');
      itemRow.setAttribute('data-site-font-row', font.id);
      itemRow.style.display = 'flex';
      itemRow.style.alignItems = 'center';
      itemRow.style.justifyContent = 'space-between';
      itemRow.style.gap = '6px';
      itemRow.style.padding = '2px 0';

      const name = document.createElement('span');
      name.textContent = font.name;
      // Show the name in its own font so the Owner can preview the
      // shape before committing — falls back to system-ui until the
      // @font-face block resolves, identical to the canvas paint path.
      name.style.fontFamily = customFontFamilyValue(font.name);
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
      delBtn.addEventListener('click', () => {
        void handleDelete(font);
      });
      itemRow.appendChild(delBtn);

      customRowsHost.appendChild(itemRow);
    }
  }

  function repaintDropdown(): void {
    buildFontOptions(select, FONT_PRESETS, ctx.customFonts, text.pinnedStyle?.['font-family']);
    repaintCustomList();
  }

  function commitSelection(value: string | null): void {
    ctx.captureForUndo();
    applyFontFamilySelection(text, value === null ? KIT_DEFAULT_VALUE : value);
    ctx.rebuildElement(text.id);
    ctx.scheduleSave();
  }

  function openFilePicker(): void {
    fileInput.value = '';
    fileInput.click();
  }

  fileInput.addEventListener('change', () => {
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
      // Reset dropdown — DON'T leave the upload sentinel selected.
      repaintDropdown();
      return;
    }
    ctx.setStatus('Uploading font…', 'info');
    uploadFontFile(ctx, file)
      .then((uploaded) => {
        const existingIdx = ctx.customFonts.findIndex((f) => f.id === uploaded.id);
        if (existingIdx >= 0) {
          ctx.customFonts[existingIdx] = uploaded;
        } else {
          ctx.customFonts.push(uploaded);
        }
        refreshEditorFontFaceStyleTag(ctx.customFonts);
        commitSelection(customFontFamilyValue(uploaded.name));
        repaintDropdown();
        ctx.setStatus(`Font "${uploaded.name}" added`, 'ok');
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        ctx.setStatus(`Font upload failed: ${message}`, 'error');
        repaintDropdown();
      });
  });

  select.addEventListener('change', () => {
    const value = select.value;
    if (value === UPLOAD_TRIGGER_VALUE) {
      openFilePicker();
      // The upload sentinel is a trigger, not a persistent choice —
      // restore the prior selection in the dropdown immediately.
      repaintDropdown();
      return;
    }
    if (value === KIT_DEFAULT_VALUE) {
      commitSelection(null);
      return;
    }
    commitSelection(value);
  });

  async function handleDelete(font: EditorCustomFont): Promise<void> {
    const modalApi =
      typeof window !== 'undefined' && window.__opencanvasModal
        ? window.__opencanvasModal
        : null;
    const confirmFn = modalApi && modalApi.confirm ? modalApi.confirm : null;
    if (!confirmFn) {
      // Defensive only — the editor route registers the modal helper at
      // boot; absence is a boot-order bug. Surface it instead of
      // silently confirming.
      ctx.setStatus('Cannot confirm delete — modal helper missing', 'error');
      return;
    }
    const confirmed = await confirmFn({
      title: 'Delete font?',
      message: `"${font.name}" will be removed from this site. Any element still pointing at it will fall back to the style-kit default.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    if (!confirmed) return;
    try {
      await deleteFontRow(ctx, font.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.setStatus(`Delete failed: ${message}`, 'error');
      return;
    }
    const idx = ctx.customFonts.findIndex((f) => f.id === font.id);
    if (idx >= 0) ctx.customFonts.splice(idx, 1);
    refreshEditorFontFaceStyleTag(ctx.customFonts);
    // Clear the active selection on THIS element if it was pointing at
    // the deleted font. Other elements referencing the same name are
    // unchanged — they'll fall back to the kit default at next render.
    if (text.pinnedStyle?.['font-family'] === customFontFamilyValue(font.name)) {
      commitSelection(null);
    }
    repaintDropdown();
    ctx.setStatus(`Font "${font.name}" deleted`, 'ok');
  }

  const wrapper = document.createElement('div');
  wrapper.appendChild(select);
  wrapper.appendChild(customRowsHost);
  wrapper.appendChild(fileInput);
  host.appendChild(field('Font family', wrapper));

  repaintDropdown();
}

/**
 * Refresh ctx.customFonts from the server. Called once at boot and
 * after-the-fact by callers that want to pick up server-side mutations
 * (e.g. a future broadcast from another tab). Failures surface a status
 * toast and leave ctx.customFonts as-is.
 */
export async function refreshCustomFontsImpl(ctx: EditorContext): Promise<void> {
  const response = await ctx.authFetch(
    ctx.apiBase + '/sites/' + encodeURIComponent(ctx.siteId) + '/fonts',
  );
  if (!response.ok) {
    ctx.setStatus(`Could not load custom fonts (${String(response.status)})`, 'error');
    return;
  }
  const body = (await response.json()) as { fonts?: unknown };
  const rows: EditorCustomFont[] = [];
  if (Array.isArray(body.fonts)) {
    for (let i = 0; i < body.fonts.length; i++) {
      const row = body.fonts[i] as Record<string, unknown> | null;
      if (!row || typeof row !== 'object') continue;
      // Shape-guard each field; a missing/wrong type skips the row
      // rather than crashing the editor boot. The server schema
      // guarantees these are present + typed on insert, but the editor
      // refuses to trust that contract blindly.
      if (
        typeof row.id !== 'string' ||
        typeof row.name !== 'string' ||
        typeof row.family !== 'string' ||
        typeof row.weight !== 'number' ||
        (row.style !== 'normal' && row.style !== 'italic') ||
        typeof row.contentHash !== 'string' ||
        typeof row.byteSize !== 'number'
      ) {
        continue;
      }
      rows.push({
        id: row.id,
        name: row.name,
        family: row.family,
        weight: row.weight,
        style: row.style,
        contentHash: row.contentHash,
        byteSize: row.byteSize,
      });
    }
  }
  ctx.customFonts = rows;
  refreshEditorFontFaceStyleTag(rows);
  // Re-render the inspector so a fonts refresh while a text element is
  // selected reflects the new options without forcing the Owner to
  // reselect.
  ctx.renderInspector();
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
