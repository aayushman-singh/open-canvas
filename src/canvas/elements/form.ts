// src/canvas/elements/form.ts
//
// Forms subsystem renderer.
//
// Emits a real semantic <form method="post" action="/__opencanvas/forms/<siteId>/<id>">.
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

import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, escapeCssValue, escapeHtml } from './render-utils.js';
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

export const FORM_FONT_FAMILIES = [
  'inherit',
  'kit-display',
  'kit-body',
  'kit-mono',
  'custom',
] as const;
export type FormFontFamily = (typeof FORM_FONT_FAMILIES)[number];

export const FORM_FONT_WEIGHTS = ['normal', 'medium', 'bold'] as const;
export type FormFontWeight = (typeof FORM_FONT_WEIGHTS)[number];

// ADR 0066 — variant-preset layer. First arm (`classic`) reproduces the current
// form look and is the default. Arms set `--opencanvas-form-*` custom props that
// the inner-part CSS already reads, so they compose under any `FormStyle`
// granular override (ADR dec 2). `spotlight` is a pointer-fx variant: its render
// also emits `data-opencanvas-pointer-fx="spotlight"`; its static base (the
// `card` look with a centred glow, from the `--opencanvas-ptr-*` 50% fallbacks)
// is authored + smoke-tested, not a silent fallback (ADR dec 6).
export const FORM_VARIANTS = ['classic', 'underline', 'card', 'brutalist', 'spotlight'] as const;
export type FormVariant = (typeof FORM_VARIANTS)[number];

// Map a variant to the pointer-fx primitive it opts into, or null. Keeps the
// render fn's pointer-fx emission a pure lookup (and the editor mirror agrees).
export function formPointerFx(variant: FormVariant): 'spotlight' | null {
  return variant === 'spotlight' ? 'spotlight' : null;
}

/**
 * Per-form visual overrides. Every field optional. The renderer emits CSS
 * custom-property declarations on the form root and the public stylesheet
 * (src/canvas/public-styles.ts) reads them with style-kit fallbacks, so
 * unset fields inherit the active kit.
 */
export interface FormStyle {
  fontFamily?: FormFontFamily;
  fontFamilyCustom?: string;
  fontSize?: number;
  fieldGap?: number;
  labelColor?: string;
  labelFontSize?: number;
  labelFontWeight?: FormFontWeight;
  inputBackgroundColor?: string;
  inputColor?: string;
  inputBorderColor?: string;
  inputBorderWidth?: number;
  inputBorderRadius?: number;
  inputPaddingX?: number;
  inputPaddingY?: number;
  inputPlaceholderColor?: string;
  inputFocusRingColor?: string;
  submitBackgroundColor?: string;
  submitColor?: string;
  submitHoverBackgroundColor?: string;
  submitBorderColor?: string;
  submitBorderWidth?: number;
  submitBorderRadius?: number;
  submitPaddingX?: number;
  submitPaddingY?: number;
  submitFontSize?: number;
  submitFontWeight?: FormFontWeight;
  submitFullWidth?: boolean;
}

export interface FormElement extends BaseElement {
  type: 'form';
  fields: FormFieldDef[];
  submitLabel: string;
  successMessage: string;
  /**
   * Optional operator-facing name for this form. Used by the dashboard
   * forms inbox row label and the export.csv filename so the owner sees
   * "Contact form" / "Newsletter signup" instead of the auto-generated
   * element id (el-form-xxxx). Renderer ignores it — it never shows on
   * the visitor page.
   */
  title?: string;
  /** ADR 0066 — visual preset. Absent resolves to `classic` (current look). */
  variant?: FormVariant;
  /** Optional webhook to POST submission JSON to (signed via HMAC). */
  webhookUrl?: string;
  /**
   * Optional per-form visual customisation. Renders as CSS-variable
   * overrides on the form root; absent fields fall through to the kit.
   */
  formStyle?: FormStyle;
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
  const fieldId = `opencanvas-form-${formId}-${field.id}`;
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
        `<label class="opencanvas-form-field" for="${escapeAttr(fieldId)}">`,
        `<span class="opencanvas-form-label">${safeLabel}</span>`,
        `<input class="opencanvas-form-input" type="${inputType}" id="${escapeAttr(fieldId)}" name="${safeName}"${placeholderAttr}${requiredAttr} />`,
        `</label>`,
      ].join('');
    }
    case 'textarea': {
      return [
        `<label class="opencanvas-form-field" for="${escapeAttr(fieldId)}">`,
        `<span class="opencanvas-form-label">${safeLabel}</span>`,
        `<textarea class="opencanvas-form-input" id="${escapeAttr(fieldId)}" name="${safeName}"${placeholderAttr}${requiredAttr} rows="4"></textarea>`,
        `</label>`,
      ].join('');
    }
    case 'checkbox': {
      // Checkbox label sits AFTER the input so visual + screen-reader UX both
      // read "checkbox + label". The wrapping <label> expands the click target.
      return [
        `<label class="opencanvas-form-field opencanvas-form-field-checkbox" for="${escapeAttr(fieldId)}">`,
        `<input class="opencanvas-form-checkbox" type="checkbox" id="${escapeAttr(fieldId)}" name="${safeName}" value="on"${requiredAttr} />`,
        `<span class="opencanvas-form-label">${safeLabel}</span>`,
        `</label>`,
      ].join('');
    }
    case 'select': {
      const options = Array.isArray(field.options) ? field.options : [];
      const optionsHtml = options
        .map((opt) => `<option value="${escapeAttr(opt.value)}">${escapeHtml(opt.label)}</option>`)
        .join('');
      return [
        `<label class="opencanvas-form-field" for="${escapeAttr(fieldId)}">`,
        `<span class="opencanvas-form-label">${safeLabel}</span>`,
        `<select class="opencanvas-form-input" id="${escapeAttr(fieldId)}" name="${safeName}"${requiredAttr}>`,
        optionsHtml,
        `</select>`,
        `</label>`,
      ].join('');
    }
  }
}

