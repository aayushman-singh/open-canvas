// src/canvas/elements/form.ts
//
// Wave 2 #7 — Forms subsystem renderer.
//
// Emits a real semantic <form method="post" action="/__rev01/forms/<siteId>/<id>">.
// Every visible field becomes an <input>/<textarea>/<select>; the field id is
// reused as the form-data key so the submit-handler payload shape is stable
// and deterministic.
//
// A Cloudflare Turnstile widget is inserted before the submit button when a
// public Turnstile site key has been configured at module-init time (see
// `configureFormRender` below). The submit-side validator is the source of
// truth for bot protection; the widget is the Visitor-facing token producer.
//
// -- Turnstile site key plumbing decision (Wave 2 #7) -----------------------
//
// The shared `ElementRenderCtx` (`src/canvas/elements/index.ts`) is Phase-0
// frozen — Wave 2 cannot edit it without re-opening the contract. The
// Turnstile public site key is per-deployment (single `env.TURNSTILE_SITE_KEY`
// secret), not per-element nor per-page, so it doesn't need to ride on the
// per-render context anyway. Wave-2-owned `configureFormRender({...})` is
// called once by the main thread during Worker boot (after env vars are
// available, before any request fires) and the renderer reads the module-
// local value. If the configure function is never called, the renderer
// silently omits the widget — the submit-side handler still hard-fails on a
// missing Turnstile token, so the bot-protection invariant holds.
//
// This is documented in the implementation notes in the plan brief and is
// the only "extension to the render ctx" Wave 2 needs. Future waves that
// need true per-render ctx data must coordinate with the main thread to
// extend `ElementRenderCtx`.

import { escapeAttr, escapeHtml } from './render-utils.js';
import type { BaseElement } from '../schema.js';

export type FormFieldKind = 'text' | 'email' | 'textarea' | 'checkbox' | 'select';

export interface FormFieldDef {
  id: string;
  label: string;
  kind: FormFieldKind;
  required: boolean;
  placeholder?: string;
  /** For `kind === 'select'` only. Ignored otherwise. */
  options?: Array<{ value: string; label: string }>;
}

export interface FormElement extends BaseElement {
  type: 'form';
  fields: FormFieldDef[];
  submitLabel: string;
  successMessage: string;
  /** Optional webhook to POST submission JSON to (signed via HMAC). */
  webhookUrl?: string;
}

export interface FormRenderCtx {
  siteId: string;
  pageSlug: string;
  styleKit: string;
}

// ---------------------------------------------------------------------------
// Module-local configuration set by `configureFormRender`. The renderer reads
// these values when emitting the widget block. Defaults are "no widget" so
// dev environments and smokes that don't configure Turnstile render without it.
// ---------------------------------------------------------------------------

interface FormRenderConfig {
  turnstileSiteKey: string | null;
}

const config: FormRenderConfig = {
  turnstileSiteKey: null,
};

/**
 * Wire the renderer's Turnstile site key once at Worker boot. Subsequent calls
 * overwrite the value, which is how the smoke harness restores defaults
 * between assertions. Pass `null` to disable Turnstile widget emission.
 *
 * Main-thread integration: call this from the Worker init path with
 * `env.TURNSTILE_SITE_KEY` before mounting the forms routers.
 */
export function configureFormRender(next: { turnstileSiteKey: string | null }): void {
  config.turnstileSiteKey = next.turnstileSiteKey;
}

/** @internal Used by the smoke to inspect the current configuration. */
export function getFormRenderConfigForTest(): Readonly<FormRenderConfig> {
  return config;
}

