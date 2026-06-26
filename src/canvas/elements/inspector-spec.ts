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
// The cutover dispatch is a typed `Record<Exclude<ElementType,
// 'collection'>, InspectorSpec>`: every inspectable element type must
// provide a spec, while collection is the explicit opt-out because its
// children render their own inspectors. The completeness smoke
// (`inspector-dispatch.smoke.ts`) pins every dispatch entry to a fixture so
// dispatch / element drift is a build-time failure.

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
  | CheckboxField
  | NumberField
  | ButtonActionField
  | ActionHrefField
  | IconField
  | CustomMountField;

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
  /** Hide unless `element[showWhen.path] === showWhen.equals`. */
  showWhen?: { path: string; equals: string };
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
 * When `emptyOmits` is true, an empty input value DELETES the property on
 * the element instead of writing an empty string — used for optional
 * fields whose absence is semantically distinct from a present-but-empty
 * value (e.g. `nav.logoAssetId?: string`, `chart.xAxisTitle?: string`).
 * JSON serialization treats `delete` and `= undefined` identically (key
 * dropped from output); we use `delete` so `Object.keys(element)` and
 * `key in element` reflect the optional-field semantics directly.
 */
export interface TextField {
  kind: 'text';
  label: string;
  path: string;
  placeholder?: string;
  required?: boolean;
  emptyOmits?: boolean;
  /**
   * When true, the interpreter skips `rebuildElement(element.id)` on change
   * and only calls `scheduleSave()`. Used for fields whose value affects
   * element data but not its rendered output (e.g. `form.webhookUrl` —
   * submission metadata, never read by the visitor-side renderer).
   */
  noRebuild?: boolean;
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
 * Numeric input with optional `min` / `max` bounds. The interpreter rejects a
 * change whose parsed value is non-finite or out of bounds (reverts the input
 * to the prior value). Used for free-form numbers like text font size; a
 * fixed-option numeric pick belongs in `select-mapped`.
 */
export interface NumberField {
  kind: 'number';
  label: string;
  path: string;
  min?: number;
  max?: number;
}

/**
 * Action button (e.g. "AI rewrite", "AI media"). The `action` string names a
 * handler the interpreter dispatches to via its imperative-handler registry;
 * `busyFlag` names a boolean the interpreter consults to set `disabled` at
 * mount time so a busy AI request cannot be re-fired from the inspector.
 * `dataAttr` becomes a `data-ai-button` attribute on the button — the editor
 * smoke / e2e selectors depend on it remaining present and stable.
 */
export interface ButtonActionField {
  kind: 'button-action';
  label: string;
  action: string;
  dataAttr?: string;
  busyFlag?: string;
}

/**
 * Purpose-built editor for an `ActionHref` discriminated union (the action
 * element's `href` field — `{ type: 'external', url } | { type: 'page',
 * pageId }`). Renders as two stacked fields: a discriminator select
 * (`Link Type`) and a value field whose shape depends on the discriminator
 * (text input for external, dynamic page-select for page). The interpreter
 * holds the only knowledge of the DU shape, the URL allowlist
 * (`isAllowedHref`), and the page-source registry (`state.pages`); the spec
 * just names the labels and the path.
 *
 * Kept purpose-built rather than a general `conditional` + `select-dynamic`
 * pair because only this one element currently needs the shape; if a second
 * element (e.g. nav) ends up wanting the same DU later, generalize then.
 */
export interface ActionHrefField {
  kind: 'action-href';
  /** Label above the discriminator select (e.g. "Link Type"). */
  discriminatorLabel: string;
  /** Label above the value field (e.g. "Destination"). */
  valueLabel: string;
  /** Top-level path where the href DU lives (e.g. "href"). */
  path: string;
}

/**
 * Visual grid picker over the curated icon registry (src/canvas/icons.ts).
 * Renders one selectable tile per registered IconName plus a "None" tile
 * that clears the field. Both ActionElement.iconKind and the iconKind on
 * ShapeElement variant 'icon' use this — when a third consumer lands, the
 * picker stays one shape.
 *
 * `showWhen` makes the field conditional on another property of the same
 * element. Used by Shape so the picker only appears when `variant === 'icon'`
 * (mirroring the schema's "iconKind is required when variant='icon',
 * ignored otherwise" contract). When omitted, the field always renders.
 */
export interface IconField {
  kind: 'icon';
  label: string;
  path: string;
  /** Hide the picker unless `element[showWhen.path] === showWhen.equals`. */
  showWhen?: { path: string; equals: string };
}

/**
 * Escape hatch for imperative inspector fragments that don't fit the
 * declarative kinds — picker mounts, list-card editors with their own
 * mutation logic, conditional sub-trees that need to read element state to
 * decide whether to mount anything at all. The interpreter dispatches to a
 * named handler in `INSPECTOR_MOUNT_HANDLERS` and passes `(element, host)`
 * — the handler is free to skip rendering, mount a complex sub-tree, wire
 * up arbitrary event handlers, anything the legacy buildXInspector did.
 *
 * Using `custom-mount` is an explicit signal that "this fragment is not yet
 * generalizable" — when a SECOND element wants the same pattern, generalize
 * it into a real declarative kind. Two custom-mount entries with related
 * shapes is the trigger to design the proper kind.
 */
export interface CustomMountField {
  kind: 'custom-mount';
  /**
   * Named mount handler the interpreter dispatches to. Mirrors how
   * `button-action` names its handler — the spec ships strings only, the
   * interpreter holds the imperative function. Adding a new spec entry
   * requires registering the handler in canvas-client.ts first.
   */
  name: string;
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
