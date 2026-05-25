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
import { escapeAttr, styleFromEntries } from './render-utils.js';

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

function childWrapperStyle(child: CanvasElement): string {
  return styleFromEntries([
    ['position', 'absolute'],
    ['left', `${String(child.box.x)}px`],
    ['top', `${String(child.box.y)}px`],
    ['width', `${String(child.box.w)}px`],
    ['height', `${String(child.box.h)}px`],
    ['z-index', String(child.box.z)],
  ]);
}

function entryHeight(entryElements: CanvasElement[]): number {
  let bottom = 0;
  for (const child of entryElements) {
    bottom = Math.max(bottom, child.box.y + child.box.h);
  }
  return bottom;
}

export function renderCollection(el: CollectionElement, ctx: CollectionRenderCtx): string {
  const gridStyle = `display:grid;grid-template-columns:repeat(${String(el.layout.columns)},1fr);gap:${String(el.layout.gap)}px`;

  const entriesHtml = el.entries
    .map((entryElements, entryIdx) => {
      const rowStyle = styleFromEntries([
        ['position', 'relative'],
        ['min-height', `${String(entryHeight(entryElements))}px`],
      ]);
      const cellsHtml = entryElements
        .map(
          (child) =>
            `<div class="rev01-collection-child" data-element-type="${escapeAttr(child.type)}" data-rev01-element="${escapeAttr(child.id)}" style="${escapeAttr(childWrapperStyle(child))}">${ctx.renderChild(child)}</div>`,
        )
        .join('');
      return `<div class="rev01-collection-entry" data-rev01-entry="${String(entryIdx)}" style="${escapeAttr(rowStyle)}">${cellsHtml}</div>`;
    })
    .join('');

  return `<div class="rev01-collection" data-rev01-interactive="collection" data-collection-mode="${escapeAttr(el.mode)}" style="${escapeAttr(gridStyle)}">${entriesHtml}</div>`;
}

export const COLLECTION_RECIPE_ID = 'collection-grid' as const;
