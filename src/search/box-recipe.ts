// src/search/box-recipe.ts
//
// Wave 3 #13 — Opt-in "search box" section recipe. An Owner adds a section
// produced by this factory to their site to expose a Visitor-facing search
// box.
//
// The brief is explicit: do NOT introduce a new ElementType. We reuse the
// existing `action` element (which the public renderer already turns into an
// anchor) and stamp its `href` at `/__rev01/search`. A search submission is
// a GET to that endpoint; the Visitor's browser handles the redirect when
// the anchor is clicked. The Owner's site styling (kit-aware action
// variant) applies as usual.
//
// Why an action element and not a `<form>`:
//   - The existing element registry has no `form` rendered as an inline
//     `<form method="get">` — the `form` element type is the Wave 2 #7 long
//     form that POSTs to `/api/forms/...`.
//   - A new ElementType would require a schema change (`ELEMENT_TYPES`),
//     which the plan explicitly forbids ("do NOT add to schema").
//   - The Visitor flow we want is: click → land on the search page. An
//     anchor is the minimum-complexity primitive that delivers it. The
//     search page (Wave 3 #13 follow-up — outside this agent's scope)
//     surfaces the input field and submit button.
//
// The factory returns a `CanvasSection` with `recipeId: 'cta-band'` —
// `cta-band` is the existing single-call-to-action recipe slot in the Phase
// 0 `SECTION_RECIPE_IDS` registry, which fits a single action element
// naturally. The section name carries the `search-box` identity so the
// editor's "section gallery" can surface it distinctly from a generic CTA.

import type { ActionElement, CanvasSection } from '../canvas/schema.js';

/**
 * Brand the section so editor + a11y tooling can identify a search-box
 * section without inspecting element internals. The brand lives on the
 * section name; CanvasSection has no `kind`/`tag` field.
 */
export const SEARCH_BOX_SECTION_NAME = 'search-box';

/**
 * Stable element id for the produced anchor. The id is namespaced so two
 * Owner instances of the recipe on the same site don't collide unless the
 * Owner intentionally adds two.
 */
export const SEARCH_BOX_ELEMENT_ID = 'search-box-action';

/**
 * Endpoint the rendered anchor points at. Matches the public-host mount
 * defined in `src/search/route.ts`.
 */
export const SEARCH_BOX_ENDPOINT = '/__rev01/search';

export interface SearchBoxRecipeOptions {
  /** Visible label on the search button. Defaults to "Search". */
  label?: string;
  /** Bounding box for the action. Defaults to a 200x56 button at (40, 40). */
  box?: ActionElement['box'];
  /** Action variant — defaults to `solid`. Owner can override per kit. */
  variant?: ActionElement['variant'];
  /** Section height. Defaults to 160 so the action fits with breathing room. */
  height?: number;
}

/**
 * Build a `CanvasSection` containing a single action element wired to the
 * public search endpoint. Pure function — no I/O — so the editor can append
 * the result straight into `editableState.pages[N].sections`.
 */
export function buildSearchBoxSection(opts: SearchBoxRecipeOptions = {}): CanvasSection {
  const label = opts.label ?? 'Search';
  const box = opts.box ?? { x: 40, y: 40, w: 200, h: 56, z: 1 };
  const variant = opts.variant ?? 'solid';
  const height = opts.height ?? 160;

  const action: ActionElement = {
    id: SEARCH_BOX_ELEMENT_ID,
    type: 'action',
    box,
    label,
    href: SEARCH_BOX_ENDPOINT,
    variant,
  };

  return {
    id: 'section-search-box',
    recipeId: 'cta-band',
    name: SEARCH_BOX_SECTION_NAME,
    height,
    elements: [action],
  };
}
