// src/a11y/remediation.smoke.ts
//
// `bun run a11y-remediation:smoke` — exercises the a11y remediation engine
// (`src/a11y/remediation.ts`) against hand-built EditableSite fixtures plus the
// canonical clean `home.json`. Pure functions only — no Worker, no DB, no LLM.
//
// The load-bearing property under test is SELF-VERIFICATION: every item the
// engine returns in `remediations` must, when its op is applied, both validate
// and remove the exact issue on re-audit. The tests apply each fix and re-run
// `runAudit` to confirm the audit that raised the complaint now agrees.
//
// Reachability note: `validateEditableSite` coerces an empty action label to
// `[{text:'Button'}]` in place, so `missing-action-label` cannot survive on a
// persisted site — the engine classifies it `manual`, and these fixtures call
// validation on a CLONE so the coercion never hides an issue we are testing.
//
// Reachability is the whole point of which issues get an auto-fix:
//   - heading-skip is reachable on a saved site (font sizes aren't constrained
//     into a hierarchy) AND mechanically fixable → the one `computed` auto-fix.
//   - missing-page-title (validator REJECTS empty titles) and
//     missing-action-label (validator COERCES empty labels to "Button") can't
//     survive validation, so they're `manual` with that reason.
//   - alt / contrast / description need human judgement → `manual`.
//
// Coverage:
//   1. heading-skip → a `computed` fix; applying it clears the skip on re-audit.
//   2. validator-prevented + judgement issues → all classified `manual`.
//   3. batch: two heading-skips → applyRemediationOps folds both ops, validates
//      once, and the re-audit has strictly fewer issues.
//   4. clean home.json → zero remediations.
//   5. purity: computeRemediations does not mutate its input.

import { runAudit } from './audit.js';
import { computeRemediations, applyRemediationOps } from './remediation.js';
import { validateEditableSite } from '../canvas/validate.js';
import { getStyleKitPreset } from '../canvas/style-kits.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ActionElement,
  BuiltInStyleKit,
  CanvasPage,
  CanvasSection,
  EditableSite,
  MediaElement,
  StyleKitPreset,
  TextElement,
} from '../canvas/schema.js';

// ---------------------------------------------------------------------------
// Assertion harness — mirrors a11y/smoke.ts.
// ---------------------------------------------------------------------------

let passed = 0;

function ok(label: string): void {
  passed += 1;
  process.stdout.write(`[a11y-remediation:smoke] OK   ${label}\n`);
}

function fail(label: string, detail?: string): never {
  process.stderr.write(`[a11y-remediation:smoke] FAIL ${label}\n`);
  if (detail) process.stderr.write(`  ${detail}\n`);
  process.exit(1);
}

function assert(condition: unknown, label: string, detail?: string): asserts condition {
  if (condition) {
    ok(label);
    return;
  }
  fail(label, detail);
}

// ---------------------------------------------------------------------------
// Fixture builders — mirror a11y/smoke.ts so a failure points at one fixture.
// ---------------------------------------------------------------------------

function mkHeading(
  id: string,
  text: string,
  fontSize: number,
  box: { x: number; y: number; w: number; h: number; z: number },
): TextElement {
  return { id, type: 'text', box, content: [{ text }], role: 'heading', fontSize, fontWeight: 700, align: 'left' };
}

function mkMedia(id: string, alt: string): MediaElement {
  return {
    id,
    type: 'media',
    box: { x: 0, y: 0, w: 100, h: 100, z: 1 },
    mediaKind: 'image',
    assetId: 'seed-asset-1',
    alt,
    fit: 'cover',
  };
}

function mkAction(id: string, labelText: string): ActionElement {
  return {
    id,
    type: 'action',
    box: { x: 0, y: 300, w: 160, h: 48, z: 1 },
    label: [{ text: labelText }],
    variant: 'solid',
    href: { type: 'external', url: 'https://example.com' },
  };
}

function mkSection(id: string, elements: CanvasSection['elements']): CanvasSection {
  return { id, recipeId: 'hero-split', name: 'Section', height: 480, elements };
}