function renderField(field: FormFieldDef, formId: string): string {
  const fieldId = `rev01-form-${formId}-${field.id}`;
  const safeName = escapeAttr(field.id);
  const safeLabel = escapeHtml(field.label);
  const requiredAttr = field.required ? ' required' : '';
  const placeholderAttr =
    typeof field.placeholder === 'string' && field.placeholder.length > 0
      ? ` placeholder="${escapeAttr(field.placeholder)}"`
      : '';

  switch (field.kind) {
    case 'text':
    case 'email': {
      const inputType = field.kind === 'email' ? 'email' : 'text';
      return [
        `<label class="rev01-form-field" for="${escapeAttr(fieldId)}">`,
        `<span class="rev01-form-label">${safeLabel}</span>`,
        `<input class="rev01-form-input" type="${inputType}" id="${escapeAttr(fieldId)}" name="${safeName}"${placeholderAttr}${requiredAttr} />`,
        `</label>`,
      ].join('');
    }
    case 'textarea': {
      return [
        `<label class="rev01-form-field" for="${escapeAttr(fieldId)}">`,
        `<span class="rev01-form-label">${safeLabel}</span>`,
        `<textarea class="rev01-form-input" id="${escapeAttr(fieldId)}" name="${safeName}"${placeholderAttr}${requiredAttr} rows="4"></textarea>`,
        `</label>`,
      ].join('');
    }
    case 'checkbox': {
      // Checkbox label sits AFTER the input so visual + screen-reader UX both
      // read "checkbox + label". The wrapping <label> expands the click target.
      return [
        `<label class="rev01-form-field rev01-form-field-checkbox" for="${escapeAttr(fieldId)}">`,
        `<input class="rev01-form-checkbox" type="checkbox" id="${escapeAttr(fieldId)}" name="${safeName}" value="on"${requiredAttr} />`,
        `<span class="rev01-form-label">${safeLabel}</span>`,
        `</label>`,
      ].join('');
    }
    case 'select': {
      const options = Array.isArray(field.options) ? field.options : [];
      const optionsHtml = options
        .map((opt) => `<option value="${escapeAttr(opt.value)}">${escapeHtml(opt.label)}</option>`)
        .join('');
      return [
        `<label class="rev01-form-field" for="${escapeAttr(fieldId)}">`,
        `<span class="rev01-form-label">${safeLabel}</span>`,
        `<select class="rev01-form-input" id="${escapeAttr(fieldId)}" name="${safeName}"${requiredAttr}>`,
        optionsHtml,
        `</select>`,
        `</label>`,
      ].join('');
    }
  }
}

export function renderForm(el: FormElement, ctx: FormRenderCtx): string {
  const action = `/__rev01/forms/${encodeURIComponent(ctx.siteId)}/${encodeURIComponent(el.id)}`;
  const fieldsHtml = el.fields.map((field) => renderField(field, el.id)).join('');

  // Turnstile widget. The Cloudflare-managed JS loader script is emitted next
  // to the widget; the Cloudflare CDN caches it so multiple forms on the same
  // page share a single network fetch. Renderer pure-HTML output only — no
  // JS-side handlers.
  const turnstileSiteKey = config.turnstileSiteKey;
  const turnstileBlock =
    typeof turnstileSiteKey === 'string' && turnstileSiteKey.length > 0
      ? [
          `<div class="cf-turnstile" data-sitekey="${escapeAttr(turnstileSiteKey)}"></div>`,
          `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`,
        ].join('')
      : '';

  return [
    `<form class="rev01-form" method="post" action="${escapeAttr(action)}" data-form-id="${escapeAttr(el.id)}">`,
    `<input type="hidden" name="pageSlug" value="${escapeAttr(ctx.pageSlug)}" />`,
    fieldsHtml,
    turnstileBlock,
    `<button class="rev01-form-submit" type="submit">${escapeHtml(el.submitLabel)}</button>`,
    `<p class="rev01-form-success" data-success-text="${escapeAttr(el.successMessage)}">${escapeHtml(el.successMessage)}</p>`,
    `</form>`,
  ].join('');
}

// Section Recipe id reserved for "contact-form" — factory lives in the forms
// feature dir; the registry slot is reserved here so the recipes module can
// import the name without circular dependency on Wave 2 code.
export const FORM_RECIPE_ID = 'contact-form' as const;
