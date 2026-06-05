// src/canvas/elements/collection.ts
//
// Collection element — a repeating array of entry groups inside a canvas
// section. Two modes:
//   - Manual: owner clicks "+" to add entries (testimonials, team, FAQ).
//     Each entry is a full copy of `entryTemplate` elements.
//   - Page-bound: entries auto-generated from pages matching a filter
//     (category, tags, limit) sorted by a field. Used for blog listings,
//     portfolio grids.
//
// The renderer loops `entries` in both modes. Page-bound collections use the
// same render contract after an upstream materializer has populated entries
// from matching page metadata.

import type { BaseElement, CanvasElement } from '../schema.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, styleFromEntries } from './render-utils.js';

// The collection-child wrapper used to add `data-opencanvas-element`, a positioning
// style, and a class — but it was a stripped-down clone of the canonical
// `opencanvas-element` wrapper, silently dropping aria, variant, motion, and
// elementStyle data-attrs. ctx.renderChild now returns the full canonical
// wrapper (see ElementRenderCtx.renderElement); cells emit it directly so
// every wrapper attr that a top-level element carries is also carried for
// collection children. Per the user's no-fallback rule, the previous partial
// wrapper was exactly the silent-degradation pattern banned.

export type CollectionMode = 'manual' | 'page-bound';

export const PAGE_METADATA_FIELDS = [
  'title',
  'description',
  'ogImage',
  'publishedDate',
  'author',
  'tags',
  'category',
] as const;
export type PageMetadataField = (typeof PAGE_METADATA_FIELDS)[number];

export interface CollectionFilter {
  category?: string;
  tags?: string[];
  limit?: number;
}

export interface CollectionSort {
  field: 'publishedDate' | 'title';
  order: 'asc' | 'desc';
}

export interface CollectionLayout {
  columns: number;
  gap: number;
}

export interface CollectionElement extends BaseElement {
  type: 'collection';
  mode: CollectionMode;

  entryTemplate: CanvasElement[];
  entries: CanvasElement[][];

  filter?: CollectionFilter;
  sort?: CollectionSort;
  cardTemplate?: CanvasElement[];
  fieldBindings?: Record<string, PageMetadataField>;

  layout: CollectionLayout;
}

export interface CollectionRenderCtx {
  styleKit: string;
  assetBasePath: string;
  renderChild: (element: CanvasElement) => string;
}

export function renderCollection(el: CollectionElement, ctx: CollectionRenderCtx): string {
  const gridStyle = styleFromEntries([
    ['display', 'grid'],
    ['grid-template-columns', `repeat(${String(el.layout.columns)},1fr)`],
    ['gap', `${String(el.layout.gap)}px`],
  ]);

  const entriesHtml = el.entries
    .map((entryElements, entryIdx) => {
      // Single pass over entryElements builds cells and tracks the tallest
      // bottom edge in lockstep — used as the row's min-height so absolutely
      // positioned cells don't collapse the entry container.
      let bottom = 0;
      const cellsHtml = entryElements
        .map((child) => {
          bottom = Math.max(bottom, child.box.y + child.box.h);
          return ctx.renderChild(child);
        })
        .join('');
      const rowStyle = styleFromEntries([
        ['position', 'relative'],
        ['min-height', `${String(bottom)}px`],
      ]);
      return `<div class="opencanvas-collection-entry" data-opencanvas-entry="${String(entryIdx)}" style="${escapeAttr(rowStyle)}">${cellsHtml}</div>`;
    })
    .join('');

  return `<div class="opencanvas-collection" data-opencanvas-interactive="collection" data-collection-mode="${escapeAttr(el.mode)}" style="${escapeAttr(gridStyle)}">${entriesHtml}</div>`;
}

export const COLLECTION_RECIPE_ID = 'collection-grid' as const;

// Collection has no per-type agent surface: the LLM cannot directly add or
// update a collection via the cross-element tools — collections are created
// from recipes (createSection / insertSection). Shared fields (box, motion,
// elementStyle) still apply via updateElement at the canvas-tools.ts level.
// The empty spec exists so the dispatch can satisfy its mapped-type contract
// without forcing the canvas-tools merger to special-case "missing entry."
export const collectionAgentToolSpec: AgentToolSpec = {
  patchProperties: {},
  parsePatch: () => ({}),
};

// Collection has no per-element sidebar command: bare CollectionElement
// instances would orphan without an index page, template page, and at least
// one entry. The Add panel surfaces a dedicated "+ New Collection" button
// that calls the full scaffold flow (src/editor-client/collection-scaffold.ts
// + POST /api/sites/:siteId/collections) instead. The empty commands array
// satisfies the dispatch's mapped-type contract.
export const collectionSidebarSpec: SidebarSpec = {
  commands: [],
};
