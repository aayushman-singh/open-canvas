import type { CanvasPage, CanvasSection } from '../../canvas/schema.js';
import { validateBodySectionInsertAt } from './sections.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[sections:smoke] ${message}`);
}

function section(id: string): CanvasSection {
  return {
    id,
    recipeId: 'custom',
    name: id,
    height: 240,
    elements: [],
  };
}

function pageWith(sectionCount: number): Pick<CanvasPage, 'sections'> {
  return {
    sections: Array.from({ length: sectionCount }, (_v, idx) => section(`section-${String(idx)}`)),
  };
}

// ADR 0059 — page sections are never pinned; insertAt accepts any [0, length].
const page = pageWith(3);
assert(validateBodySectionInsertAt(page, 0).ok, 'insert at start must be allowed');
assert(validateBodySectionInsertAt(page, 1).ok, 'insert in middle must be allowed');
assert(validateBodySectionInsertAt(page, 3).ok, 'insert at end must be allowed');

const negative = validateBodySectionInsertAt(page, -1);
assert(!negative.ok, 'negative insertAt must be rejected');
assert(
  !negative.ok && negative.error.includes('between 0 and 3'),
  'negative rejection must report the legal range',
);

const tooLarge = validateBodySectionInsertAt(page, 4);
assert(!tooLarge.ok, 'insertAt past end must be rejected');
assert(
  !tooLarge.ok && tooLarge.error.includes('between 0 and 3'),
  'past-end rejection must report the legal range',
);

const emptyPage = pageWith(0);
assert(validateBodySectionInsertAt(emptyPage, 0).ok, 'insert at 0 must be allowed on empty page');

console.log('[sections:smoke] OK');
