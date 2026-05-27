// src/a11y/smoke.ts
//
// `bun run a11y:smoke` — Wave 3 #15. Exercises the audit runner against
// hand-built CanvasSiteState fixtures plus the canonical `home.json` fixture
// that the canvas smoke also consumes. Pure functions only — no Worker, no DB.
//
// Assertion coverage maps 1:1 to the plan brief §"Smoke":
//   1. Missing alt on a MediaElement → 1 blocking, kind='missing-alt'.
//   2. TextElement on a low-contrast surface (~2.5:1) → 1 blocking, kind='contrast'.
//   3. The shipping home.json fixture → empty issues, blockerCount=0.
//   4. H1 → H3 jump on a single page → 1 warning, kind='heading-skip'.
//   5. Page with empty title → 1 blocking, kind='missing-page-title'.
//   6. Form with empty field label → 1 blocking, kind='missing-form-field-label'.
//
// Plus a few belt-and-braces unit checks: severity ranking, deriveHeadingLevel
// boundaries, and computed-background precedence (container wins over kit bg).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAudit } from './audit.js';
import { compareSeverity } from './severity.js';
import { deriveHeadingLevel } from './checks/heading-order.js';
import { resolveComputedBackground } from './checks/contrast.js';
import { getStyleKitPreset } from '../canvas/style-kits.js';
import { validateCanvasSiteState } from '../canvas/validate.js';
import type {
  CanvasElement,
  CanvasSiteState,
  ContainerElement,
  MediaElement,
  StyleKit,
  StyleKitPreset,
  TextElement,
} from '../canvas/schema.js';
import type { FormElement } from '../canvas/elements/form.js';

// ---------------------------------------------------------------------------
// Assertion harness — mirrors forms:smoke style.
// ---------------------------------------------------------------------------

function ok(label: string): void {
  process.stdout.write(`[a11y:smoke] OK   ${label}\n`);
}

