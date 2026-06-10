// src/agent/rebrand/plan.smoke.ts
//
// `bun run rebrand-plan:smoke` — exercises the PURE rebrand core
// (`src/agent/rebrand/plan.ts`) against a hand-built "pizza joint → fine dining"
// rebrand. No LLM, no Replicate, no DB, no keys.
//
// Proves:
//   1. describeOp derives the before/after diff from the real state (not the
//      model): rename occurrence count, current vs new text, kit swap, image swap.
//   2. assessProposals marks each op applicable iff applying it yields a valid
//      site; a rewrite of a non-existent element is flagged non-applicable.
//   3. applyRebrandSubset(all) folds every accepted op into a valid preview
//      state where the brand is rebranded — and never mutates the input.
//   4. Accepting a SUBSET (reject the style swap) applies only the chosen ops.
//   5. A subset containing a broken op fails loud (ok:false) and reports it.
//   6. acceptedOps returns exactly the chosen ops in plan order.

import {
  describeOp,
  assessProposals,
  applyRebrandSubset,
  acceptedOps,
  type RebrandPlan,
  type RebrandProposal,
} from './plan.js';
import { validateEditableSite } from '../../canvas/validate.js';
import type { CanvasPage, CanvasSection, EditableSite, MediaElement, TextElement } from '../../canvas/schema.js';

let passed = 0;
function ok(label: string): void {
  passed += 1;
  process.stdout.write(`[rebrand-plan:smoke] OK   ${label}\n`);
}
function fail(label: string, detail?: string): never {
  process.stderr.write(`[rebrand-plan:smoke] FAIL ${label}\n`);
  if (detail) process.stderr.write(`  ${detail}\n`);
  process.exit(1);
}
function assert(cond: unknown, label: string, detail?: string): asserts cond {
  if (cond) {
    ok(label);
    return;
  }
  fail(label, detail);
}

// ---------------------------------------------------------------------------
// Fixture — a casual pizza site.
// ---------------------------------------------------------------------------

function mkHeading(id: string, text: string): TextElement {
  return {
    id,
    type: 'text',
    box: { x: 40, y: 40, w: 700, h: 90, z: 2 },
    content: [{ text }],
    role: 'heading',
    fontSize: 56,
    fontWeight: 700,
    align: 'left',
  };
}
function mkBody(id: string, text: string): TextElement {
  return {
    id,
    type: 'text',
    box: { x: 40, y: 150, w: 700, h: 60, z: 1 },
    content: [{ text }],
    role: 'body',
    fontSize: 18,
    fontWeight: 400,
    align: 'left',
  };
}
function mkMedia(id: string, assetId: string, alt: string): MediaElement {
  return {
    id,
    type: 'media',
    box: { x: 40, y: 240, w: 400, h: 300, z: 1 },
    mediaKind: 'image',
    assetId,
    alt,
    fit: 'cover',
  };
}
function mkSection(id: string, elements: CanvasSection['elements']): CanvasSection {
  return { id, recipeId: 'hero-split', name: 'Hero', height: 600, elements };
}
function mkPage(id: string, slug: string, title: string, sections: CanvasSection[]): CanvasPage {
  return { id, slug, title, description: 'Authentic pizza, fresh daily.', width: 1440, sections };
}

function pizzaSite(): EditableSite {
  return {
    styleKit: 'orange-editorial',
    pages: [
      mkPage('p-home', 'home', 'Pizza Palace', [
        mkSection('sec', [
          mkHeading('headline', 'Pizza Palace'),
          mkBody('tagline', 'Best slices in town'),
          mkMedia('hero-img', 'seed-asset-1', 'A cheesy pepperoni pizza'),
        ]),
      ]),
    ],
  };
}

// ---------------------------------------------------------------------------
// The planned rebrand (what the LLM planner would emit; hand-authored here).
// ---------------------------------------------------------------------------

const PROPOSALS: RebrandProposal[] = [
  {
    id: 'r1',
    group: 'rename',
    op: { kind: 'renameToken', from: 'Pizza Palace', to: 'Bella Cucina' },
    rationale: 'Swap the brand name everywhere from the casual pizzeria to the fine-dining name.',
  },
  {
    id: 'r2',
    group: 'text',
    op: { kind: 'rewriteText', elementId: 'tagline', content: [{ text: 'Refined Italian dining' }] },
    rationale: 'The tagline should signal an upscale restaurant, not a slice shop.',
  },
  {
    id: 'r3',
    group: 'style',
    op: { kind: 'setStyleKit', styleKit: 'ivory-press' },
    rationale: 'A refined, editorial kit fits fine dining better than the punchy orange casual kit.',
  },
  {
    id: 'r4',
    group: 'media',
    op: {
      kind: 'replaceMedia',
      elementId: 'hero-img',
      mediaKind: 'image',
      assetId: 'seed-asset-2',
      alt: 'An elegantly plated pasta dish',
    },
    rationale: 'Replace the pizza hero with an upscale plated dish.',
  },
];

function plan(): RebrandPlan {
  return {
    brief: 'Make this fine dining instead of a pizza joint',
    model: 'gemini-3.5-flash',
    summary: 'Rename to Bella Cucina, refine the tagline, switch to an editorial kit, and swap the hero image.',
    proposals: PROPOSALS,
  };
}

// ---------------------------------------------------------------------------

