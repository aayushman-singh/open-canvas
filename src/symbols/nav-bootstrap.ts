// src/symbols/nav-bootstrap.ts
//
// Wave 4 #16 — Bootstrap the per-site "Site Nav" SymbolMaster and ensure every
// Canvas Page hosts a Symbol Instance of it.
//
// See docs/superpowers/plans/2026-05-23-16-multi-page-nav.md for the full
// brief. This file is the only place in the repo that knows "a nav exists at
// the site level once, and lives on every page as an instance" — every other
// caller (the dashboard editor, future API hooks, the public renderer)
// composes through `ensureSiteNavSymbol(state)`.
//
// ---------------------------------------------------------------------------
// BEHAVIOUR (idempotent)
//
//   1. If no SymbolMaster with id `SITE_NAV_SYMBOL_ID` exists on `state`:
//      - Create it via `createSymbolMaster` with a fresh NavElement seeded
//        with an empty link list, no logo, layout `left-center-right`, and
//        sticky=false.
//      - For every page on `state`, append a wrapper section containing
//        a single `symbol-instance` element pointing at the master.
//
//   2. If the SymbolMaster already exists:
//      - Loop every page and add an instance ONLY to pages that have NO
//        existing instance referencing the master. This is how a "new page
//        added after first nav add" picks up the bar.
//
//   3. The function mutates `state` in place and returns the same reference
//      (matching the rest of the symbols/* API). Calling it twice on the
//      same state is a no-op on the second call.
//
// ---------------------------------------------------------------------------
// PER-PAGE SUPPRESSION
//
// The Phase 0 schema is frozen — there is no `CanvasPage.hideSiteNav` field.
// To suppress the nav on a single page, the Owner deletes the
// symbol-instance from that page through the editor (the "Hide site nav on
// this page" command in the canvas editor — Wave 4 #18's surface; see open
// notes in the brief).
//
// CALLER CONTRACT: `ensureSiteNavSymbol` is NOT a continuous reconciler. It
// is called explicitly:
//   - when the Owner adds the very first nav,
//   - when a new page is created and the Owner wants the bar on it,
//   - never as a background sweep.
//
// That contract means a deleted-by-Owner instance stays deleted until the
// Owner explicitly invokes bootstrap on that page (e.g. via a "Show site
// nav here" command). This is the cleanest no-fallback choice given the
// schema freeze; the design note in the brief calls it the "additive field
// vs editor-side delete-instance vs other" tradeoff, and the chosen option
// is delete-instance-to-suppress.
//
// ---------------------------------------------------------------------------
// PLACEMENT CHOICE
//
// We DROP the symbol-instance inside its own freshly-created CanvasSection
// at the top of the page (`page.sections.unshift(...)`). The section has
// recipe `'cta-band'` (closest visual match in the existing recipe set; the
// site-nav recipe id from `nav.ts` is a logical marker, not a valid
// SectionRecipeId — see schema.ts SECTION_RECIPE_IDS) and a fixed 96px
// height. The instance element fills the section box.
//
// Why a dedicated section instead of inserting into the existing first
// section: the symbol-instance render emits its own absolutely-positioned
// children, and a host section may already have its own elements at fixed
// boxes that would visually collide. Owning a section guarantees vertical
// reading order: nav first, then the rest of the page.

import { createSymbolMaster, findSymbolMaster } from './master.js';
import { createSymbolInstance } from './instance.js';
import type {
  CanvasPage,
  CanvasSection,
  CanvasSiteState,
  SymbolMaster,
} from '../canvas/schema.js';
import {
  SITE_NAV_SYMBOL_ID,
  SITE_NAV_SYMBOL_NAME,
  type NavElement,
} from '../canvas/elements/nav.js';

/**
 * Fixed pixel height of the per-page nav host section. The instance element's
 * box matches this value so the bar fills the section. Smaller than a hero
 * section so visitors see the nav AND the first content fold together.
 */
export const NAV_HOST_SECTION_HEIGHT = 96;

/**
 * Reserved element id for the NavElement living inside the master section.
 * Stable so that future override-keyed addressing (Wave 3 #14 overrides are
 * keyed by inner element id) has a deterministic target. Owners would override
 * `el-site-nav-inner` to e.g. change one page's nav variant — but per the
 * brief that path is out of scope (one site-wide nav, no per-page variants).
 */
export const SITE_NAV_INNER_ELEMENT_ID = 'el-site-nav-inner';

/**
 * Reserved section id for the master section. Stable across bootstraps so
 * the merge resolver always finds the same shape; the instance element id
 * re-stamps this on each render (per merge rule 3).
 */
export const SITE_NAV_MASTER_SECTION_ID = 'sec-site-nav-master';

