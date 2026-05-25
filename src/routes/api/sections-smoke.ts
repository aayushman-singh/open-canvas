import type { CanvasPage, CanvasSection } from '../../canvas/schema.js';
import { validateBodySectionInsertAt } from './sections.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[sections:smoke] ${message}`);
}

function section(id: string, role?: CanvasSection['role']): CanvasSection {
  return {
    id,
    recipeId: 'custom',
    name: id,
    height: role === 'header' ? 72 : role === 'footer' ? 120 : 240,
    ...(role ? { role } : {}),
    elements: [],
  };
}

function pageWithRoles(
  roles: Array<CanvasSection['role'] | undefined>,
): Pick<CanvasPage, 'sections'> {
  return {
    sections: roles.map((role, idx) => section(`section-${String(idx)}`, role)),
  };
}

const page = pageWithRoles(['header', undefined, 'footer']);
assert(validateBodySectionInsertAt(page, 1).ok, 'insert after header must be allowed');
assert(validateBodySectionInsertAt(page, 2).ok, 'insert before footer must be allowed');

const beforeHeader = validateBodySectionInsertAt(page, 0);
assert(!beforeHeader.ok, 'insert before header must be rejected');
assert(
  !beforeHeader.ok && beforeHeader.error.includes('between 1 and 2'),
  'before-header rejection must report the legal body insertion range',
);

const afterFooter = validateBodySectionInsertAt(page, 3);
assert(!afterFooter.ok, 'insert after footer must be rejected');
assert(
  !afterFooter.ok && afterFooter.error.includes('between 1 and 2'),
  'after-footer rejection must report the legal body insertion range',
);

const pageWithoutPinnedSections = pageWithRoles([undefined, undefined]);
assert(
  validateBodySectionInsertAt(pageWithoutPinnedSections, 0).ok,
  'insert at start must be allowed without header',
);
assert(
  validateBodySectionInsertAt(pageWithoutPinnedSections, 2).ok,
  'insert at end must be allowed without footer',
);

console.log('[sections:smoke] OK');