function fail(label: string, detail?: string): never {
  process.stderr.write(`[a11y:smoke] FAIL ${label}\n`);
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
// Fixture builders — keep each test fully self-contained so a failure points
// at exactly one fixture.
// ---------------------------------------------------------------------------

function mkHeading(
  id: string,
  text: string,
  fontSize: number,
  box: { x: number; y: number; w: number; h: number; z: number },
): TextElement {
  return {
    id,
    type: 'text',
    box,
    content: [{ text }],
    role: 'heading',
    fontSize,
    fontWeight: 700,
    align: 'left',
  };
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

function mkContainer(
  id: string,
  variant: ContainerElement['variant'],
  box: { x: number; y: number; w: number; h: number; z: number },
): ContainerElement {
  return { id, type: 'container', box, variant };
}

function mkSiteState(
  styleKit: StyleKit,
  pages: CanvasSiteState['pages'],
): CanvasSiteState {
  return { styleKit, symbols: [], pages };
}

// ---------------------------------------------------------------------------
// Test 1 — Missing alt on MediaElement → 1 blocking issue.
// ---------------------------------------------------------------------------

function test1MissingAlt(): void {
  const state = mkSiteState('charcoal', [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      description: 'A test page.',
      width: 1440,
      sections: [
        {
          id: 'sec',
          recipeId: 'hero-split',
          name: 'Hero',
          height: 400,
          elements: [
            // High-contrast heading (charcoal text #f6f6f6 on #0c0c0d ≈ 18:1)
            // to avoid contrast issues clouding the assertion.
            mkHeading('h1', 'Welcome', 56, { x: 40, y: 40, w: 500, h: 80, z: 2 }),
            mkMedia('hero-img', ''),
          ],
        },
      ],
    },
  ]);

  const report = runAudit(state);
  const altIssues = report.issues.filter((i) => i.kind === 'missing-alt');
  assert(altIssues.length === 1, '1.1 exactly one missing-alt issue emitted', JSON.stringify(report.issues));
  const issue = altIssues[0]!;
  assert(issue.severity === 'blocking', '1.2 missing-alt is blocking', issue.severity);
  assert(issue.elementId === 'hero-img', '1.3 elementId points at the offending media', issue.elementId);
  assert(issue.pageSlug === 'home', '1.4 pageSlug carries the page slug', issue.pageSlug);
  assert(
    report.blockerCount >= 1,
    '1.5 blockerCount includes the missing-alt issue',
    String(report.blockerCount),
  );
}

// ---------------------------------------------------------------------------
// Test 2 — Contrast ~2.5:1 → 1 blocking issue, kind='contrast'.
//
// Strategy: pick a built-in kit whose text colour is light (charcoal text
// #f6f6f6) and overlay a TextElement on a wrapping ContainerElement whose
// surface variant resolves to a light background — `glass` on `charcoal`
// resolves to `rgba(255,255,255,0.06)` which is rejected as translucent, so
// instead we craft a one-off CanvasSiteState that uses a kit where a
// container's resolved background is parseable AND yields a low ratio. The
// charcoal `flat` variant gives #16171a — still very dark; light text on dark
// is high contrast.
//
// Better: directly synthesise a CUSTOM style kit (Wave 2 #10's `'custom'`
// selector) whose `text` is near-white AND whose top-level `bg` is also light,
// driving the per-page audit through `resolveComputedBackground` → kit-bg
// path with a near-zero contrast.
// ---------------------------------------------------------------------------

function test2LowContrast(): void {
  // Custom kit: text = #cccccc on bg = #dddddd → ratio ≈ 1.3. Easy assertion.
  // Use the real charcoal preset as a base + override only the two fields the
  // audit inspects. resolveStyleKitWithCustom does NOT merge — `'custom'`
  // returns the customStyleKit verbatim — so we must provide a full preset.
  const baseCharcoal = getStyleKitPreset('charcoal');
  const lowContrastKit: StyleKitPreset = {
    ...baseCharcoal,
    bg: '#dddddd',
    text: '#cccccc',
  };

  const state: CanvasSiteState = {
    styleKit: 'custom',
    customStyleKit: lowContrastKit,
    symbols: [],
    pages: [
      {
        id: 'page-home',
        slug: 'home',
        title: 'Home',
        description: 'Low contrast test page.',
        width: 1440,
        sections: [
          {
            id: 'sec',
            recipeId: 'hero-split',
            name: 'Hero',
            height: 400,
            elements: [
              // Headings only — and zero MediaElements, zero ActionElements —
              // so the only issues we expect are contrast issues, one per text.
              mkHeading('h1', 'Hello', 56, { x: 40, y: 40, w: 600, h: 100, z: 2 }),
            ],
          },
        ],
      },
    ],
  };

  const report = runAudit(state);
  const contrastIssues = report.issues.filter((i) => i.kind === 'contrast');
  assert(
    contrastIssues.length === 1,
    '2.1 exactly one contrast issue on the single text element',
    JSON.stringify(report.issues),
  );
  const issue = contrastIssues[0]!;
  assert(issue.severity === 'blocking', '2.2 contrast issue is blocking (<3.0)', issue.severity);
  assert(issue.elementId === 'h1', '2.3 contrast issue points at the text element');
  assert(
    report.blockerCount >= 1,
    '2.4 blockerCount includes the contrast issue',
    String(report.blockerCount),
  );
}

// ---------------------------------------------------------------------------
// Test 3 — Clean fixture (home.json) → empty issues, blockerCount=0.
// ---------------------------------------------------------------------------

async function loadHomeFixture(): Promise<CanvasSiteState> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(here, '..', 'canvas', 'fixtures', 'home.json');
  const raw = await fs.readFile(fixturePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const validation = validateCanvasSiteState(parsed);
  if (!validation.valid) {
    throw new Error(`home.json fixture failed validation: ${JSON.stringify(validation.errors)}`);
  }
  // REVIEW: `as CanvasSiteState` is a trust cast — the validator doesn't return the narrowed value. If `validateCanvasSiteState` returned `{ valid: true; data: CanvasSiteState }`, the cast would be unnecessary and every call site would get type safety for free.
  return parsed as CanvasSiteState;
}

async function test3CleanFixture(): Promise<void> {
  const state = await loadHomeFixture();
  // home.json is the canonical "happy path" — every TextElement reads on
  // charcoal's dark bg, every MediaElement carries an alt, every page has a
  // title, no form elements. The audit MUST emit zero blocking + zero
  // warning issues. Info issues are tolerated because home.json's pages may
  // be missing `description` (forward-compat info), which is intentionally
  // allowed pre-#21.
  const report = runAudit(state);
  assert(
    report.blockerCount === 0,
    '3.1 clean home.json fixture: blockerCount == 0',
    JSON.stringify(report.issues),
  );
  assert(
    report.warningCount === 0,
    '3.2 clean home.json fixture: warningCount == 0',
    JSON.stringify(report.issues.filter((i) => i.severity === 'warning')),
  );
  // Issues array still mirrors the counters — every issue carries a severity.
  for (const issue of report.issues) {
    assert(
      issue.severity === 'info',
      `3.3 home.json fixture: only info-severity issues remain (saw ${issue.severity})`,
      JSON.stringify(issue),
    );
  }
}

// ---------------------------------------------------------------------------
// Test 4 — H1 → H3 on a single page → 1 warning, kind='heading-skip'.
//
// We use charcoal's headingScale = 1.0, so the raw rungs apply:
//   >=48 = H1, >=36 = H2, >=28 = H3.
// fontSize 56 → H1; fontSize 30 → H3 → forward skip of +2.
// ---------------------------------------------------------------------------

function test4HeadingSkip(): void {
  const state = mkSiteState('charcoal', [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      description: 'A test page.',
      width: 1440,
      sections: [
        {
          id: 'sec',
          recipeId: 'hero-split',
          name: 'Hero',
          height: 600,
          elements: [
            mkHeading('h1', 'Big', 56, { x: 40, y: 40, w: 600, h: 100, z: 2 }), // H1
            mkHeading('h3', 'Medium', 30, { x: 40, y: 200, w: 600, h: 80, z: 2 }), // H3 (skips H2)
          ],
        },
      ],
    },
  ]);

  const report = runAudit(state);
  const skipIssues = report.issues.filter((i) => i.kind === 'heading-skip');
  assert(
    skipIssues.length === 1,
    '4.1 exactly one heading-skip issue emitted',
    JSON.stringify(report.issues),
  );
  const issue = skipIssues[0]!;
  assert(issue.severity === 'warning', '4.2 heading-skip is warning', issue.severity);
  assert(issue.elementId === 'h3', '4.3 elementId points at the H3 that skipped over H2');
  assert(
    issue.message.includes('H1') && issue.message.includes('H3'),
    '4.4 message names both H-levels',
    issue.message,
  );
}