/**
 * Build a fresh empty NavElement for a brand-new "Site Nav" symbol. The
 * master section is owned and edited via the dashboard nav editor; this
 * is the starting shape the Owner sees on first nav add.
 */
function makeEmptyNavElement(): NavElement {
  return {
    id: SITE_NAV_INNER_ELEMENT_ID,
    type: 'nav',
    // The nav fills its host section. The host section's height drives the
    // bar's visual height; width is 100% via the renderer's inline style.
    box: { x: 0, y: 0, w: 1200, h: NAV_HOST_SECTION_HEIGHT, z: 1 },
    links: [],
    layout: 'left-center-right',
    sticky: false,
  };
}

/**
 * Build the master section that wraps the NavElement. The recipe id must be
 * a valid `SectionRecipeId`; we use `cta-band` because it's the visual
 * neighbour of a horizontal bar in the existing recipe set. The logical
 * "this is a nav" marker is the NavElement's `type` and the symbol id, not
 * the recipe id.
 */
function makeMasterSection(): CanvasSection {
  return {
    id: SITE_NAV_MASTER_SECTION_ID,
    recipeId: 'cta-band',
    name: SITE_NAV_SYMBOL_NAME,
    height: NAV_HOST_SECTION_HEIGHT,
    elements: [makeEmptyNavElement()],
  };
}

/**
 * Build a fresh per-page section that hosts a single symbol-instance element
 * pointing at the site-nav master. The instance element id is generated per
 * call so re-running bootstrap on a fresh page does not collide with an
 * existing instance id elsewhere on the site.
 */
function makeHostSection(state: CanvasSiteState, pageId: string): CanvasSection {
  const instance = createSymbolInstance(state, {
    symbolId: SITE_NAV_SYMBOL_ID,
    box: { x: 0, y: 0, w: 1200, h: NAV_HOST_SECTION_HEIGHT, z: 1 },
    // Deterministic id per page so the smoke can assert / dedupe.
    id: `el-site-nav-instance-${pageId}`,
  });
  return {
    id: `sec-site-nav-${pageId}`,
    recipeId: 'cta-band',
    name: SITE_NAV_SYMBOL_NAME,
    height: NAV_HOST_SECTION_HEIGHT,
    elements: [instance],
  };
}

/**
 * Does this page already host a Site Nav instance? True when any element in
 * any section is a `symbol-instance` pointing at the site-nav master id.
 */
function pageHasSiteNavInstance(page: CanvasPage): boolean {
  for (const section of page.sections) {
    for (const el of section.elements) {
      if (el.type === 'symbol-instance' && el.symbolId === SITE_NAV_SYMBOL_ID) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Idempotently ensure the per-site "Site Nav" SymbolMaster exists and that
 * every Canvas Page hosts a Symbol Instance of it.
 *
 *   - Creates the master if absent.
 *   - For each page that has no existing site-nav instance, prepends a host
 *     section containing one instance element.
 *   - Returns the same `state` reference (mutated in place).
 *
 * Failure posture: throws if `createSymbolMaster` / `createSymbolInstance`
 * reject (e.g. id collision with a pre-existing custom symbol of the same
 * id). No silent fallback — the loud throw surfaces the conflict to the
 * caller, matching the all-or-nothing posture across the symbols/* modules.
 */
export function ensureSiteNavSymbol(state: CanvasSiteState): CanvasSiteState {
  let master: SymbolMaster | undefined = findSymbolMaster(state, SITE_NAV_SYMBOL_ID);
  if (!master) {
    master = createSymbolMaster(state, {
      id: SITE_NAV_SYMBOL_ID,
      name: SITE_NAV_SYMBOL_NAME,
      section: makeMasterSection(),
    });
  }
  void master;

  for (const page of state.pages) {
    if (pageHasSiteNavInstance(page)) continue;
    const hostSection = makeHostSection(state, page.id);
    page.sections.unshift(hostSection);
  }

  return state;
}

/**
 * Inverse of bootstrap for a single page: remove every section on the page
 * whose only element is a site-nav symbol-instance. Used by an editor
 * "Hide site nav on this page" command. Returns the number of sections
 * removed (0 when the page had no nav). Idempotent.
 *
 * We only remove a section when its sole element is the nav instance — a
 * page that happens to have an Owner-authored section containing the nav
 * instance alongside other elements is left untouched (the Owner is doing
 * something custom; bootstrap should not silently rewrite their layout).
 */
export function removeSiteNavFromPage(page: CanvasPage): number {
  const before = page.sections.length;
  page.sections = page.sections.filter((section) => {
    if (section.elements.length !== 1) return true;
    const el = section.elements[0];
    if (!el) return true;
    if (el.type !== 'symbol-instance') return true;
    if (el.symbolId !== SITE_NAV_SYMBOL_ID) return true;
    return false;
  });
  return before - page.sections.length;
}
