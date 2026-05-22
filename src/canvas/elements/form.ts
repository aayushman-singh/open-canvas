// src/canvas/elements/form.ts
//
// Phase 0 stub. `FormElement` interface + render stub. The Wave 2 forms agent
// (see docs/superpowers/plans/2026-05-23-07-forms.md) replaces the throw with
// a real renderer. The interface is FROZEN once Phase 0 lands so feature code
// can rely on the shape without coordinating with the schema owner.
//
// All fields are intentionally narrow and additive-only: the wave agent may
// add NEW optional fields if it needs to, but may not change existing field
// types without re-opening the plan.

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

export function renderForm(el: FormElement, ctx: FormRenderCtx): string {
  void el;
  void ctx;
  throw new Error(
    'TODO: implement in Wave 2 — see docs/superpowers/plans/2026-05-23-07-forms.md',
  );
}

// Section Recipe id reserved for "contact-form" — factory lives in the forms
// feature dir; the registry slot is reserved here so the recipes module can
// import the name without circular dependency on Wave 2 code.
export const FORM_RECIPE_ID = 'contact-form' as const;
