// src/symbols/smoke.ts
//
// `bun run symbols:smoke` — Wave 3 #14 smoke. Verifies the override-style
// symbol model: master CRUD, instance creation, render-time merge, override
// precedence, delete-with-instances refusal, detach-all + delete, missing
// symbolId throws loudly. Pure-CPU; no DB, no Workers globals.
//
// Assertions follow the brief's 5-point list:
//   1. Create master "Footer" with 2 elements + create instance + render →
//      both elements appear at the instance position.
//   2. Edit master text → rendering instance reflects the change.
//   3. Override one inner element label on instance → render shows override;
//      master unchanged; a second instance still shows master.
//   4. Delete master with active instances → throws; detach-all then delete
//      succeeds.
//   5. Render instance with missing `symbolId` → throws loudly with the
//      offending id in the message.

import { renderCanvasSnapshot } from '../canvas/render.js';
import type {
  ActionElement,
  CanvasPage,
  CanvasSection,
  CanvasSiteState,
  PublishedSnapshot,
  TextElement,
} from '../canvas/schema.js';
import {
  configureSymbolInstanceRender,
  type SymbolInstanceElement,
} from '../canvas/elements/symbol-instance.js';

import { detachAllInstancesOfSymbol, detachInstance } from './detach.js';
import { createSymbolInstance, setOverride } from './instance.js';
import {
  createSymbolMaster,
  deleteSymbolMaster,
  findInstancesOfSymbol,
  updateSymbolMaster,
} from './master.js';
import { resolveSymbolInstance } from './merge.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[symbols:smoke] ${message}`);
}