function mkPage(id: string, slug: string, title: string, sections: CanvasSection[]): CanvasPage {
  return { id, slug, title, description: 'Fixture page.', width: 1440, sections };
}

function mkSite(styleKit: BuiltInStyleKit, pages: CanvasPage[]): EditableSite {
  return { styleKit, pages };
}

/**
 * Validate a *clone* — `validateEditableSite` mutates in place (it coerces
 * empty action labels), so validating the real fixture would silently change
 * the very state under test.
 */
function assertValidClone(state: EditableSite, label: string): void {
  const v = validateEditableSite(structuredClone(state));
  assert(v.valid, label, v.valid ? '' : v.errors.join('; '));
}

// ---------------------------------------------------------------------------
// Test 1 — heading-skip → computed fix that clears on re-audit.
// ---------------------------------------------------------------------------

function test1HeadingSkipComputed(): void {
  // charcoal = high-contrast dark kit (light text on near-black) so the only
  // finding is the heading hierarchy: H1 (64px) followed by a much smaller
  // heading (24px) reads as a forward skip.
  const site = mkSite('charcoal', [
    mkPage('p-home', 'home', 'Home', [
      mkSection('sec', [
        mkHeading('h-1', 'Welcome', 64, { x: 40, y: 40, w: 700, h: 90, z: 2 }),
        mkHeading('h-2', 'Details', 24, { x: 40, y: 160, w: 700, h: 40, z: 2 }),
      ]),
    ]),
  ]);
  assertValidClone(site, '1.0 fixture validates');

  const baseline = runAudit(site);
  const skips = baseline.issues.filter((i) => i.kind === 'heading-skip');
  assert(skips.length === 1, '1.1 baseline has exactly one heading-skip', JSON.stringify(baseline.issues));

  const plan = computeRemediations(site, baseline);
  const fix = plan.remediations.find((r) => r.kind === 'heading-skip');
  assert(fix !== undefined, '1.2 engine offers a heading-skip remediation', JSON.stringify(plan));
  assert(fix.confidence === 'computed', '1.3 heading-skip fix is computed (not a guess)', fix.confidence);
  assert(fix.elementId === 'h-2', '1.4 fix targets the offending heading', fix.elementId);
  assert(fix.op.kind === 'updateElement', '1.5 fix is an updateElement op', fix.op.kind);

  const { state: fixed, validation } = applyRemediationOps(site, [fix]);
  assert(validation.valid, '1.6 fixed site validates', validation.valid ? '' : validation.errors.join('; '));
  const after = runAudit(fixed);
  assert(
    after.issues.every((i) => i.kind !== 'heading-skip'),
    '1.7 re-audit: heading-skip is gone',
    JSON.stringify(after.issues),
  );
}

// ---------------------------------------------------------------------------
// Test 2 — validator-prevented + judgement issues are all MANUAL.
// ---------------------------------------------------------------------------

function test2ManualClassification(): void {
  // Custom kit forcing low contrast (text #cccccc on bg #dddddd) + empty alt +
  // empty action label + empty page title. The audit is captured BEFORE any
  // validation so the action-label coercion / title rejection can't hide them.
  // Every one of these must land in `manual`, none in `remediations`.
  const lowContrastKit: StyleKitPreset = {
    ...getStyleKitPreset('charcoal'),
    bg: '#dddddd',
    text: '#cccccc',
  };
  const site: EditableSite = {
    styleKit: 'custom',
    customStyleKit: lowContrastKit,
    pages: [
      mkPage('p-home', 'home', '', [
        mkSection('sec', [
          mkHeading('h-1', 'Welcome', 56, { x: 40, y: 40, w: 700, h: 90, z: 2 }),
          mkMedia('img-1', ''),
          mkAction('btn-1', ''),
        ]),
      ]),
    ],
  };

  const baseline = runAudit(site);
  const manualKinds = ['contrast', 'missing-alt', 'missing-action-label', 'missing-page-title'] as const;
  for (const kind of manualKinds) {
    assert(
      baseline.issues.some((i) => i.kind === kind),
      `2.1 baseline flags ${kind}`,
      JSON.stringify(baseline.issues.map((i) => i.kind)),
    );
  }

  const plan = computeRemediations(site, baseline);
  assert(plan.remediations.length === 0, '2.2 no auto-fix offered for these', JSON.stringify(plan.remediations.map((r) => r.kind)));
  for (const kind of manualKinds) {
    const item = plan.manual.find((m) => m.kind === kind);
    assert(item !== undefined, `2.3 ${kind} is classified manual`, JSON.stringify(plan.manual.map((m) => m.kind)));
    assert(
      typeof item.reason === 'string' && item.reason.length > 0,
      `2.4 ${kind} manual item carries a reason`,
      item.reason,
    );
  }
}

