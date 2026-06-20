// src/canvas/elements/nav.ts
//
// Renders a multi-page nav bar. The element is dropped onto each Canvas Page
// so the same bar shows up across the site. Two layouts (`left-center-right`,
// `left-right`) — both emit one slot per content group; kit CSS reads the
// `data-opencanvas-nav-layout` attribute on the wrapper to differentiate.
//
// LINK HREF SHAPE
//   internal → renderer prepends `/` if missing, never emits target. Owner
//              picks from a dropdown of existing page slugs in the editor
//              (see nav-editor.tsx) so the href is always `/<slug>`.
//   external → raw href, target="_blank" rel="noopener noreferrer". The
//              Owner pastes the full URL (e.g. https://example.com/x).
//   anchor   → raw fragment href (e.g. #pricing), never prefixed, never
//              opens a new tab.
//
// We do not validate that an internal slug resolves to an existing page at
// render time — the editor's link picker is the validator.
//
// STICKY
//   `sticky: true` emits `position: sticky; top: 0; z-index: 100;` inline on
//   the inner <nav>. The surrounding element wrapper (see render.ts
//   `buildElementWrapperStyle`) is `position: absolute`; sticky inside
//   absolute works as long as the absolute container's parent (the section)
//   scrolls. We set position on the inner <nav>, not the wrapper.
//
// LOGO
//   `logoAssetId` resolves to `<img src="<assetBasePath>/<id>" alt="">`. The
//   alt is intentionally empty because the logo is decorative when paired
//   with a sibling site title — screen readers should not double-announce
//   the brand. A `logoAlt` field is not yet on the schema; empty alt is the
//   honest default until then.

import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import type { BaseElement, NavThemeOnScroll } from '../schema.js';
import { escapeAttr, escapeHtml, styleFromEntries } from './render-utils.js';
import {
  NAV_STYLE_SPEC,
  componentStylePatchProperty,
  parseComponentStylePatchValue,
} from './component-style.js';

export const NAV_LINK_KINDS = ['internal', 'external', 'anchor'] as const;
export type NavLinkKind = (typeof NAV_LINK_KINDS)[number];

export interface NavLink {
  label: string;
  href: string;
  kind: NavLinkKind;
}

export const NAV_LAYOUTS = ['left-center-right', 'left-right'] as const;
export type NavLayout = (typeof NAV_LAYOUTS)[number];
export const NAV_STYLE_RECIPES = ['glass-float', 'race-strip', 'editorial-tabs'] as const;
export type NavStyleRecipe = (typeof NAV_STYLE_RECIPES)[number];

export interface NavStyle {
  recipe?: NavStyleRecipe;
  backgroundColor?: string;
  color?: string;
  slotGap?: number;
  linkColor?: string;
  linkHoverColor?: string;
  activeLinkColor?: string;
  activeLinkBackgroundColor?: string;
  linkPaddingX?: number;
  linkPaddingY?: number;
  siteTitleColor?: string;
  siteTitleFontSize?: number;
  siteTitleFontWeight?: 'normal' | 'medium' | 'bold';
  primaryBackgroundColor?: string;
  primaryColor?: string;
  primaryBorderRadius?: number;
}

export function navStyleRecipe(value: unknown): NavStyleRecipe | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('navStyle.recipe must be a string when present');
  if ((NAV_STYLE_RECIPES as readonly string[]).includes(value)) return value as NavStyleRecipe;
  throw new Error('unsupported navStyle.recipe: ' + value);
}

export interface NavElement extends Omit<BaseElement, 'sticky'> {
  type: 'nav';
  logoAssetId?: string;
  /**
   * Text wordmark shown in the left slot. Independent of `logoAssetId` so a
   * brand can ship a glyph + wordmark together, or either on its own. Typography
   * is kit-driven via the `.opencanvas-nav-site-title` class — there is no
   * per-instance fontSize/fontWeight knob because the kit owns header type.
   */
  siteTitle?: string;
  links: NavLink[];
  /**
   * Optional call-to-action rendered as a styled button at the right edge of
   * the nav. Distinct from `links` because its visual is a solid kit-accent
   * button, not a ghost link, and its slot positioning is the trailing-right
   * regardless of layout. Reuses NavLink for the {label, href, kind} shape so
   * the same kind-vs-href validation rules apply.
   */
  primaryAction?: NavLink;
  layout: NavLayout;
  sticky: boolean;
  themeOnScroll?: NavThemeOnScroll;
  navStyle?: NavStyle;
}

