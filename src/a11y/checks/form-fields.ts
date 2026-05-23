// src/a11y/checks/form-fields.ts
//
// Wave 3 #15 — Form field label presence check.
//
// FormElement (Wave 2 #7) renders each field inside a wrapping <label> whose
// inner <span class="rev01-form-label"> reads the `FormFieldDef.label`
// string. An empty label produces an unlabelled input — screen readers
// announce only the input role ("edit text") with no human-readable context.
//
// Per the plan brief this check is *guarded*: it runs only when the
// FormElement type is registered. Phase 0 already registered `'form'` in
// `ELEMENT_TYPES`, so the guard is effectively always satisfied today; the
// guard exists so the audit subsystem stays self-contained if a future
// regression removes the form ElementType, rather than crashing here.
//
// All-or-nothing posture: a form whose `fields` is not an array — i.e. a
// runtime drift from the FormElement contract — bubbles up to the audit
// runner, which converts it into an `audit-crash` blocking issue. This file
// itself does not catch.

import { DEFAULT_SEVERITY_BY_KIND } from '../severity.js';
import type { AuditIssue } from '../audit.js';
import type { CanvasPage } from '../../canvas/schema.js';
// Lazy type import — see file head. The FormElement interface lives in the
// Phase 0 element registry; if the file moves or is removed, this import
// fails at typecheck (the correct loud-failure mode).
import type { FormElement, FormFieldDef } from '../../canvas/elements/form.js';

/**
 * Narrow helper — element is a FormElement. We compare on `type` to keep the
 * check independent of FormElement's structural shape.
 */
function isFormElement(value: { type: string }): value is FormElement {
  return value.type === 'form';
}

export function checkFormFields(page: CanvasPage): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const section of page.sections) {
    for (const element of section.elements) {
      if (!isFormElement(element)) continue;
      const fields: readonly FormFieldDef[] = element.fields;
      for (const field of fields) {
        if (typeof field.label !== 'string' || field.label.trim() === '') {
          issues.push({
            kind: 'missing-form-field-label',
            severity: DEFAULT_SEVERITY_BY_KIND['missing-form-field-label'],
            elementId: element.id,
            pageSlug: page.slug,
            message: `Form field "${field.id}" on form "${element.id}" (page "${page.slug}") is missing a label.`,
            fixHint:
              'Open the form in the editor and write a label for this field — assistive tech depends on it to announce what the input is for.',
          });
        }
      }
    }
  }
  return issues;
}