// ---------------------------------------------------------------------------
// Test 3 — batch: two heading-skips fold cleanly and the re-audit improves.
// ---------------------------------------------------------------------------

function test3BatchApply(): void {
  // Two pages, each with an H1 → tiny-heading skip → two independent computed
  // fixes. Batched application must validate and net-reduce the issue count.
  const site = mkSite('charcoal', [
    mkPage('p-home', 'home', 'Home', [
      mkSection('s1', [
        mkHeading('a-1', 'Welcome', 64, { x: 40, y: 40, w: 700, h: 90, z: 2 }),
        mkHeading('a-2', 'Details', 24, { x: 40, y: 160, w: 700, h: 40, z: 2 }),
      ]),
    ]),
    mkPage('p-about', 'about', 'About', [
      mkSection('s2', [
        mkHeading('b-1', 'Team', 64, { x: 40, y: 40, w: 700, h: 90, z: 2 }),
        mkHeading('b-2', 'Bios', 22, { x: 40, y: 160, w: 700, h: 40, z: 2 }),
      ]),
    ]),
  ]);
  assertValidClone(site, '3.0 fixture validates');

  const baseline = runAudit(site);
  const plan = computeRemediations(site, baseline);
  assert(
    plan.remediations.filter((r) => r.kind === 'heading-skip').length >= 2,
    '3.1 engine batched two computed heading-skip fixes',
    JSON.stringify(plan.remediations.map((r) => r.kind)),
  );

  const { state: fixed, validation, verified } = applyRemediationOps(site, plan.remediations);
  assert(validation.valid, '3.2 batched apply validates', validation.valid ? '' : validation.errors.join('; '));
  assert(verified, '3.3 batch self-verifies (no new issue introduced)');

  const after = runAudit(fixed);
  assert(
    after.issues.length < baseline.issues.length,
    '3.4 re-audit has strictly fewer issues after batch',
    `${String(baseline.issues.length)} -> ${String(after.issues.length)}`,
  );
}

// ---------------------------------------------------------------------------
// Test 6 — soundness: a fix that would TRADE one skip for another is rejected.
// H1(64) → H4(24) → H5(20): the only baseline skip is H1→H4 on the middle
// heading. Demoting it to H2 would make the third heading an H2→H5 skip — same
// issue count, different element. A count-only check would bless it; the
// engine must reject it (no auto-fix) and classify it manual instead.
// ---------------------------------------------------------------------------

function test6SoundnessRejectsTrade(): void {
  const site = mkSite('charcoal', [
    mkPage('p-home', 'home', 'Home', [
      mkSection('sec', [
        mkHeading('h-1', 'Big', 64, { x: 40, y: 40, w: 700, h: 90, z: 3 }),
        mkHeading('h-2', 'Mid', 24, { x: 40, y: 150, w: 700, h: 40, z: 2 }),
        mkHeading('h-3', 'Small', 20, { x: 40, y: 210, w: 700, h: 36, z: 1 }),
      ]),
    ]),
  ]);
  const baseline = runAudit(site);
  assert(
    baseline.issues.filter((i) => i.kind === 'heading-skip').length === 1,
    '6.1 baseline has exactly one heading-skip (H1→H4)',
    JSON.stringify(baseline.issues.map((i) => `${i.kind}:${i.elementId ?? ''}`)),
  );

  const plan = computeRemediations(site, baseline);
  assert(
    plan.remediations.every((r) => r.kind !== 'heading-skip'),
    '6.2 the trade-one-skip-for-another fix is NOT offered',
    JSON.stringify(plan.remediations.map((r) => r.kind)),
  );
  const manual = plan.manual.find((m) => m.kind === 'heading-skip');
  assert(manual !== undefined, '6.3 it is classified manual instead', JSON.stringify(plan.manual.map((m) => m.kind)));
  assert(/new issue/i.test(manual.reason), '6.4 the manual reason names the introduced issue', manual.reason);
}