export interface NavRenderCtx {
  styleKit: string;
  assetBasePath: string;
  pageSlug?: string;
}

export function navCurrentPathForPageSlug(pageSlug: string | undefined): string | null {
  if (typeof pageSlug !== 'string' || pageSlug.length === 0) return null;
  const clean = pageSlug.replace(/^\/+/, '').replace(/\/+$/, '');
  if (clean === '' || clean === 'index') return '/';
  return `/${clean}`;
}

function normaliseNavPath(path: string): string {
  const clean = path.split('#')[0]!.split('?')[0]!.replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

export function navLinkIsActive(
  link: { href: string; kind: string },
  pageSlug: string | undefined,
): boolean {
  if (link.kind !== 'internal') return false;
  const currentPath = navCurrentPathForPageSlug(pageSlug);
  if (currentPath === null) return false;
  return normaliseNavPath(navLinkHref({ label: '', href: link.href, kind: 'internal' })) === currentPath;
}

/**
 * Build the href the renderer emits for a NavLink. Internal links are
 * normalised to start with `/`; external + anchor pass through verbatim.
 * The editor's picker writes the canonical shape upstream, so the
 * normalisation here is defence-in-depth.
 */
export function navLinkHref(link: NavLink): string {
  if (link.kind !== 'internal') return link.href;
  if (link.href.startsWith('/')) return link.href;
  return `/${link.href}`;
}

/** Build a single `<a>` for one NavLink, fully escaped. */
function renderNavLink(link: NavLink, pageSlug: string | undefined): string {
  const href = navLinkHref(link);
  const target = link.kind === 'external' ? ' target="_blank" rel="noopener noreferrer"' : '';
  const active = navLinkIsActive(link, pageSlug)
    ? ' data-opencanvas-nav-link-active="true" aria-current="page"'
    : '';
  return (
    `<a class="opencanvas-nav-link" data-opencanvas-nav-link-kind="${escapeAttr(link.kind)}" ` +
    `href="${escapeAttr(href)}"${active}${target}>` +
    `${escapeHtml(link.label)}` +
    `</a>`
  );
}

/** Build the logo image — empty when no asset id is set. */
function renderNavLogo(logoAssetId: string | undefined, assetBasePath: string): string {
  if (typeof logoAssetId !== 'string' || logoAssetId.length === 0) return '';
  const src = `${assetBasePath}/${logoAssetId}`;
  return `<img class="opencanvas-nav-logo" src="${escapeAttr(src)}" alt="" />`;
}

/** Build the text wordmark — empty when no siteTitle is set. */
function renderNavSiteTitle(siteTitle: string | undefined): string {
  if (typeof siteTitle !== 'string' || siteTitle.length === 0) return '';
  return `<span class="opencanvas-nav-site-title">${escapeHtml(siteTitle)}</span>`;
}

/** Build the trailing CTA — empty when no primaryAction is set. */
function renderNavPrimaryAction(
  primaryAction: NavLink | undefined,
  pageSlug: string | undefined,
): string {
  if (primaryAction === undefined) return '';
  const href = navLinkHref(primaryAction);
  const target =
    primaryAction.kind === 'external' ? ' target="_blank" rel="noopener noreferrer"' : '';
  const active = navLinkIsActive(primaryAction, pageSlug)
    ? ' data-opencanvas-nav-link-active="true" aria-current="page"'
    : '';
  return (
    `<a class="opencanvas-nav-primary-action" ` +
    `data-opencanvas-nav-link-kind="${escapeAttr(primaryAction.kind)}" ` +
    `href="${escapeAttr(href)}"${active}${target}>` +
    `${escapeHtml(primaryAction.label)}` +
    `</a>`
  );
}

export function renderNav(el: NavElement, ctx: NavRenderCtx): string {
  // styleKit drives nav typography + spacing via kit CSS attached to the
  // outer document wrapper's data-style-kit attribute. The signature stays
  // uniform with every other element renderer.
  void ctx.styleKit;

  const logoHtml = renderNavLogo(el.logoAssetId, ctx.assetBasePath);
  const siteTitleHtml = renderNavSiteTitle(el.siteTitle);
  const linksHtml = el.links.map((link) => renderNavLink(link, ctx.pageSlug)).join('');
  const primaryActionHtml = renderNavPrimaryAction(el.primaryAction, ctx.pageSlug);
  const recipe = navStyleRecipe(el.navStyle?.recipe);
  const recipeClass = recipe ? ` opencanvas-nav--recipe-${escapeAttr(recipe)}` : '';
  const recipeAttr = recipe ? ` data-opencanvas-nav-style-recipe="${escapeAttr(recipe)}"` : '';

  const navStyleEntries: Array<[string, string]> = [];
  if (el.sticky) {
    navStyleEntries.push(['position', 'sticky']);
    navStyleEntries.push(['top', '0']);
    navStyleEntries.push(['z-index', '100']);
  }
  navStyleEntries.push(['width', '100%']);
  // height: 100% fills the absolutely-positioned element wrapper (always has
  // an explicit `height: <box.h>px` from buildElementWrapperStyle), so the
  // flex parent has a real content box. Without this the in-flow slots
  // (left, primary) collapse — empty left slot is 0px and primary's only
  // sibling rules don't set a height either — and the absolutely-positioned
  // center slot resolves `top: 50%` against a 0px parent → centered links
  // render with their top half above the section.
  navStyleEntries.push(['height', '100%']);
  navStyleEntries.push(['display', 'flex']);
  navStyleEntries.push(['align-items', 'center']);
  const navStyle = styleFromEntries(navStyleEntries);
  const themeOnScroll = el.themeOnScroll?.enabled === true ? el.themeOnScroll : null;
  const navThemeAttrs = themeOnScroll
    ? ` data-opencanvas-nav-theme-root="${escapeAttr(el.id)}"` +
      ` data-opencanvas-nav-theme-default="${escapeAttr(themeOnScroll.defaultTheme)}"` +
      ` data-opencanvas-nav-theme-active="${escapeAttr(themeOnScroll.defaultTheme)}"` +
      ` data-opencanvas-nav-theme-reduced-motion="${escapeAttr(themeOnScroll.reducedMotion)}"`
    : '';

  // Left slot bundles logo + siteTitle so both ride a single flex item; either
  // or both may be empty, but the slot itself is always emitted so the CSS
  // selector targets stay stable.
  const linksSlotName = el.layout === 'left-right' ? 'right' : 'center';
  const leftSlot = `<div class="opencanvas-nav-slot" data-slot="left">${logoHtml}${siteTitleHtml}</div>`;
  const linksSlot = `<div class="opencanvas-nav-slot" data-slot="${linksSlotName}">${linksHtml}</div>`;
  // Primary slot is conditionally emitted; CSS handles the margin-left:auto
  // dance via an adjacent-sibling override when `right` precedes `primary`
  // (see public-styles.ts) so the two trailing slots stay adjacent.
  const primarySlot =
    primaryActionHtml === ''
      ? ''
      : `<div class="opencanvas-nav-slot" data-slot="primary">${primaryActionHtml}</div>`;

  return (
    `<nav class="opencanvas-nav${recipeClass}" data-opencanvas-nav-layout="${escapeAttr(el.layout)}" ` +
    `data-opencanvas-nav-sticky="${el.sticky ? 'true' : 'false'}"${recipeAttr}${navThemeAttrs} ` +
    `style="${navStyle}">` +
    `${leftSlot}${linksSlot}${primarySlot}` +
    `</nav>`
  );
}

export const NAV_RECIPE_ID = 'site-nav' as const;

export const navInspectorSpec: InspectorSpec = {
  fields: [
    // Per-link editor (label + href + kind with per-kind href validation).
    // Imperative because the href input's placeholder and validation rule
    // both depend on lnk.kind, and changing kind must re-validate the
    // existing href against the new rule. A future declarative kind
    // covering "discriminated sub-field that depends on a sibling
    // discriminator" would generalize this with action-href; we wait
    // until a second consumer asks for that shape.
    { kind: 'custom-mount', name: 'nav-links' },
    // Single-link variant of `nav-links` for the optional primaryAction CTA.
    // Same per-kind href rule applies; renders an "Add primary action" button
    // when undefined and a remove button when set.
    { kind: 'custom-mount', name: 'nav-primary-action' },
    {
      kind: 'select',
      label: 'Layout',
      path: 'layout',
      options: ['left-right', 'left-center-right'],
      defaultValue: 'left-right',
    },
    { kind: 'checkbox', label: 'Sticky', path: 'sticky' },
    { kind: 'custom-mount', name: 'component-style' },
    { kind: 'custom-mount', name: 'nav-theme-on-scroll' },
    {
      kind: 'text',
      label: 'Site title',
      path: 'siteTitle',
      placeholder: 'Brand wordmark (optional)',
      emptyOmits: true,
    },
    // Header icon picker — three-row media picker (current / upload + clear /
    // gallery) filtered to image-kind assets. Imperative because the upload
    // path needs to round-trip through ctx.postAssetUpload before flipping
    // element.logoAssetId, and the gallery row needs an async refresh that
    // declarative kinds don't model. A future "asset-picker" declarative kind
    // covering "single asset slot with upload + gallery" would generalise this
    // (and the action.iconAssetId case if one ever lands) — wait for the
    // second consumer.
    { kind: 'custom-mount', name: 'nav-logo' },
  ],
};

export const navSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'nav',
      sidebarLabel: 'Nav',
      sidebarTip: 'Add a navigation bar',
      factoryName: 'nav',
    },
  ],
};