function assertThrows(fn: () => unknown, contains: string, message: string): void {
  let threw: Error | null = null;
  try {
    fn();
  } catch (err) {
    threw = err instanceof Error ? err : new Error(String(err));
  }
  if (threw === null) {
    throw new Error(`[symbols:smoke] ${message} — expected throw, none thrown`);
  }
  assert(
    threw.message.includes(contains),
    `${message} — expected error message to contain ${JSON.stringify(contains)}, got ${JSON.stringify(threw.message)}`,
  );
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeText(id: string, text: string, x: number, y: number): TextElement {
  return {
    id,
    type: 'text',
    box: { x, y, w: 240, h: 48, z: 1 },
    content: [{ text }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
  };
}

function makeAction(id: string, label: string, x: number, y: number): ActionElement {
  return {
    id,
    type: 'action',
    box: { x, y, w: 200, h: 48, z: 2 },
    label,
    href: 'https://rev01.aayushman.dev',
    variant: 'solid',
  };
}

function makeFooterSection(): CanvasSection {
  return {
    id: 'sec-footer-master',
    recipeId: 'cta-band',
    name: 'Footer master',
    height: 240,
    elements: [
      makeText('el-footer-text', 'Original footer text', 20, 40),
      makeAction('el-footer-cta', 'Get started', 20, 120),
    ],
  };
}

function makePage(slug: string, sections: CanvasSection[]): CanvasPage {
  // Single-page POC: we keep ONE page per state, but for tests we still want
  // to drop instances on different sections within that one page. The "two
  // pages" model in the original plan is mapped to "two sections on one page"
  // because validateCanvasSiteState enforces pages.length === 1.
  return {
    id: `page-${slug}`,
    slug,
    title: `Page ${slug}`,
    width: 1200,
    sections,
  };
}

function makeBlankInstanceHostSection(id: string, instance: SymbolInstanceElement): CanvasSection {
  return {
    id,
    recipeId: 'cta-band',
    name: 'Host for instance',
    height: 280,
    elements: [instance],
  };
}

function makeState(symbols: CanvasSiteState['symbols'], pages: CanvasPage[]): CanvasSiteState {
  return {
    styleKit: 'charcoal',
    pages,
    symbols,
  };
}

function snapshotOf(state: CanvasSiteState): PublishedSnapshot {
  return {
    version: 1,
    publishedAt: '2026-05-23T00:00:00.000Z',
    styleKit: state.styleKit,
    pages: state.pages,
    symbols: state.symbols,
  };
}

function renderSnapshot(state: CanvasSiteState): string {
  configureSymbolInstanceRender({ symbols: state.symbols });
  try {
    return renderCanvasSnapshot(snapshotOf(state), '/assets', 'test-site');
  } finally {
    configureSymbolInstanceRender({ symbols: null });
  }
}

// ---------------------------------------------------------------------------
// (1) Create master + instance + render → both inner elements appear.
// ---------------------------------------------------------------------------

{
  const state = makeState([], [makePage('home', [makeFooterSection()])]);
  // Lift the section into a master and replace the page slot with an instance.
  const originalSection = state.pages[0]!.sections[0]!;
  const master = createSymbolMaster(state, {
    id: 'sym-footer',
    name: 'Footer',
    section: originalSection,
  });
  assert(master.id === 'sym-footer', '(1) master id round-trips');
  assert(state.symbols.length === 1, '(1) symbols array has 1 master');

  const instance = createSymbolInstance(state, {
    symbolId: 'sym-footer',
    box: { x: 0, y: 0, w: 1200, h: 240, z: 1 },
    id: 'el-footer-instance-1',
  });
  // Replace the page's first section with one that hosts the instance.
  state.pages[0]!.sections = [makeBlankInstanceHostSection('sec-page-footer', instance)];

  const html = renderSnapshot(state);
  assert(
    html.includes('data-rev01-symbol-id="sym-footer"'),
    '(1) rendered instance wrapper carries symbol id',
  );
  assert(
    html.includes('data-rev01-element="el-footer-text"'),
    '(1) inner text element renders at instance position',
  );
  assert(
    html.includes('data-rev01-element="el-footer-cta"'),
    '(1) inner action element renders at instance position',
  );
  assert(
    html.includes('Original footer text'),
    '(1) inner text content is in the rendered HTML',
  );
  assert(html.includes('Get started'), '(1) inner action label is in the rendered HTML');
}

// ---------------------------------------------------------------------------
// (2) Edit master text → every instance reflects it.
// ---------------------------------------------------------------------------

{
  const state = makeState([], [makePage('home', [makeFooterSection()])]);
  const master = createSymbolMaster(state, {
    id: 'sym-footer-2',
    name: 'Footer',
    section: state.pages[0]!.sections[0]!,
  });
  void master;
  const instance = createSymbolInstance(state, {
    symbolId: 'sym-footer-2',
    box: { x: 0, y: 0, w: 1200, h: 240, z: 1 },
    id: 'el-instance-2',
  });
  state.pages[0]!.sections = [makeBlankInstanceHostSection('sec-host-2', instance)];

  const before = renderSnapshot(state);
  assert(before.includes('Original footer text'), '(2) baseline text present');

  // Edit master via updateSymbolMaster: replace the master section with one
  // whose text reads differently. The master's first element keeps the same
  // id so override-keyed addressing remains valid.
  const editedSection: CanvasSection = {
    id: 'sec-footer-master',
    recipeId: 'cta-band',
    name: 'Footer master',
    height: 240,
    elements: [
      makeText('el-footer-text', 'Edited master text', 20, 40),
      makeAction('el-footer-cta', 'Get started', 20, 120),
    ],
  };
  updateSymbolMaster(state, 'sym-footer-2', { section: editedSection });

  const after = renderSnapshot(state);
  assert(
    after.includes('Edited master text'),
    '(2) edited master text appears in rendered instance',
  );
  assert(
    !after.includes('Original footer text'),
    '(2) old text no longer present after master edit',
  );
}

// ---------------------------------------------------------------------------
// (3) Override one instance's CTA label; master + second instance unchanged.
// ---------------------------------------------------------------------------

{
  const state = makeState([], [makePage('home', [makeFooterSection()])]);
  createSymbolMaster(state, {
    id: 'sym-footer-3',
    name: 'Footer',
    section: state.pages[0]!.sections[0]!,
  });

  const instanceA = createSymbolInstance(state, {
    symbolId: 'sym-footer-3',
    box: { x: 0, y: 0, w: 1200, h: 240, z: 1 },
    id: 'el-instance-3a',
  });
  const instanceB = createSymbolInstance(state, {
    symbolId: 'sym-footer-3',
    box: { x: 0, y: 280, w: 1200, h: 240, z: 1 },
    id: 'el-instance-3b',
  });

  // Override A's CTA label only.
  setOverride(instanceA, 'el-footer-cta', { label: 'About →' });

  // Host both instances in their own sections on the single page.
  state.pages[0]!.sections = [
    makeBlankInstanceHostSection('sec-host-3a', instanceA),
    makeBlankInstanceHostSection('sec-host-3b', instanceB),
  ];

  const html = renderSnapshot(state);

  // Per-instance check: locate the resolved-section block for each instance
  // and assert the right label is inside. The resolved section id equals the
  // instance element id (per merge rule 3).
  function blockFor(resolvedId: string): string {
    const markerA = `data-rev01-resolved-section="${resolvedId}"`;
    const start = html.indexOf(markerA);
    assert(start >= 0, `(3) expected resolved-section block for ${resolvedId}`);
    // The wrapping div closes after exactly one </div> at the same depth; for
    // our renderer's output the structure is flat enough that we can take the
    // next 5KB or until the next instance marker.
    const next = html.indexOf('data-rev01-symbol-id', start + markerA.length);
    return next > start ? html.slice(start, next) : html.slice(start);
  }

  const blockA = blockFor('el-instance-3a');
  const blockB = blockFor('el-instance-3b');
  assert(blockA.includes('About →'), '(3) instance A renders overridden label');
  assert(
    !blockA.includes('>Get started<'),
    '(3) instance A does NOT carry the master label after override',
  );
  assert(blockB.includes('Get started'), '(3) instance B still renders master label');
  assert(
    !blockB.includes('About →'),
    '(3) instance B does NOT carry instance A’s override (overrides are per-instance)',
  );

  // Master should be unchanged.
  const master = state.symbols.find((s) => s.id === 'sym-footer-3')!;
  const masterCta = master.section.elements.find((e) => e.id === 'el-footer-cta') as ActionElement;
  assert(
    masterCta.label === 'Get started',
    '(3) master CTA label unchanged after instance override',
  );
}

// ---------------------------------------------------------------------------
// (4) Delete master with active instances → throws; detach-all then delete OK.
// ---------------------------------------------------------------------------

{
  const state = makeState([], [makePage('home', [makeFooterSection()])]);
  createSymbolMaster(state, {
    id: 'sym-footer-4',
    name: 'Footer',
    section: state.pages[0]!.sections[0]!,
  });
  const instance = createSymbolInstance(state, {
    symbolId: 'sym-footer-4',
    box: { x: 0, y: 0, w: 1200, h: 240, z: 1 },
    id: 'el-instance-4',
  });
  state.pages[0]!.sections = [makeBlankInstanceHostSection('sec-host-4', instance)];

  assertThrows(
    () => deleteSymbolMaster(state, 'sym-footer-4'),
    'still has 1 instance',
    '(4) deleteSymbolMaster refuses while instances exist',
  );

  // Detach all then delete.
  const detached = detachAllInstancesOfSymbol(state, 'sym-footer-4');
  assert(detached.length === 1, '(4) detach-all detaches exactly one instance');
  const stillReferencing = findInstancesOfSymbol(state, 'sym-footer-4');
  assert(stillReferencing.length === 0, '(4) no instances reference the symbol after detach-all');
  const removed = deleteSymbolMaster(state, 'sym-footer-4');
  assert(removed.id === 'sym-footer-4', '(4) deletion succeeds after detach-all');
  assert(state.symbols.length === 0, '(4) symbols array is empty after detach + delete');

  // The detached section must contain the original element ids — re-generated,
  // so they should NOT match the master's. Render the state to verify both
  // elements are present.
  const html = renderSnapshot(state);
  assert(
    html.includes('Original footer text'),
    '(4) detached section preserves master text content',
  );
  assert(html.includes('Get started'), '(4) detached section preserves master CTA label');
  // The instance wrapper must be gone.
  assert(
    !html.includes('data-rev01-symbol-id'),
    '(4) detached state contains no symbol-instance wrapper',
  );
}

// ---------------------------------------------------------------------------
// (5) Render an instance with a missing symbolId → throws loudly.
// ---------------------------------------------------------------------------

{
  const state = makeState([], [makePage('home', [makeFooterSection()])]);
  // Don't create the master — the instance references a non-existent id.
  const orphan: SymbolInstanceElement = {
    id: 'el-orphan-instance',
    type: 'symbol-instance',
    box: { x: 0, y: 0, w: 1200, h: 240, z: 1 },
    symbolId: 'sym-ghost-DOES-NOT-EXIST',
    overrides: {},
  };
  // resolveSymbolInstance should throw directly with the offending symbolId in the message.
  assertThrows(
    () => resolveSymbolInstance(orphan, state),
    'sym-ghost-DOES-NOT-EXIST',
    '(5) resolveSymbolInstance throws with the offending symbolId in the message',
  );
  // The render dispatch path should also throw loudly (same error surfaces
  // via the render fn). We mount the orphan on the page and render.
  state.pages[0]!.sections = [makeBlankInstanceHostSection('sec-host-5', orphan)];
  assertThrows(
    () => renderSnapshot(state),
    'sym-ghost-DOES-NOT-EXIST',
    '(5) renderCanvasSnapshot propagates the missing-symbolId error',
  );
}

// ---------------------------------------------------------------------------
// Additional invariants
// ---------------------------------------------------------------------------

// (a) Nested symbols are refused at create time.
{
  const state = makeState([], [makePage('home', [makeFooterSection()])]);
  createSymbolMaster(state, {
    id: 'sym-base',
    name: 'Base',
    section: state.pages[0]!.sections[0]!,
  });
  const innerInstance = createSymbolInstance(state, {
    symbolId: 'sym-base',
    box: { x: 0, y: 0, w: 1200, h: 240, z: 1 },
  });
  const offendingSection: CanvasSection = {
    id: 'sec-nested',
    recipeId: 'cta-band',
    name: 'Nested',
    height: 240,
    elements: [innerInstance],
  };
  assertThrows(
    () =>
      createSymbolMaster(state, {
        id: 'sym-nested',
        name: 'Nested',
        section: offendingSection,
      }),
    'nested symbols are forbidden',
    '(a) createSymbolMaster refuses a section that contains a symbol-instance',
  );
}

// (b) Detach single instance still preserves overrides at detach time.
{
  const state = makeState([], [makePage('home', [makeFooterSection()])]);
  createSymbolMaster(state, {
    id: 'sym-detach-keep',
    name: 'Footer',
    section: state.pages[0]!.sections[0]!,
  });
  const instance = createSymbolInstance(state, {
    symbolId: 'sym-detach-keep',
    box: { x: 0, y: 0, w: 1200, h: 240, z: 1 },
    id: 'el-detach-keep',
  });
  setOverride(instance, 'el-footer-cta', { label: 'Detached label' });
  state.pages[0]!.sections = [makeBlankInstanceHostSection('sec-host-detach', instance)];

  const detached = detachInstance(state, 'el-detach-keep');
  assert(detached.elements.length === 2, '(b) detached section has 2 elements');
  const cta = detached.elements.find((e) => e.type === 'action') as ActionElement;
  assert(
    cta.label === 'Detached label',
    `(b) detached CTA carries the override label (got ${JSON.stringify(cta.label)})`,
  );
  // The detached section's element ids must be fresh (the resolver regenerates
  // them so a second detach of another instance doesn't collide).
  assert(
    detached.elements.every((e) => e.id !== 'el-footer-text' && e.id !== 'el-footer-cta'),
    '(b) detached inner element ids are regenerated, not the master ids',
  );
}

console.log('[symbols:smoke] OK');
