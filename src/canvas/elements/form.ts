// src/canvas/elements/form.ts
//
// Forms subsystem renderer.
//
// Emits a real semantic <form method="post" action="/__rev01/forms/<siteId>/<id>">.
// Every visible field becomes an <input>/<textarea>/<select>; the field id is
// reused as the form-data key so the submit-handler payload shape is stable
// and deterministic.
//
// A Cloudflare Turnstile widget is always emitted before the submit button.
// The renderer takes the public site key on the per-render context; callers
// resolve it from env. A null/empty key surfaces as a thrown error at the
// boundary where rendering is initiated — the submit-side validator hard-
// fails on a missing token, so a no-widget form would be unsubmittable dead
// UX, never an acceptable degraded mode.

import type { InspectorSpec } from './inspector-spec.js';
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
  /**
   * Cloudflare Turnstile public site key. Always non-empty; resolved by the
   * caller from env. Missing env at the boundary throws via
   * requireTurnstileSiteKey, not here.
   */
  turnstileSiteKey: string;
}

/**
 * Resolve env.TURNSTILE_SITE_KEY into a non-empty string or throw. The single
 * boundary where the env contract is enforced; every call site that wants to
 * render the canvas threads the result through ElementRenderCtx.
 */
export function requireTurnstileSiteKey(env: { TURNSTILE_SITE_KEY?: string | undefined }): string {
  const key = env.TURNSTILE_SITE_KEY;
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error(
      'TURNSTILE_SITE_KEY env var must be a non-empty string. Forms cannot render without ' +
        'a public Turnstile site key — the submit-side validator hard-fails on a missing token.',
    );
  }
  return key;
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
  const turnstileBlock = [
    `<div class="cf-turnstile" data-sitekey="${escapeAttr(ctx.turnstileSiteKey)}"></div>`,
    `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`,
  ].join('');

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

export const formInspectorSpec: InspectorSpec = {
  fields: [
    // Per-field editor with per-kind discriminated sub-fields: every field
    // has label + kind + required, but placeholder is hidden when kind is
    // checkbox, and an options-list editor appears when kind is select.
    // Imperative because re-rendering the card on kind-change is the only
    // way to swap the conditional sub-fields without a declarative
    // visible-when machinery (ADR 0011 dec 3 generalize on demand).
    { kind: 'custom-mount', name: 'form-fields' },
    { kind: 'text', label: 'Submit label', path: 'submitLabel' },
    { kind: 'text', label: 'Success message', path: 'successMessage' },
    {
      kind: 'text',
      label: 'Webhook URL',
      path: 'webhookUrl',
      placeholder: 'https://...',
      noRebuild: true,
    },
  ],
};