// ---------------------------------------------------------------------------
// Test 7 — fractional headingScale: the computed font size must still derive to
// the target level (guards the ceil-not-round choice). A skip on a kit with a
// non-integer headingScale must still produce a verified fix.
// ---------------------------------------------------------------------------

function test7FractionalScale(): void {
  const kit: StyleKitPreset = { ...getStyleKitPreset('charcoal'), headingScale: 1.1 };
  const site: EditableSite = {
    styleKit: 'custom',
    customStyleKit: kit,
    pages: [
      mkPage('p-home', 'home', 'Home', [
        mkSection('sec', [
          mkHeading('h-1', 'Welcome', 72, { x: 40, y: 40, w: 700, h: 90, z: 2 }),
          mkHeading('h-2', 'Details', 26, { x: 40, y: 160, w: 700, h: 40, z: 2 }),
        ]),
      ]),
    ],
  };
  const baseline = runAudit(site);
  assert(
    baseline.issues.some((i) => i.kind === 'heading-skip'),
    '7.1 fractional-scale fixture has a heading-skip',
    JSON.stringify(baseline.issues.map((i) => i.kind)),
  );
  const plan = computeRemediations(site, baseline);
  const fix = plan.remediations.find((r) => r.kind === 'heading-skip');
  assert(fix !== undefined, '7.2 a verified fix is offered despite the fractional scale', JSON.stringify(plan.manual));
  const { validation } = applyRemediationOps(site, [fix]);
  assert(validation.valid, '7.3 fractional-scale fix validates', validation.valid ? '' : validation.errors.join('; '));
}

// ---------------------------------------------------------------------------
// Test 5 — clean home.json → no remediations.
// ---------------------------------------------------------------------------

async function test4CleanFixture(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(here, '..', 'canvas', 'fixtures', 'home.json');
  const raw = await fs.readFile(fixturePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const validation = validateEditableSite(parsed);
  assert(validation.valid, '4.0 home.json validates', validation.valid ? '' : validation.errors.join('; '));
  const state = parsed as EditableSite;

  const plan = computeRemediations(state);
  // home.json is the happy path: zero blockers/warnings. Any info-only issue
  // (missing description) is `manual`, never an auto-fix — remediations empty.
  assert(plan.remediations.length === 0, '4.1 clean fixture yields zero remediations', JSON.stringify(plan.remediations));
}

// ---------------------------------------------------------------------------
// Test 6 — purity: computeRemediations does not mutate its input.
// ---------------------------------------------------------------------------

function test5Purity(): void {
  const site = mkSite('charcoal', [
    mkPage('p-home', 'home', '', [
      mkSection('sec', [
        mkHeading('h-1', 'Welcome', 64, { x: 40, y: 40, w: 700, h: 90, z: 2 }),
        mkHeading('h-2', 'Details', 24, { x: 40, y: 160, w: 700, h: 40, z: 2 }),
      ]),
    ]),
  ]);
  const snapshot = JSON.stringify(site);
  computeRemediations(site);
  assert(JSON.stringify(site) === snapshot, '5.1 input state is unchanged after computeRemediations');
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  test1HeadingSkipComputed();
  test2ManualClassification();
  test3BatchApply();
  await test4CleanFixture();
  test5Purity();
  test6SoundnessRejectsTrade();
  test7FractionalScale();
  process.stdout.write(`[a11y-remediation:smoke] ${String(passed)} assertions passed\n`);
}

void main();
