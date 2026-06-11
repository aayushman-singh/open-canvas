// src/canvas/section-import-anchor.smoke.ts
//
// Regression: importing a section must not carry the source's `anchorId`
// (section-level or element-level) into the target page. ADR 0050 dec 2
// requires anchorIds unique within a rendered page; the picker's portfolio
// entries ship anchorId "top"/"about"/"contact", so re-importing one into a
// page that already uses that slug produced a duplicate anchor that failed
// validateEditableSite — surfaced to the Owner as
// "Insert failed: imported section produced invalid state".
//
// anchorId is a page-scoped in-page-link target meaningful only in the
// source page's nav graph; a freshly imported body section has nothing
// pointing at it in the target, so it is stripped on import like `role`.

import { allTemplateSeeds, instantiateTemplate } from './../templates/registry.js';
import { importSectionIntoSite } from './section-import.js';
import { validateEditableSite } from './validate.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// portfolio-showcase ships section-level anchorIds ("top", "about").
const seed = allTemplateSeeds.find((s) => s.id === 'portfolio-showcase');
assert(seed !== undefined, 'portfolio-showcase seed must exist for this regression');

const state = instantiateTemplate(seed.id);
const source = state.pages[0]?.sections.find((s) => s.anchorId !== undefined);
assert(source !== undefined, 'expected a portfolio section with an anchorId');

const result = importSectionIntoSite({
  targetCustomerId: 'anchor-regression-customer',
  sourceSection: source,
  existingAssetIds: new Set<string>(),
  existingByHash: new Map(),
});
assert(result.ok, `import must succeed: ${result.ok ? '' : result.errors.join('; ')}`);

assert(
  result.section.anchorId === undefined,
  `imported section must not carry source anchorId (got "${String(result.section.anchorId)}")`,
);
for (const element of result.section.elements) {
  assert(
    element.anchorId === undefined,
    `imported element must not carry source anchorId (got "${String(element.anchorId)}" on ${element.id})`,
  );
}

// Route-shaped check: splice the clone back into the very page it came from
// (worst case for collision) and confirm the whole state still validates.
const target = instantiateTemplate(seed.id);
target.pages[0]?.sections.splice(0, 0, result.section);
const validation = validateEditableSite(target);
assert(
  validation.valid,
  `post-splice state must validate; got: ${validation.valid ? '' : validation.errors.join(' | ')}`,
);

console.log('section-import anchor regression OK');
