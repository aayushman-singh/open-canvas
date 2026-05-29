// src/canvas/elements/inspector-spec.ts
//
// Declarative inspector specs (ADR 0011 Step 1). Each per-element module
// exports a static `inspectorSpec: InspectorSpec` describing the fields the
// editor inspector should render for that element type. The editor client
// at `src/editor/canvas-client.ts` interpolates the dispatch table as JSON
// at script-emit time and walks the spec with a single generic interpreter,
// replacing the per-type `buildXInspector` functions that previously fanned
// out inside the IIFE.
//
// The spec is PURE DATA — no functions, no closures. This is what makes it
// shippable across the server/client boundary via JSON.stringify without
// any code-emission tooling. The interpreter holds the only imperative
// behaviour: read `element[field.path]`, render the input, write back on
// change, and call `rebuildElement(element.id); scheduleSave()`.
//
// During migration (ADR 0011 dec 3) the dispatch is `Partial<Record<
// ElementType, InspectorSpec>>` so migrated and unmigrated element types
// coexist. The completeness smoke (`inspector-dispatch.smoke.ts`) pins
// every migrated entry to a fixture so dispatch / element drift is a
// build-time failure. The cutover ADR flips the dispatch to a full
// `Record<ElementType, InspectorSpec>` once every type has migrated.

/**
 * A single field rendered into the inspector. `path` is the top-level
 * property name on the element (e.g. `'variant'`, `'source'`,
 * `'showLineNumbers'`). Nested paths (`'href.url'`) are out of scope for
 * Step 1; conditional fields with nested data land alongside the action
 * element migration in a follow-up PR.
 */
export type InspectorField =
  | SelectField
  | SelectMappedField
  | TextField
  | TextareaField
  | CheckboxField;

/**
 * Static option list. The element's current value is one of the option
 * strings; the input writes the string back as-is.
 */
export interface SelectField {
  kind: 'select';
  label: string;
  path: string;
  options: readonly string[];
  /** Used when the element value is missing or not in `options`. */
  defaultValue?: string;
}

/**
 * Label-to-value mapping for selects whose stored value is numeric (or any
 * non-string) but whose display is a human-readable label. The interpreter
 * picks the option whose value is within `tolerance` of the current element
 * value (defaults to `0.01`); the input writes the chosen option's value
 * back to the element.
 */
export interface SelectMappedField {
  kind: 'select-mapped';
  label: string;
  path: string;
  options: readonly { label: string; value: number }[];
  defaultValue: number;
  /** Absolute-difference tolerance for matching the current value. */
  tolerance?: number;
}

/**
 * Single-line text input. When `required` is true, the interpreter rejects
 * an empty submission (reverts the input and surfaces a status error).
 */
export interface TextField {
  kind: 'text';
  label: string;
  path: string;
  placeholder?: string;
  required?: boolean;
}

/**
 * Multi-line textarea. `cssText` is applied as inline style on the textarea
 * element; this is the escape hatch for the code-source field's monospace
 * font and resize:vertical without polluting the spec with style primitives.
 */
export interface TextareaField {
  kind: 'textarea';
  label: string;
  path: string;
  placeholder?: string;
  rows?: number;
  cssText?: string;
}

/**
 * Boolean checkbox. The element value is coerced with `!!` on read so legacy
 * data carrying truthy non-booleans renders sensibly.
 */
export interface CheckboxField {
  kind: 'checkbox';
  label: string;
  path: string;
}

/**
 * The full spec for an element type's inspector body. Top-level group
 * controls (reorder, z-order, element actions, style section) live outside
 * the spec — those are uniform across every element type and stay in
 * canvas-client.ts.
 */
export interface InspectorSpec {
  readonly fields: readonly InspectorField[];
}
