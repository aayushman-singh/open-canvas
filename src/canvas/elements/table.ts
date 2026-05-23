// src/canvas/elements/table.ts
//
// Phase 0 stub. `TableElement` interface + render stub. Wave 4 owner: see
// docs/superpowers/plans/2026-05-23-18-table.md.

import type { BaseElement } from '../schema.js';

export interface TableColumn {
  id: string;
  header: string;
  align?: 'left' | 'center' | 'right';
}

export interface TableRow {
  id: string;
  /** column id → cell text. Cells absent from this record render as empty. */
  cells: Record<string, string>;
}

export interface TableElement extends BaseElement {
  type: 'table';
  columns: TableColumn[];
  rows: TableRow[];
  zebra: boolean;
  collapseOnPhone: boolean;
}

export interface TableRenderCtx {
  styleKit: string;
}

export function renderTable(el: TableElement, ctx: TableRenderCtx): string {
  void el;
  void ctx;
  throw new Error(
    'TODO: implement in Wave 4 — see docs/superpowers/plans/2026-05-23-18-table.md',
  );
}

export const TABLE_RECIPE_ID = 'table-card' as const;
