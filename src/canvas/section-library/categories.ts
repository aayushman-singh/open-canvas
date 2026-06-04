// src/canvas/section-library/categories.ts
//
// ADR 0061 Decision 8 — the closed Section Category enum, lifted out of
// `src/db/schema.ts` so the editor-client bundle (which imports it for
// the picker dropdown) does not need to pull in `drizzle-orm/pg-core`.
//
// Order here drives the picker dropdown order — keep the user-facing
// reading order, not insertion order.

export const SECTION_CATEGORIES = [
  'header',
  'hero',
  'features',
  'testimonials',
  'cta',
  'gallery',
  'footer',
  'other',
] as const;
export type SectionCategory = (typeof SECTION_CATEGORIES)[number];
