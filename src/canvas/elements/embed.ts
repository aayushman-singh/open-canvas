// src/canvas/elements/embed.ts
//
// Phase 0 stub. `EmbedElement` interface + render stub. Wave 2 owner: see
// docs/superpowers/plans/2026-05-23-08-embed.md.

import type { BaseElement } from '../schema.js';

export interface EmbedElement extends BaseElement {
  type: 'embed';
  url: string;
  title?: string;
  /** width / height. Defaults to 16/9 when undefined. */
  aspectRatio?: number;
}

export interface EmbedRenderCtx {
  styleKit: string;
}

export function renderEmbed(el: EmbedElement, ctx: EmbedRenderCtx): string {
  void el;
  void ctx;
  throw new Error(
    'TODO: implement in Wave 2 — see docs/superpowers/plans/2026-05-23-08-embed.md',
  );
}

export const EMBED_RECIPE_ID = 'embed-card' as const;