export const navAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    sticky: {
      type: 'boolean',
      description: 'Sticky positioning. Nav elements only.',
    },
    layout: {
      type: 'string',
      enum: ['left-center-right', 'left-right'],
      description: 'Nav layout. Nav elements only.',
    },
    links: {
      type: 'array',
      description:
        'Navigation links. Nav elements only. Each link needs label, href, and kind (internal, external, or anchor). IMPORTANT: this is FULL-REPLACE — to add a single link you MUST send the complete list of existing links plus the new one. Sending a partial array WILL DELETE the omitted links. Omitting all items via an empty [] clears the nav entirely.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          href: { type: 'string' },
          kind: { type: 'string', enum: ['internal', 'external', 'anchor'] },
        },
        required: ['label', 'href', 'kind'],
      },
    },
    logoAssetId: {
      type: 'string',
      description: 'Optional logo asset id. Nav elements only.',
    },
    siteTitle: {
      type: 'string',
      description:
        'Optional text wordmark shown in the left slot. Independent of logoAssetId. Nav elements only.',
    },
    themeOnScroll: {
      type: 'object',
      description:
        'Optional nav theme-on-scroll behaviour. Nav elements only. Enable to let section navThemeTarget values change this nav theme while scrolling.',
      properties: {
        enabled: { type: 'boolean' },
        defaultTheme: { type: 'string', enum: ['transparent', 'light', 'dark', 'solid'] },
        reducedMotion: { type: 'string', enum: ['instant', 'allow'] },
      },
      required: ['enabled', 'defaultTheme', 'reducedMotion'],
    },
    navStyle: componentStylePatchProperty(NAV_STYLE_SPEC),
    primaryAction: {
      type: 'object',
      description:
        'Optional call-to-action button at the right edge. Distinct from links — styled as a solid kit-accent button. Nav elements only.',
      properties: {
        label: { type: 'string' },
        href: { type: 'string' },
        kind: { type: 'string', enum: ['internal', 'external', 'anchor'] },
      },
      required: ['label', 'href', 'kind'],
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.sticky !== undefined) {
      if (typeof args.sticky !== 'boolean') throw new Error('sticky must be a boolean');
      patch.sticky = args.sticky;
    }
    if (args.layout !== undefined) {
      if (typeof args.layout !== 'string') throw new Error('layout must be a string');
      patch.layout = args.layout;
    }
    if (args.links !== undefined) {
      if (!Array.isArray(args.links)) throw new Error('links must be an array');
      patch.links = args.links;
    }
    if (args.logoAssetId !== undefined) {
      if (typeof args.logoAssetId !== 'string') throw new Error('logoAssetId must be a string');
      patch.logoAssetId = args.logoAssetId;
    }
    if (args.siteTitle !== undefined) {
      if (typeof args.siteTitle !== 'string') throw new Error('siteTitle must be a string');
      patch.siteTitle = args.siteTitle;
    }
    if (args.themeOnScroll !== undefined) {
      if (typeof args.themeOnScroll !== 'object' || args.themeOnScroll === null) {
        throw new Error('themeOnScroll must be an object');
      }
      patch.themeOnScroll = args.themeOnScroll;
    }
    if (args.navStyle !== undefined) {
      patch.navStyle = parseComponentStylePatchValue(args.navStyle, NAV_STYLE_SPEC);
    }
    if (args.primaryAction !== undefined) {
      if (typeof args.primaryAction !== 'object' || args.primaryAction === null) {
        throw new Error('primaryAction must be an object');
      }
      patch.primaryAction = args.primaryAction;
    }
    return patch;
  },
};