/**
 * Map a FormStyle into a `style="..."` fragment of CSS-variable declarations
 * plus a `data-opencanvas-form-submit-full="1"` flag when submitFullWidth is on.
 * Returns an empty string for both when formStyle is absent — keeps the
 * default render byte-identical to pre-formStyle output.
 */
function formStyleAttrs(fs: FormStyle | undefined): { styleAttr: string; flagAttr: string } {
  if (!fs) return { styleAttr: '', flagAttr: '' };
  const decls: string[] = [];
  const pushString = (name: string, value: string | undefined) => {
    if (value === undefined) return;
    const safe = escapeCssValue(value);
    if (safe === '') return;
    decls.push(`${name}:${safe}`);
  };
  const pushPx = (name: string, value: number | undefined) => {
    if (value === undefined || !Number.isFinite(value)) return;
    decls.push(`${name}:${String(value)}px`);
  };
  const pushRaw = (name: string, value: string) => {
    decls.push(`${name}:${value}`);
  };

  if (fs.fontFamily !== undefined && fs.fontFamily !== 'inherit') {
    if (fs.fontFamily === 'kit-display')
      pushRaw('--opencanvas-form-font-family', 'var(--opencanvas-kit-font-display, inherit)');
    else if (fs.fontFamily === 'kit-body')
      pushRaw('--opencanvas-form-font-family', 'var(--opencanvas-kit-font-body, inherit)');
    else if (fs.fontFamily === 'kit-mono')
      pushRaw('--opencanvas-form-font-family', 'var(--opencanvas-kit-font-mono, inherit)');
    else if (fs.fontFamily === 'custom')
      pushString('--opencanvas-form-font-family', fs.fontFamilyCustom);
  }
  pushPx('--opencanvas-form-font-size', fs.fontSize);
  pushPx('--opencanvas-form-gap', fs.fieldGap);

  pushString('--opencanvas-form-label-color', fs.labelColor);
  pushPx('--opencanvas-form-label-size', fs.labelFontSize);
  if (fs.labelFontWeight !== undefined) {
    const w =
      fs.labelFontWeight === 'normal' ? '400' : fs.labelFontWeight === 'medium' ? '500' : '700';
    pushRaw('--opencanvas-form-label-weight', w);
  }

  pushString('--opencanvas-form-input-bg', fs.inputBackgroundColor);
  pushString('--opencanvas-form-input-color', fs.inputColor);
  pushString('--opencanvas-form-input-border-color', fs.inputBorderColor);
  pushPx('--opencanvas-form-input-border-width', fs.inputBorderWidth);
  pushPx('--opencanvas-form-input-radius', fs.inputBorderRadius);
  pushPx('--opencanvas-form-input-pad-x', fs.inputPaddingX);
  pushPx('--opencanvas-form-input-pad-y', fs.inputPaddingY);
  pushString('--opencanvas-form-placeholder-color', fs.inputPlaceholderColor);
  pushString('--opencanvas-form-focus-ring', fs.inputFocusRingColor);

  pushString('--opencanvas-form-submit-bg', fs.submitBackgroundColor);
  pushString('--opencanvas-form-submit-color', fs.submitColor);
  pushString('--opencanvas-form-submit-hover-bg', fs.submitHoverBackgroundColor);
  pushString('--opencanvas-form-submit-border-color', fs.submitBorderColor);
  pushPx('--opencanvas-form-submit-border-width', fs.submitBorderWidth);
  pushPx('--opencanvas-form-submit-radius', fs.submitBorderRadius);
  pushPx('--opencanvas-form-submit-pad-x', fs.submitPaddingX);
  pushPx('--opencanvas-form-submit-pad-y', fs.submitPaddingY);
  pushPx('--opencanvas-form-submit-size', fs.submitFontSize);
  if (fs.submitFontWeight !== undefined) {
    const w =
      fs.submitFontWeight === 'normal' ? '400' : fs.submitFontWeight === 'medium' ? '500' : '700';
    pushRaw('--opencanvas-form-submit-weight', w);
  }

  const styleAttr = decls.length === 0 ? '' : ` style="${decls.join(';')}"`;
  const flagAttr = fs.submitFullWidth ? ' data-opencanvas-form-submit-full="1"' : '';
  return { styleAttr, flagAttr };
}

