// src/canvas/action-icon-shrink.smoke.ts
//
// Regression smoke for the live bug observed 2026-06-04:
//
//   Selected action element `el-f16d5002...` with inline style
//   `width:56px;height:48px` rendered as
//   `<a class="opencanvas-action"><svg ...><path/></svg><span>Action</span></a>`.
//   The `<svg>` measured `{width:0,height:10}` — the label span consumed
//   all the flex space and squeezed the icon to zero width.
//
// The fix lives in two places that must stay in lockstep:
//
//   1. `src/canvas/public-styles.ts` and `src/editor-client/styles-build.ts`
//      add a shrink-protect rule for `.opencanvas-action > .opencanvas-icon`
//      (`flex: 0 0 auto; width: 1em; height: 1em`) plus
//      `.opencanvas-action > span { min-width: 0 }` so the label absorbs
//      the squeeze instead of the icon.
//
//   2. `src/canvas/elements/action.ts` (and the editor mirror in
//      `src/editor-client/body-builders-basic.ts`) skip the label `<span>`
//      entirely when every run has empty text. This is the "icon-only"
//      affordance — the at-rest contract is `label: [{text:''}]` because
//      the validator rejects an empty array, but the renderer treats
//      empty-plain-text as "no label container at all".
//
// Bare Bun has no DOM, so this smoke walks the rendered HTML string and
// asserts the contracts that both fixes establish.
//
// Run with `bun.cmd run action-icon-shrink:smoke`.

import { renderAction } from './elements/action.js';
import type { ActionElement } from './schema.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[action-icon-shrink:smoke] ${message}`);
}

// ---- Contract 1: icon + label both present — both must render ---------
//
// The live bug rendered the SVG at 0 width inside a narrow box. The render
// itself emits the SVG with `width="1em" height="1em"`; the regression was
// purely the flex shrink. The smoke pins the markup that the CSS shrink-
// protect rule targets — if either the SVG class name or the wrapping
// `.opencanvas-action` class change, the CSS rule stops matching and the
// bug returns silently. We assert both selectors appear in the rendered
// HTML so future renderer changes have to update the CSS in lockstep.

{
  const action: ActionElement = {
    id: 'a-icon-and-label',
    type: 'action',
    box: { x: 0, y: 0, w: 56, h: 48, z: 1 },
    label: [{ text: 'Action' }],
    href: { type: 'external', url: '#' },
    variant: 'solid',
    iconKind: 'arrow-up-right',
  };

  const html = renderAction(action, { pages: [] });

  assert(
    html.includes('class="opencanvas-action"'),
    `wrapper class must stay ".opencanvas-action" (the CSS shrink-protect rule keys on it). got: ${html}`,
  );
  assert(
    html.includes('class="opencanvas-icon"'),
    `icon class must stay ".opencanvas-icon" (the CSS shrink-protect rule keys on it). got: ${html}`,
  );
  assert(
    html.includes('width="1em"') && html.includes('height="1em"'),
    `icon must carry 1em width/height attrs so the CSS rule's width/height can override predictably. got: ${html}`,
  );
  assert(
    html.includes('<span>Action</span>'),
    `label must render inside a <span> sibling so the CSS min-width:0 rule can target it. got: ${html}`,
  );
}

// ---- Contract 2: icon-only — no `<span>` emitted ----------------------
//
// User asked to be able to remove the label entirely. The at-rest contract
// is `label: [{text:''}]` (the validator rejects an empty array). The
// renderer treats every-run-empty-text as "skip the label container", so
// the output has the icon but no `<span>` at all. Without this,
// renderInlineRun emits `<span></span>` which still participates in flex
// layout and reserves the gap between icon and (absent) text.

{
  const action: ActionElement = {
    id: 'a-icon-only',
    type: 'action',
    box: { x: 0, y: 0, w: 48, h: 48, z: 1 },
    label: [{ text: '' }],
    href: { type: 'external', url: '#' },
    variant: 'solid',
    iconKind: 'arrow-up-right',
  };

  const html = renderAction(action, { pages: [] });

  assert(
    html.includes('class="opencanvas-icon"'),
    `icon-only action must still render the icon SVG. got: ${html}`,
  );
  assert(
    !html.includes('<span>'),
    `icon-only action must NOT emit any <span> element (empty span participates in flex layout). got: ${html}`,
  );
}

// ---- Contract 3: multi-run empty label — also no `<span>` -------------
//
// Defensive: if a future inspector edit leaves a label as `[{text:''},
// {text:''}]` (e.g. paste of two empty runs), the same rule applies. The
// concatenated plain text is still empty so no `<span>` is emitted.

{
  const action: ActionElement = {
    id: 'a-multi-empty',
    type: 'action',
    box: { x: 0, y: 0, w: 48, h: 48, z: 1 },
    label: [{ text: '' }, { text: '' }],
    href: { type: 'external', url: '#' },
    variant: 'solid',
    iconKind: 'copy',
  };

  const html = renderAction(action, { pages: [] });
  assert(
    !html.includes('<span>'),
    `multi-run empty label must also skip every <span>. got: ${html}`,
  );
}

// ---- Contract 4: CSS shrink-protect rule is present in public styles --
//
// The CSS rule is in the source-of-truth public-styles.ts; a future
// refactor that drops the rule would not be caught by the HTML-only smokes
// above. Read the module's exported CSS string and assert the rule is
// present. This is a string match — not a parse — so any equivalent
// rewrite (e.g. flex-shrink: 0 + flex-grow: 0 instead of `flex: 0 0 auto`)
// must keep this guard updated.

{
  const mod = (await import('./public-styles.js')) as { canvasPublishedStyles?: string };
  const css = typeof mod.canvasPublishedStyles === 'string' ? mod.canvasPublishedStyles : '';
  assert(css.length > 0, 'public-styles.ts must export canvasPublishedStyles as a non-empty string');
  assert(
    css.includes('.opencanvas-action > .opencanvas-icon') && css.includes('flex: 0 0 auto'),
    'public-styles.ts must keep the .opencanvas-action > .opencanvas-icon shrink-protect rule (flex: 0 0 auto)',
  );
  assert(
    css.includes('.opencanvas-action > span') && css.includes('min-width: 0'),
    'public-styles.ts must keep the .opencanvas-action > span squeeze-affordance rule (min-width: 0)',
  );
}

console.log('[action-icon-shrink:smoke] OK');
