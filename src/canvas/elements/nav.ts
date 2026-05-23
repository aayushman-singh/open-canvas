// src/canvas/elements/nav.ts
//
// Phase 0 stub. `NavElement` interface + render stub. Wave 4 owner: see
// docs/superpowers/plans/2026-05-23-16-multi-page-nav.md. Depends on the
// Symbols feature (#14, Wave 3) — Nav is stored as a SymbolMaster behind the
// scenes so editing the master propagates to every page.

import type { BaseElement } from '../schema.js';

export type NavLinkKind = 'internal' | 'external';

export interface NavLink {
  label: string;
  href: string;
  kind: NavLinkKind;
}

export type NavLayout = 'left-center-right' | 'left-right';

export interface NavElement extends BaseElement {
  type: 'nav';
  logoAssetId?: string;
  links: NavLink[];
  layout: NavLayout;
  sticky: boolean;
}

export interface NavRenderCtx {
  styleKit: string;
  assetBasePath: string;
}

export function renderNav(el: NavElement, ctx: NavRenderCtx): string {
  void el;
  void ctx;
  throw new Error(
    'TODO: implement in Wave 4 — see docs/superpowers/plans/2026-05-23-16-multi-page-nav.md',
  );
}

export const NAV_RECIPE_ID = 'site-nav' as const;
