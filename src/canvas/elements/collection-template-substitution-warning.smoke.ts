// src/canvas/elements/collection-template-substitution-warning.smoke.ts
//
// ADR 0065 F1-substitution-warning — predicate smoke for
// `templateHasAnyPlaceholder`. The inspector uses this predicate to surface
// a one-line informational warning when an Owner's `customTemplate` contains
// zero `{{<placeholder>}}` tokens (every materialized card would render
// identical static content).
//
// Cases pinned here:
//   * a Text element whose `content` carries `{{title}}` → true (top-level
//     recursion);
//   * a Text element whose `content` is hard-coded → false (no per-entry
//     variation);
//   * a `{{title}}` placeholder buried inside a Tabs panel's child Text
//     element → true (Tabs recursion via the structural object/array walk);
//   * an empty template `[]` → false (the empty-template path renders a
//     separate chrome + emits its own publish warning per ADR 0065 D8 — we
//     do NOT double-warn);
//   * a non-known placeholder name (`{{foo}}`) → false (only the nine
//     PLACEHOLDER_FIELDS substitute at publish time, so `{{foo}}` would
//     render as literal `{{foo}}` text — that is N identical cards by
//     another name, so the warning should fire). NOTE: the predicate
//     deliberately matches only known tokens because an unknown brace
//     pair could be intentional content (e.g. a typesetter's mustache);
//     we surface this case in the report.
//
// Bare Bun — no `document` required; the predicate is a pure function on the
// element subtree.
//
// Run with
// `bun run src/canvas/elements/collection-template-substitution-warning.smoke.ts`.

import type { CanvasElement } from '../schema.js';
import { templateHasAnyPlaceholder } from './collection-materializer.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[collection-template-substitution-warning:smoke] ${message}`);
}

function textWith(content: string): CanvasElement {
  return {
    id: 'text-' + content.slice(0, 8),
    type: 'text',
    box: { x: 0, y: 0, w: 200, h: 32, z: 1 },
    content: [{ text: content }],
    role: 'body',
    fontSize: 14,
    fontWeight: 400,
    align: 'left',
  };
}

function tabsWith(panelChildren: CanvasElement[]): CanvasElement {
  return {
    id: 'tabs-smoke',
    type: 'tabs',
    box: { x: 0, y: 0, w: 320, h: 240, z: 1 },
    activeTabId: 'tab-1',
    tabs: [
      {
        id: 'tab-1',
        label: [{ text: 'Tab one' }],
        elements: panelChildren,
      },
    ],
  };
}

// ----- Case 1: Text with `{{title}}` -> true ---------------------------

(function topLevelTitleSpec() {
  const template: CanvasElement[] = [textWith('{{title}}')];
  assert(
    templateHasAnyPlaceholder(template) === true,
    'top-level Text content containing {{title}} must be detected',
  );
})();

// ----- Case 2: Text with hard-coded string -> false --------------------

(function topLevelStaticSpec() {
  const template: CanvasElement[] = [textWith('Hello world')];
  assert(
    templateHasAnyPlaceholder(template) === false,
    'top-level Text content with no {{...}} token must NOT be flagged',
  );
})();

// ----- Case 3: `{{title}}` inside a nested Tabs panel -> true ----------

(function nestedTabsSpec() {
  const nestedText = textWith('{{title}}');
  const template: CanvasElement[] = [tabsWith([nestedText])];
  assert(
    templateHasAnyPlaceholder(template) === true,
    'placeholder inside a Tabs panel child must be detected via recursion',
  );
})();

// ----- Case 4: empty template -> false ---------------------------------

(function emptyTemplateSpec() {
  const template: CanvasElement[] = [];
  assert(
    templateHasAnyPlaceholder(template) === false,
    'empty template returns false (caller handles empty-template chrome separately)',
  );
})();

// ----- Case 5: unknown {{token}} -> false (only known fields count) ----

(function unknownTokenSpec() {
  const template: CanvasElement[] = [textWith('{{unknownField}}')];
  assert(
    templateHasAnyPlaceholder(template) === false,
    'unknown placeholder names are not in PLACEHOLDER_FIELDS so predicate stays false',
  );
})();

// ----- Case 6: placeholder in a non-content string field --------------

(function altFieldSpec() {
  // An image with `alt: '{{title}}'` — the materializer's substituteInValue
  // walks every string field uniformly (not just content[].text), so the
  // predicate must too.
  const image: CanvasElement = {
    id: 'img-smoke',
    type: 'media',
    mediaKind: 'image',
    box: { x: 0, y: 0, w: 200, h: 120, z: 1 },
    assetId: 'asset-1',
    alt: '{{title}}',
    fit: 'cover',
  };
  assert(
    templateHasAnyPlaceholder([image]) === true,
    'placeholder inside any string field (not just text content) must be detected',
  );
})();

// ----- Case 7: every known placeholder field detected ------------------

(function everyKnownFieldSpec() {
  const fields = [
    'title',
    'excerpt',
    'body',
    'publishedDate',
    'author',
    'category',
    'tag',
    'slug',
    'ogImageAssetId',
  ];
  for (const field of fields) {
    const tpl: CanvasElement[] = [textWith('{{' + field + '}}')];
    assert(
      templateHasAnyPlaceholder(tpl) === true,
      `placeholder {{${field}}} must be detected (PLACEHOLDER_FIELDS coverage)`,
    );
  }
})();

console.log('[collection-template-substitution-warning:smoke] OK');
