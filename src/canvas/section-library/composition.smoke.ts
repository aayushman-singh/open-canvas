// src/canvas/section-library/composition.smoke.ts
//
// ADR 0061 Phase D — TemplateSeed composition + instantiateTemplate smoke.
//
// Three invariants over every template:
//
//   1. instantiateTemplate(id) returns an EditableSite that validates
//      against `validateEditableSite` (the editor's write gate).
//   2. Every materialised section carries `instanceScope` matching the
//      ref's `instanceId`. The Library row itself never carries it; the
//      instantiation pass is the only producer (Decision 7).
//   3. Per-template-id structural shape stays in lockstep with the
//      composition data: page count, body-ref count per page, header /
//      footer presence. Drift here means a composition edit silently
//      dropped a page or section.
//
// Run with `bun run section-library-composition:smoke`.

import { validateEditableSite } from '../validate.js';
import { allTemplateSeeds, instantiateTemplate } from '../../templates/registry.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[composition:smoke] ${message}`);
}

// -- Invariant 1 + 2: validate + scope ----------------------------------------

let totalSectionsCheck = 0;
for (const seed of allTemplateSeeds) {
  const state = instantiateTemplate(seed.id);

  const validation = validateEditableSite(state);
  assert(
    validation.valid,
    `${seed.id}: instantiateTemplate produces an invalid EditableSite:\n  ${validation.valid ? '' : validation.errors.join('\n  ')}`,
  );

  // Header / footer presence matches the composition.
  if (seed.headerRef) {
    assert(state.header !== undefined, `${seed.id}: composition headerRef present but state.header missing after instantiation`);
    assert(
      state.header.instanceScope === seed.headerRef.instanceId,
      `${seed.id}: state.header.instanceScope='${String(state.header.instanceScope)}' should match composition.headerRef.instanceId='${seed.headerRef.instanceId}'`,
    );
    totalSectionsCheck += 1;
  } else {
    assert(state.header === undefined, `${seed.id}: composition has no headerRef but state.header is set`);
  }
  if (seed.footerRef) {
    assert(state.footer !== undefined, `${seed.id}: composition footerRef present but state.footer missing after instantiation`);
    assert(
      state.footer.instanceScope === seed.footerRef.instanceId,
      `${seed.id}: state.footer.instanceScope='${String(state.footer.instanceScope)}' should match composition.footerRef.instanceId='${seed.footerRef.instanceId}'`,
    );
    totalSectionsCheck += 1;
  } else {
    assert(state.footer === undefined, `${seed.id}: composition has no footerRef but state.footer is set`);
  }

  // Page-by-page structural parity.
  assert(
    state.pages.length === seed.pages.length,
    `${seed.id}: instantiation produced ${String(state.pages.length)} pages but composition declares ${String(seed.pages.length)}`,
  );
  for (let pi = 0; pi < state.pages.length; pi += 1) {
    const page = state.pages[pi]!;
    const composition = seed.pages[pi]!;
    assert(
      page.sections.length === composition.bodyRefs.length,
      `${seed.id}: page[${String(pi)}] '${page.slug}' has ${String(page.sections.length)} sections but composition declares ${String(composition.bodyRefs.length)} bodyRefs`,
    );
    for (let si = 0; si < page.sections.length; si += 1) {
      const section = page.sections[si]!;
      const ref = composition.bodyRefs[si]!;
      assert(
        section.instanceScope === ref.instanceId,
        `${seed.id}: page[${String(pi)}].sections[${String(si)}].instanceScope='${String(section.instanceScope)}' should match composition.pages[${String(pi)}].bodyRefs[${String(si)}].instanceId='${ref.instanceId}'`,
      );
      totalSectionsCheck += 1;
    }
  }
}

assert(totalSectionsCheck > 0, 'expected at least one section to be checked across all templates');

// -- Bonus: each instantiation is independent — overrides on a clone don't
//    bleed back into the pool entry. ---------------------------------------

{
  const first = instantiateTemplate('starter-canvas');
  const firstFirstSection = first.pages[0]!.sections[0]!;
  const originalName = firstFirstSection.name;
  firstFirstSection.name = `${originalName}-mutated`;
  const second = instantiateTemplate('starter-canvas');
  assert(
    second.pages[0]!.sections[0]!.name === originalName,
    `mutation of one instantiation must not leak into a fresh instantiation (pool entry should be deep-cloned per call)`,
  );
}

console.log(
  `[composition:smoke] OK — ${String(allTemplateSeeds.length)} templates instantiate, validate, and stamp instanceScope on ${String(totalSectionsCheck)} sections`,
);
