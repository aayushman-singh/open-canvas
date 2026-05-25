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
// The renderer loops `entries` in manual mode. In page-bound mode the
// renderer emits a placeholder grid — the actual page query runs at
// publish time in the snapshot builder, which populates `entries` before
// the renderer ever sees the snapshot.

import type { BaseElement, CanvasElement } from '../schema.js';
import { escapeAttr } from './render-utils.js';

export type CollectionMode = 'manual' | 'page-bound';

export const PAGE_METADATA_FIELDS = [
  'title',
  'description',
  'ogImage',
  'publishedDate',
  'author',
  'tags',
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
}

export function renderCollection(el: CollectionElement, ctx: CollectionRenderCtx): string {
  void ctx;
  const gridStyle = `display:grid;grid-template-columns:repeat(${String(el.layout.columns)},1fr);gap:${String(el.layout.gap)}px`;

  const entriesHtml = el.entries
    .map((entryElements, entryIdx) => {
      const cellsHtml = entryElements
        .map(
          (child) =>
            `<div class="rev01-collection-child" data-element-type="${escapeAttr(child.type)}" data-rev01-element="${escapeAttr(child.id)}"></div>`,
        )
        .join('');
      return `<div class="rev01-collection-entry" data-rev01-entry="${String(entryIdx)}">${cellsHtml}</div>`;
    })
    .join('');

  return `<div class="rev01-collection" data-rev01-interactive="collection" data-collection-mode="${escapeAttr(el.mode)}" style="${escapeAttr(gridStyle)}">${entriesHtml}</div>`;
}

export const COLLECTION_RECIPE_ID = 'collection-grid' as const;
