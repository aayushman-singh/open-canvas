// src/canvas/section-library/testimonial-fixtures.smoke.ts
//
// ADR 0061 Phase F — verifies the three standalone testimonial fixtures
// the user asked for ship in a state the picker can drop directly onto
// a page.
//
// Three checks per variant:
//   1. Validates as a CanvasSection through `validateEditableSite` (the
//      same gate the editor uses on every write — see ADR 0011).
//   2. Renders through `renderCanvasSnapshot` without throwing — catches
//      class issues like missing fields, unknown element types, or bad
//      style-kit resolution before the section can ship.
//   3. Has the per-variant content signature the ADR pins (Decision 10):
//      `library-template-testimonial-quote` carries one heading-role text
//      with the pulled quote; `library-template-testimonial-cards` has
//      three card subtrees each with avatar + quote + attribution;
//      `library-template-testimonial-video` carries a `mediaKind:'video'`
//      element. Same-shape colour swaps wouldn't exercise the picker's
//      new search/filter affordances.
//
// Run with `bun run section-library-testimonial-fixtures:smoke`.

import type { CanvasElement, EditableSite, PublishedSnapshot } from '../schema.js';
import { validateEditableSite } from '../validate.js';
import { renderCanvasSnapshot } from '../render.js';
import { SECTION_LIBRARY } from './registry.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[testimonial-fixtures:smoke] ${message}`);
}

const TESTIMONIAL_SLUGS = [
  'library-template-testimonial-quote',
  'library-template-testimonial-cards',
  'library-template-testimonial-video',
] as const;
type TestimonialSlug = (typeof TESTIMONIAL_SLUGS)[number];

const bySlug = new Map<string, (typeof SECTION_LIBRARY)[number]>();
for (const entry of SECTION_LIBRARY) {
  bySlug.set(entry.baseSlug, entry);
}

// -- Per-variant content signature checks --------------------------------------

function countByType(elements: ReadonlyArray<CanvasElement>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const el of elements) {
    out[el.type] = (out[el.type] ?? 0) + 1;
  }
  return out;
}

function assertVariantSignature(slug: TestimonialSlug, elements: ReadonlyArray<CanvasElement>): void {
  const counts = countByType(elements);
  const textCount = counts.text ?? 0;
  switch (slug) {
    case 'library-template-testimonial-quote': {
      // Single pulled quote + attribution: at least one heading-role text
      // (the quote), no media. The kicker brings it to ≥3 texts.
      assert(textCount >= 2, `${slug}: expected ≥2 text elements (quote + attribution), got ${String(textCount)}`);
      assert(counts.media === undefined, `${slug}: quote variant must NOT carry media — keep it text-only`);
      const hasHeading = elements.some((e) => e.type === 'text' && e.role === 'heading');
      assert(hasHeading, `${slug}: expected at least one text element with role='heading' carrying the pulled quote`);
      break;
    }
    case 'library-template-testimonial-cards': {
      // Three card subtrees: ≥3 containers (one per card background) and
      // ≥3 media elements (one avatar per card).
      assert((counts.container ?? 0) >= 3, `${slug}: expected ≥3 container elements (one per card), got ${String(counts.container ?? 0)}`);
      assert((counts.media ?? 0) >= 3, `${slug}: expected ≥3 media elements (one avatar per card), got ${String(counts.media ?? 0)}`);
      assert(textCount >= 9, `${slug}: expected ≥9 text elements (3 cards × 3 texts), got ${String(textCount)}`);
      break;
    }
    case 'library-template-testimonial-video': {
      // Video media on the left + supporting quote on the right.
      const videoMedia = elements.find((e) => e.type === 'media' && e.mediaKind === 'video');
      assert(videoMedia !== undefined, `${slug}: expected at least one media element with mediaKind='video'`);
      assert(textCount >= 3, `${slug}: expected ≥3 text elements (heading + quote + attribution), got ${String(textCount)}`);
      break;
    }
  }
}

// -- Build a renderable snapshot wrapping one section --------------------------

function syntheticSnapshot(section: (typeof SECTION_LIBRARY)[number]): PublishedSnapshot {
  const editable: EditableSite = {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-fixture',
        slug: 'home',
        title: 'Testimonial fixture',
        width: 1440,
        sections: [section.sectionData],
      },
    ],
  };
  return {
    ...editable,
    version: 1,
    publishedAt: '2026-06-04T00:00:00.000Z',
  };
}

// -- Run the three checks per variant ------------------------------------------

let verified = 0;
for (const slug of TESTIMONIAL_SLUGS) {
  const entry = bySlug.get(slug);
  assert(entry !== undefined, `${slug}: entry missing from SECTION_LIBRARY — was the JSON deleted, or did extraction skip it?`);

  // 1. Validates as a CanvasSection (via synthetic EditableSite).
  const editable: EditableSite = {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-fixture',
        slug: 'home',
        title: 'Testimonial fixture',
        width: 1440,
        sections: [entry.sectionData],
      },
    ],
  };
  const validation = validateEditableSite(editable);
  assert(
    validation.valid,
    `${slug}: failed validateEditableSite — fixture needs editing:\n  ${validation.valid ? '' : validation.errors.join('\n  ')}`,
  );

  // 2. Renders without throwing.
  const snapshot = syntheticSnapshot(entry);
  const html = renderCanvasSnapshot(snapshot, '/__assets', 'fixture-site', {
    turnstileSiteKey: '0xTEST',
  });
  assert(typeof html === 'string' && html.length > 0, `${slug}: render returned empty string`);
  assert(html.includes('opencanvas-section'), `${slug}: rendered HTML missing .opencanvas-section wrapper`);

  // 3. Per-variant content signature.
  assertVariantSignature(slug, entry.sectionData.elements);

  // Bonus: category + recipeId must match the ADR Decision 10 pins.
  assert(entry.category === 'testimonials', `${slug}: category must be 'testimonials', got '${entry.category}'`);
  assert(entry.recipeId === 'testimonial-row', `${slug}: recipeId must be 'testimonial-row', got '${entry.recipeId}'`);
  assert(entry.originTemplateId === null, `${slug}: standalone fixture must have originTemplateId=null (not from a template)`);

  verified += 1;
}

assert(verified === TESTIMONIAL_SLUGS.length, `expected to verify ${String(TESTIMONIAL_SLUGS.length)} variants, verified ${String(verified)}`);

console.log(`[testimonial-fixtures:smoke] OK — ${String(verified)} testimonial variants validate, render, and match Decision 10 signatures`);