// ---------------------------------------------------------------------------
// Test 5 — Page with empty title → 1 blocking, kind='missing-page-title'.
// ---------------------------------------------------------------------------

function test5EmptyTitle(): void {
  const state = mkSiteState('charcoal', [
    {
      id: 'page-home',
      slug: 'home',
      title: '   ', // whitespace-only ⇒ same as empty for the check
      description: 'Has description but no title.',
      width: 1440,
      sections: [
        {
          id: 'sec',
          recipeId: 'hero-split',
          name: 'Hero',
          height: 200,
          elements: [
            mkHeading('h1', 'Hi', 56, { x: 40, y: 40, w: 400, h: 80, z: 2 }),
          ],
        },
      ],
    },
  ]);

  const report = runAudit(state);
  const titleIssues = report.issues.filter((i) => i.kind === 'missing-page-title');
  assert(
    titleIssues.length === 1,
    '5.1 exactly one missing-page-title issue emitted',
    JSON.stringify(report.issues),
  );
  const issue = titleIssues[0]!;
  assert(issue.severity === 'blocking', '5.2 missing-page-title is blocking', issue.severity);
  assert(issue.pageSlug === 'home', '5.3 pageSlug set');
  assert(
    report.blockerCount >= 1,
    '5.4 blockerCount includes the title issue',
    String(report.blockerCount),
  );
}

// ---------------------------------------------------------------------------
// Test 6 — Form with empty field label → 1 blocking, kind='missing-form-field-label'.
// ---------------------------------------------------------------------------

