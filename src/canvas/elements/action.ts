// src/canvas/elements/action.ts
//
// Render fn for the existing `ActionElement` element type. Interface still
// lives in `src/canvas/schema.ts`; this module owns rendering only.

import { escapeAttr, escapeHtml } from './render-utils.js';
import type { ActionElement } from '../schema.js';

export function renderAction(element: ActionElement): string {
  return `<a class="rev01-action" data-variant="${escapeAttr(element.variant)}" href="${escapeAttr(element.href)}">${escapeHtml(element.label)}</a>`;
}