export function renderForm(el: FormElement, ctx: FormRenderCtx): string {
  const action = `/__opencanvas/forms/${encodeURIComponent(ctx.siteId)}/${encodeURIComponent(el.id)}`;
  const fieldsHtml = el.fields.map((field) => renderField(field, el.id)).join('');
  const { styleAttr, flagAttr } = formStyleAttrs(el.formStyle);
  // ADR 0066 dec 1 + dec 4 — variant on the root (default first arm), plus the
  // pointer-fx attribute when the chosen variant opts into a cursor-reactive
  // primitive. The pointer-fx attr is what trips runtime injection (dec 5).
  const variant: FormVariant = el.variant ?? 'classic';
  const pointerFx = formPointerFx(variant);
  const variantAttr = ` data-variant="${escapeAttr(variant)}"`;
  const pointerFxAttr =
    pointerFx !== null ? ` data-opencanvas-pointer-fx="${escapeAttr(pointerFx)}"` : '';

  // Turnstile widget. The Cloudflare-managed JS loader script is emitted next
  // to the widget; the Cloudflare CDN caches it so multiple forms on the same
  // page share a single network fetch.
  const turnstileBlock = [
    `<div class="cf-turnstile" data-sitekey="${escapeAttr(ctx.turnstileSiteKey)}"></div>`,
    `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`,
  ].join('');

  // AJAX handler — fetch POST the form, show inline success/error without
  // a full page reload. The script is idempotent (guarded by
  // window.__opencanvasFormHandlerWired) so multiple forms on one page share
  // one wire-up. We progressively enhance: forms still POST normally if
  // JS is blocked (the server's 303 redirect with ?form-ok= keeps
  // working as the no-JS fallback).
  const ajaxScript = `<script>
(function(){
  if (window.__opencanvasFormHandlerWired) return;
  window.__opencanvasFormHandlerWired = true;
  document.addEventListener('submit', async function(ev) {
    var form = ev.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.classList || !form.classList.contains('opencanvas-form')) return;
    ev.preventDefault();
    var btn = form.querySelector('.opencanvas-form-submit');
    var err = form.querySelector('.opencanvas-form-error');
    var success = form.querySelector('.opencanvas-form-success');
    if (btn) { btn.disabled = true; btn.dataset.busy = '1'; }
    if (err) { err.hidden = true; err.textContent = ''; }
    try {
      var data = new FormData(form);
      var res = await fetch(form.action, { method: 'POST', body: data, redirect: 'manual', credentials: 'same-origin' });
      var ok = res.status === 200 || res.status === 302 || res.status === 303 || res.type === 'opaqueredirect';
      if (!ok) {
        var detail = 'Something went wrong. Please try again.';
        try {
          var body = await res.json();
          if (body && body.error === 'turnstile-failed') detail = 'Bot check failed. Please refresh and try again.';
          else if (body && body.error === 'rate-limited') detail = 'Too many submissions. Wait a minute and try again.';
          else if (body && body.error === 'validation-failed') detail = 'Some fields need attention.';
          else if (body && body.detail) detail = body.detail;
        } catch (_) {}
        if (err) { err.textContent = detail; err.hidden = false; }
        return;
      }
      if (success) {
        success.hidden = false;
        // Hide the fields so the success message reads cleanly. Fall
        // back to the form-wrapper if individual fields aren't tagged.
        var fields = form.querySelectorAll('.opencanvas-form-field, .cf-turnstile, .opencanvas-form-submit');
        for (var i = 0; i < fields.length; i++) fields[i].hidden = true;
      }
    } catch (e) {
      if (err) { err.textContent = 'Network error. Please try again.'; err.hidden = false; }
    } finally {
      if (btn) { btn.disabled = false; delete btn.dataset.busy; }
      // Re-render Turnstile so the next submit gets a fresh token.
      try { if (window.turnstile && typeof window.turnstile.reset === 'function') window.turnstile.reset(); } catch (_) {}
    }
  });
})();
</script>`;

  return [
    `<form class="opencanvas-form" method="post" action="${escapeAttr(action)}" data-form-id="${escapeAttr(el.id)}"${variantAttr}${pointerFxAttr}${flagAttr}${styleAttr}>`,
    `<input type="hidden" name="pageSlug" value="${escapeAttr(ctx.pageSlug)}" />`,
    fieldsHtml,
    turnstileBlock,
    `<button class="opencanvas-form-submit" type="submit">${escapeHtml(el.submitLabel)}</button>`,
    `<p class="opencanvas-form-error" role="alert" hidden></p>`,
    `<p class="opencanvas-form-success" data-success-text="${escapeAttr(el.successMessage)}" hidden>${escapeHtml(el.successMessage)}</p>`,
    `</form>`,
    ajaxScript,
  ].join('');
}

