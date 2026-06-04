// src/canvas/section-library/category.ts
//
// ADR 0061 Decision 8 — the mapping from `recipeId` (an `AGENT_RECIPE_IDS`
// union value or `'custom'`) to `SectionCategory` for the picker filter.
//
// Body-position-only: header / footer assignment is positional (lives in
// `seed.state.header` / `seed.state.footer`), not recipe-driven, so callers
// that handle pinned sections override before falling through to this util.

import type { SectionCategory } from './categories.js';

export function categoryForRecipe(recipeId: string): SectionCategory {
  switch (recipeId) {
    case 'hero-split':
    case 'video-hero':
      return 'hero';
    case 'feature-grid':
      return 'features';
    case 'cta-band':
      return 'cta';
    case 'testimonial-row':
      return 'testimonials';
    case 'gallery-strip':
      return 'gallery';
    case 'logo-strip':
    case 'custom':
    default:
      return 'other';
  }
}