function test6FormFieldLabel(): void {
  const form: FormElement = {
    id: 'contact',
    type: 'form',
    box: { x: 40, y: 40, w: 600, h: 400, z: 1 },
    fields: [
      // One labelled, one un-labelled — only the un-labelled emits.
      { id: 'name', label: 'Name', kind: 'text', required: true },
      { id: 'email', label: '', kind: 'email', required: true },
    ],
    submitLabel: 'Send',
    successMessage: 'Thanks',
  };

  const state = mkSiteState('charcoal', [
    {
      id: 'page-contact',
      slug: 'contact',
      title: 'Contact',
      description: 'A test page.',
      width: 1440,
      sections: [
        {
          id: 'sec',
          recipeId: 'hero-split',
          name: 'Form',
          height: 600,
          elements: [
            mkHeading('h1', 'Contact us', 56, { x: 40, y: 40, w: 500, h: 80, z: 2 }),
            form,
          ],
        },
      ],
    },
  ]);

  const report = runAudit(state);
  const fieldIssues = report.issues.filter((i) => i.kind === 'missing-form-field-label');
  assert(
    fieldIssues.length === 1,
    '6.1 exactly one missing-form-field-label issue emitted',
    JSON.stringify(report.issues),
  );
  const issue = fieldIssues[0]!;
  assert(issue.severity === 'blocking', '6.2 missing-form-field-label is blocking');
  assert(
    issue.elementId === 'contact',
    '6.3 elementId points at the form element (the field id is in the message)',
    issue.elementId,
  );
  assert(
    issue.message.includes('email'),
    '6.4 message names the offending field by id',
    issue.message,
  );
}

// ---------------------------------------------------------------------------
// Unit checks — small, focused.
// ---------------------------------------------------------------------------

function unitSeverity(): void {
  assert(compareSeverity('blocking', 'warning') > 0, 'U.1 blocking > warning');
  assert(compareSeverity('warning', 'info') > 0, 'U.2 warning > info');
  assert(compareSeverity('info', 'info') === 0, 'U.3 info == info');
}

function unitHeadingLevels(): void {
  // headingScale = 1.0 → raw rungs.
  assert(deriveHeadingLevel(56, 1.0) === 1, 'U.4 fontSize 56 → H1');
  assert(deriveHeadingLevel(48, 1.0) === 1, 'U.5 fontSize 48 (edge) → H1');
  assert(deriveHeadingLevel(36, 1.0) === 2, 'U.6 fontSize 36 (edge) → H2');
  assert(deriveHeadingLevel(28, 1.0) === 3, 'U.7 fontSize 28 (edge) → H3');
  assert(deriveHeadingLevel(14, 1.0) === 6, 'U.8 tiny font → H6');
  // orange-editorial scale = 1.15: H1 threshold = 48 * 1.15 = 55.2.
  assert(
    deriveHeadingLevel(54, 1.15) === 2,
    'U.9 fontSize 54 under scale 1.15 → H2 (below H1 threshold of 55.2)',
  );
  assert(
    deriveHeadingLevel(56, 1.15) === 1,
    'U.10 fontSize 56 under scale 1.15 → H1 (above 55.2)',
  );
}

function unitComputedBackground(): void {
  const kit = getStyleKitPreset('orange-editorial');
  // orange-editorial's `raised` surface resolves to a clean white background.
  const container = mkContainer('panel', 'raised', { x: 0, y: 0, w: 800, h: 600, z: 1 });
  const text = mkHeading('h1', 'Hi', 56, { x: 40, y: 40, w: 400, h: 80, z: 2 });
  const elements: CanvasElement[] = [container, text];
  const bg = resolveComputedBackground(text, elements, kit);
  assert(
    bg.source === 'container' && bg.containerId === 'panel',
    'U.11 computed-background prefers wrapping container over kit bg',
    JSON.stringify(bg),
  );
  // Text positioned outside the container falls back to kit bg.
  const orphanText = mkHeading('h-orphan', 'Hi', 56, { x: 900, y: 0, w: 400, h: 80, z: 2 });
  const orphanBg = resolveComputedBackground(orphanText, [container, orphanText], kit);
  assert(
    orphanBg.source === 'kit-bg',
    'U.12 text outside any container falls back to kit bg',
    JSON.stringify(orphanBg),
  );
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  unitSeverity();
  unitHeadingLevels();
  unitComputedBackground();
  test1MissingAlt();
  test2LowContrast();
  await test3CleanFixture();
  test4HeadingSkip();
  test5EmptyTitle();
  test6FormFieldLabel();
  process.stdout.write('[a11y:smoke] all assertions passed\n');
}

await main();