// Section Recipe id reserved for "contact-form" — factory lives in the forms
// feature dir; the registry slot is reserved here so the recipes module can
// import the name without circular dependency on Wave 2 code.
export const FORM_RECIPE_ID = 'contact-form' as const;

export const formInspectorSpec: InspectorSpec = {
  fields: [
    {
      kind: 'text',
      label: 'Name',
      path: 'title',
      placeholder: 'Contact form',
      noRebuild: true,
    },
    // Per-field editor with per-kind discriminated sub-fields: every field
    // has label + kind + required, but placeholder is hidden when kind is
    // checkbox, and an options-list editor appears when kind is select.
    // Imperative because re-rendering the card on kind-change is the only
    // way to swap the conditional sub-fields without a declarative
    // visible-when machinery (ADR 0011 dec 3 generalize on demand).
    { kind: 'custom-mount', name: 'form-fields' },
    { kind: 'select', label: 'Style', path: 'variant', options: FORM_VARIANTS },
    { kind: 'text', label: 'Submit label', path: 'submitLabel' },
    { kind: 'text', label: 'Success message', path: 'successMessage' },
    {
      kind: 'text',
      label: 'Webhook URL',
      path: 'webhookUrl',
      placeholder: 'https://...',
      noRebuild: true,
    },
    // Per-form visual customisation — typography, label, input, and submit
    // button overrides. Custom-mount because the section contains several
    // nested disclosure groups; expressing every nested control declaratively
    // would balloon InspectorSpec without adding navigability.
    { kind: 'custom-mount', name: 'form-style' },
  ],
};

export const formSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'form',
      sidebarLabel: 'Form',
      sidebarTip: 'Add a contact or signup form',
      factoryName: 'form',
    },
  ],
};

export const formAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    variant: {
      type: 'string',
      enum: [...FORM_VARIANTS],
      description: `Form visual preset. One of [${FORM_VARIANTS.join(', ')}]. Form elements only.`,
    },
    title: {
      type: 'string',
      description:
        'Owner-facing name for this form (e.g. "Contact form", "Newsletter signup"). Used by the dashboard inbox and CSV export filename; never shown on the visitor page. Form elements only.',
    },
    submitLabel: {
      type: 'string',
      description: 'Submit button text. Form elements only.',
    },
    successMessage: {
      type: 'string',
      description: 'Message shown after submission. Form elements only.',
    },
    fields: {
      type: 'array',
      description:
        'Form field definitions. Form elements only. Each field needs id, label, kind, and required; kind is text, email, textarea, checkbox, or select. IMPORTANT: this is FULL-REPLACE — to add a single field you MUST send the complete list of existing fields plus the new one. Sending a partial array WILL DELETE the omitted fields. Omitting all items via an empty [] clears the form entirely.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['text', 'email', 'textarea', 'checkbox', 'select'],
          },
          required: { type: 'boolean' },
          placeholder: { type: 'string' },
        },
        required: ['id', 'label', 'kind', 'required'],
      },
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.variant !== undefined) {
      if (typeof args.variant !== 'string') throw new Error('variant must be a string');
      patch.variant = args.variant;
    }
    if (args.title !== undefined) {
      if (typeof args.title !== 'string') throw new Error('title must be a string');
      patch.title = args.title;
    }
    if (args.submitLabel !== undefined) {
      if (typeof args.submitLabel !== 'string') throw new Error('submitLabel must be a string');
      patch.submitLabel = args.submitLabel;
    }
    if (args.successMessage !== undefined) {
      if (typeof args.successMessage !== 'string') {
        throw new Error('successMessage must be a string');
      }
      patch.successMessage = args.successMessage;
    }
    if (args.fields !== undefined) {
      if (!Array.isArray(args.fields)) throw new Error('fields must be an array');
      patch.fields = args.fields;
    }
    return patch;
  },
};
