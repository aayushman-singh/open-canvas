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
import type { BaseElement } from '../schema.js';
import { escapeAttr, escapeHtml, styleFromEntries } from './render-utils.js';

export type NavLinkKind = 'internal' | 'external' | 'anchor';

export interface NavLink {
  label: string;
  href: string;
  kind: NavLinkKind;
}

export type NavLayout = 'left-center-right' | 'left-right';

export interface NavElement extends Omit<BaseElement, 'sticky'> {
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
function renderNavLink(link: NavLink): string {
  const href = navLinkHref(link);
  const target = link.kind === 'external' ? ' target="_blank" rel="noopener noreferrer"' : '';
  return (
    `<a class="opencanvas-nav-link" data-opencanvas-nav-link-kind="${escapeAttr(link.kind)}" ` +
    `href="${escapeAttr(href)}"${target}>` +
    `${escapeHtml(link.label)}` +
    `</a>`
  );
}

/** Build the logo container — empty when no asset id is set. */
function renderNavLogo(logoAssetId: string | undefined, assetBasePath: string): string {
  if (typeof logoAssetId !== 'string' || logoAssetId.length === 0) return '';
  const src = `${assetBasePath}/${logoAssetId}`;
  return `<img class="opencanvas-nav-logo" src="${escapeAttr(src)}" alt="" />`;
}

export function renderNav(el: NavElement, ctx: NavRenderCtx): string {
  // styleKit drives nav typography + spacing via kit CSS attached to the
  // outer document wrapper's data-style-kit attribute. The signature stays
  // uniform with every other element renderer.
  void ctx.styleKit;

  const logoHtml = renderNavLogo(el.logoAssetId, ctx.assetBasePath);
  const linksHtml = el.links.map(renderNavLink).join('');

  const navStyleEntries: Array<[string, string]> = [];
  if (el.sticky) {
    navStyleEntries.push(['position', 'sticky']);
    navStyleEntries.push(['top', '0']);
    navStyleEntries.push(['z-index', '100']);
  }
  navStyleEntries.push(['width', '100%']);
  navStyleEntries.push(['display', 'flex']);
  navStyleEntries.push(['align-items', 'center']);
  const navStyle = styleFromEntries(navStyleEntries);

  const linksSlotName = el.layout === 'left-right' ? 'right' : 'center';
  const logoSlot = `<div class="opencanvas-nav-slot" data-slot="left">${logoHtml}</div>`;
  const linksSlot = `<div class="opencanvas-nav-slot" data-slot="${linksSlotName}">${linksHtml}</div>`;

  return (
    `<nav class="opencanvas-nav" data-opencanvas-nav-layout="${escapeAttr(el.layout)}" ` +
    `data-opencanvas-nav-sticky="${el.sticky ? 'true' : 'false'}" ` +
    `style="${navStyle}">` +
    `${logoSlot}${linksSlot}` +
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
    {
      kind: 'select',
      label: 'Layout',
      path: 'layout',
      options: ['left-right', 'left-center-right'],
      defaultValue: 'left-right',
    },
    { kind: 'checkbox', label: 'Sticky', path: 'sticky' },
    {
      kind: 'text',
      label: 'Logo asset',
      path: 'logoAssetId',
      placeholder: 'Logo asset ID (optional)',
      emptyOmits: true,
    },
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
        'Navigation links. Nav elements only. Each link needs label, href, and kind (internal, external, or anchor).',
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
    return patch;
  },
};