function test1Describe(): void {
  const state = pizzaSite();
  const d1 = describeOp(state, PROPOSALS[0]!.op);
  assert(d1.before.includes('Pizza Palace') && /\d+ place/.test(d1.before), '1.1 rename describes occurrences', JSON.stringify(d1));
  assert(d1.after.includes('Bella Cucina'), '1.2 rename after = new name', d1.after);

  const d2 = describeOp(state, PROPOSALS[1]!.op);
  assert(d2.before === 'Best slices in town', '1.3 rewrite before = current tagline', d2.before);
  assert(d2.after === 'Refined Italian dining', '1.4 rewrite after = new text', d2.after);

  const d3 = describeOp(state, PROPOSALS[2]!.op);
  assert(d3.before === 'orange-editorial' && d3.after === 'ivory-press', '1.5 kit swap before/after', JSON.stringify(d3));

  const d4 = describeOp(state, PROPOSALS[3]!.op);
  assert(d4.before.includes('seed-asset-1') && d4.after.includes('seed-asset-2'), '1.6 media swap before/after', JSON.stringify(d4));
}

function test2Assess(): void {
  const state = pizzaSite();
  assert(validateEditableSite(structuredClone(state)).valid, '2.0 fixture validates');

  const assessments = assessProposals(state, PROPOSALS);
  assert(assessments.length === 4 && assessments.every((a) => a.applicable), '2.1 all four proposals are applicable', JSON.stringify(assessments));

  // A rewrite targeting a non-existent element must be flagged non-applicable.
  const broken: RebrandProposal = {
    id: 'bad',
    group: 'text',
    op: { kind: 'rewriteText', elementId: 'does-not-exist', content: [{ text: 'x' }] },
    rationale: 'targets a ghost element',
  };
  const bad = assessProposals(state, [broken])[0]!;
  assert(!bad.applicable && typeof bad.error === 'string' && bad.error.length > 0, '2.2 op on missing element is non-applicable with reason', JSON.stringify(bad));
}

function test3ApplyAll(): void {
  const state = pizzaSite();
  const snapshot = JSON.stringify(state);
  const preview = applyRebrandSubset(state, plan());
  assert(preview.ok, '3.1 full rebrand applies + validates', preview.errors.join('; '));
  assert(JSON.stringify(state) === snapshot, '3.2 input state is NOT mutated (preview-only)');

  const next = preview.previewState!;
  const serialized = JSON.stringify(next);
  assert(!serialized.includes('Pizza Palace'), '3.3 brand name is gone from the preview');
  assert(serialized.includes('Bella Cucina'), '3.4 new brand name is present');
  assert(next.styleKit === 'ivory-press', '3.5 style kit switched', next.styleKit);
  assert(serialized.includes('Refined Italian dining'), '3.6 tagline rewritten');
  assert(serialized.includes('seed-asset-2'), '3.7 hero image replaced');
  assert(preview.applied.every((a) => a.applied), '3.8 every accepted op landed');
}

function test4Subset(): void {
  const state = pizzaSite();
  // Owner rejects the style swap (r3) and the image (r4); keeps rename + tagline.
  const preview = applyRebrandSubset(state, plan(), ['r1', 'r2']);
  assert(preview.ok, '4.1 subset applies + validates', preview.errors.join('; '));
  const next = preview.previewState!;
  assert(next.styleKit === 'orange-editorial', '4.2 rejected style swap did NOT apply', next.styleKit);
  assert(JSON.stringify(next).includes('seed-asset-1'), '4.3 rejected image swap did NOT apply');
  assert(JSON.stringify(next).includes('Bella Cucina'), '4.4 accepted rename DID apply');
  assert(preview.applied.length === 2, '4.5 only the two accepted ops were folded', String(preview.applied.length));
}

function test5BrokenSubset(): void {
  const state = pizzaSite();
  const broken: RebrandProposal = {
    id: 'bad',
    group: 'media',
    op: { kind: 'replaceMedia', elementId: 'ghost', mediaKind: 'image', assetId: 'x', alt: 'y' },
    rationale: 'targets a ghost element',
  };
  const p: RebrandPlan = { ...plan(), proposals: [PROPOSALS[0]!, broken] };
  const preview = applyRebrandSubset(state, p);
  assert(!preview.ok, '5.1 a subset with a broken op fails loud (ok:false)');
  assert(
    preview.applied.some((a) => a.id === 'bad' && !a.applied && typeof a.error === 'string'),
    '5.2 the broken op is reported as not-applied with an error',
    JSON.stringify(preview.applied),
  );
  assert(preview.errors.length > 0, '5.3 errors are surfaced, not swallowed');
}

function test6AcceptedOps(): void {
  const ops = acceptedOps(plan(), ['r2', 'r4']);
  assert(ops.length === 2, '6.1 acceptedOps returns the chosen count', String(ops.length));
  assert(ops[0]!.kind === 'rewriteText' && ops[1]!.kind === 'replaceMedia', '6.2 ops returned in plan order', ops.map((o) => o.kind).join(','));
}

function main(): void {
  test1Describe();
  test2Assess();
  test3ApplyAll();
  test4Subset();
  test5BrokenSubset();
  test6AcceptedOps();
  process.stdout.write(`[rebrand-plan:smoke] ${String(passed)} assertions passed\n`);
}

main();
