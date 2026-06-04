// src/canvas/section-accent-border.smoke.ts
//
// ADR 0062 — section accent border. Smoke covers the four mutually
// exclusive variants (solid / top / left / glow) across the three
// boundaries the field crosses: validate, render, and the Yjs encode/
// decode round-trip.
//
// Run with `bun run section-accent-border:smoke`.

import { renderCanvasSnapshot } from './render.js';
import type {
  AccentBorder,
  CanvasSection,
  EditableSite,
  PublishedSnapshot,
  TextElement,
} from './schema.js';
import { validateEditableSite } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ----------------------------------------------------------------------------
// Fixture builder — one minimal section per accent-border variant.
// ----------------------------------------------------------------------------

const baseText: TextElement = {
  id: 'el-text',
  type: 'text',
  box: { x: 0, y: 0, w: 400, h: 60, z: 1 },
  content: [{ text: 'Accent border' }],
  role: 'heading',
  fontSize: 32,
  fontWeight: 700,
  align: 'left',
};

function sectionWith(id: string, accent: AccentBorder | undefined): CanvasSection {
  const base: CanvasSection = {
    id,
    recipeId: 'hero-split',
    name: id,
    height: 400,
    elements: [{ ...baseText, id: `${id}-text` }],
  };
  if (accent !== undefined) base.accentBorder = accent;
  return base;
}

const solidSection = sectionWith('sec-solid', {
  type: 'solid',
  color: '#ff0000',
  width: 2,
});
const topSection = sectionWith('sec-top', {
  type: 'top',
  color: '#00aa00',
  thickness: 4,
});
const leftSection = sectionWith('sec-left', {
  type: 'left',
  color: '#0033ff',
  thickness: 6,
});
const glowSection = sectionWith('sec-glow', {
  type: 'glow',
  color: 'rgba(255,128,0,0.4)',
  radius: 48,
  spread: 8,
});
const plainSection = sectionWith('sec-plain', undefined);

const snapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-06-04T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-accent',
      slug: 'accent',
      title: 'Accent',
      width: 1440,
      sections: [solidSection, topSection, leftSection, glowSection, plainSection],
    },
  ],
};

// ----------------------------------------------------------------------------
// 1. Validation — every variant passes; the field is genuinely optional.
// ----------------------------------------------------------------------------

const baseValidation = validateEditableSite(snapshot);
assert(
  baseValidation.valid,
  `expected snapshot with all four accent variants to validate; got ${
    baseValidation.valid ? '' : baseValidation.errors.join(', ')
  }`,
);
console.log('section-accent-border.smoke.ts: all four variants validate');

// ----------------------------------------------------------------------------
// 2. Validation — wrong arm shape (extra/missing fields) fails loudly.
// ----------------------------------------------------------------------------

function expectInvalid(label: string, badAccent: Record<string, unknown>): void {
  const mutated = structuredClone(snapshot);
  // Bypass the discriminated-union narrowing on purpose — the smoke is
  // explicitly testing that the validator catches shapes the type system
  // would otherwise refuse to construct.
  (mutated.pages[0]!.sections[0] as unknown as Record<string, unknown>).accentBorder = badAccent;
  const result = validateEditableSite(mutated);
  assert(
    !result.valid,
    `expected ${label} to fail validation, but validator returned valid`,
  );
}

// Unknown discriminator.
expectInvalid('unknown accentBorder.type', { type: 'wiggle', color: '#fff', width: 1 });

// Solid arm without width.
expectInvalid('solid without width', { type: 'solid', color: '#fff' });

// Solid arm with non-positive width.
expectInvalid('solid with non-positive width', { type: 'solid', color: '#fff', width: 0 });

// Glow arm with negative spread.
expectInvalid('glow with negative spread', {
  type: 'glow',
  color: '#fff',
  radius: 10,
  spread: -1,
});

// Cross-arm field bleed: solid carrying thickness.
expectInvalid('solid carrying thickness', {
  type: 'solid',
  color: '#fff',
  width: 1,
  thickness: 2,
});

console.log('section-accent-border.smoke.ts: cross-arm + missing-field validation rejects');

// ----------------------------------------------------------------------------
// 3. Render — each variant emits the expected CSS shape, and "no accent"
//    emits no accent-border CSS at all.
// ----------------------------------------------------------------------------

const html = renderCanvasSnapshot(snapshot, '/assets', 'smoke-site', {
  turnstileSiteKey: 'turnstile-test-key',
});

function sectionBlock(sectionId: string): string {
  // Locate the actual <section> element (not the responsive-CSS selector at
  // the top of the rendered HTML which also embeds the section id).
  const tag = `<section class="opencanvas-section"`;
  const idAttr = `data-opencanvas-section="${sectionId}"`;
  let cursor = 0;
  for (;;) {
    const open = html.indexOf(tag, cursor);
    assert(open >= 0, `expected <section> element for ${sectionId} in rendered HTML`);
    const endOpen = html.indexOf('>', open);
    const candidate = html.slice(open, endOpen);
    if (candidate.includes(idAttr)) {
      const close = html.indexOf('</section>', endOpen);
      return html.slice(open, close);
    }
    cursor = endOpen + 1;
  }
}

const solidBlock = sectionBlock('sec-solid');
assert(
  solidBlock.includes('border:2px solid #ff0000'),
  `expected solid accent border CSS in sec-solid block, got: ${solidBlock.slice(0, 400)}`,
);
assert(
  solidBlock.includes('data-accent-border="solid"'),
  'expected data-accent-border="solid" attribute on sec-solid',
);

const topBlock = sectionBlock('sec-top');
assert(
  topBlock.includes('box-shadow:inset 0 4px 0 0 #00aa00'),
  `expected top accent stripe inset box-shadow in sec-top block, got: ${topBlock.slice(0, 400)}`,
);
assert(
  topBlock.includes('data-accent-border="top"'),
  'expected data-accent-border="top" attribute on sec-top',
);

const leftBlock = sectionBlock('sec-left');
assert(
  leftBlock.includes('box-shadow:inset 6px 0 0 0 #0033ff'),
  `expected left accent bar inset box-shadow in sec-left block, got: ${leftBlock.slice(0, 400)}`,
);
assert(
  leftBlock.includes('data-accent-border="left"'),
  'expected data-accent-border="left" attribute on sec-left',
);

const glowBlock = sectionBlock('sec-glow');
assert(
  // rgba() goes through escapeCssValue; commas are preserved.
  glowBlock.includes('box-shadow:0 0 48px 8px rgba(255,128,0,0.4)'),
  `expected glow box-shadow in sec-glow block, got: ${glowBlock.slice(0, 400)}`,
);
assert(
  glowBlock.includes('data-accent-border="glow"'),
  'expected data-accent-border="glow" attribute on sec-glow',
);
// Glow must NOT emit a hard `border:` declaration.
assert(
  !glowBlock.includes('border:'),
  'glow accent must not emit a hard border declaration',
);

const plainBlock = sectionBlock('sec-plain');
assert(
  !plainBlock.includes('data-accent-border'),
  'expected no data-accent-border attribute on a section without accentBorder',
);
assert(
  // The base section style still emits position/width/height — but no
  // box-shadow or accent-border-style border should appear.
  !plainBlock.includes('box-shadow:') && !plainBlock.includes('border:'),
  'expected no accent CSS on a section without accentBorder',
);
console.log('section-accent-border.smoke.ts: every variant renders the expected CSS');

// ----------------------------------------------------------------------------
// 4. Yjs round-trip — each variant survives encode/decode unchanged.
// ----------------------------------------------------------------------------

const state: EditableSite = {
  styleKit: snapshot.styleKit,
  pages: snapshot.pages,
};
const roundTripped = decodeYDoc(encodeYDoc(state));
const decodedSections = roundTripped.pages[0]?.sections ?? [];
function findSection(id: string): CanvasSection {
  const found = decodedSections.find((s) => s.id === id);
  if (!found) throw new Error(`round-trip lost section ${id}`);
  return found;
}

const rtSolid = findSection('sec-solid');
assert(
  rtSolid.accentBorder?.type === 'solid' &&
    rtSolid.accentBorder.color === '#ff0000' &&
    rtSolid.accentBorder.width === 2,
  `solid accent did not round-trip: ${JSON.stringify(rtSolid.accentBorder)}`,
);
const rtTop = findSection('sec-top');
assert(
  rtTop.accentBorder?.type === 'top' &&
    rtTop.accentBorder.color === '#00aa00' &&
    rtTop.accentBorder.thickness === 4,
  `top accent did not round-trip: ${JSON.stringify(rtTop.accentBorder)}`,
);
const rtLeft = findSection('sec-left');
assert(
  rtLeft.accentBorder?.type === 'left' &&
    rtLeft.accentBorder.color === '#0033ff' &&
    rtLeft.accentBorder.thickness === 6,
  `left accent did not round-trip: ${JSON.stringify(rtLeft.accentBorder)}`,
);
const rtGlow = findSection('sec-glow');
assert(
  rtGlow.accentBorder?.type === 'glow' &&
    rtGlow.accentBorder.color === 'rgba(255,128,0,0.4)' &&
    rtGlow.accentBorder.radius === 48 &&
    rtGlow.accentBorder.spread === 8,
  `glow accent did not round-trip: ${JSON.stringify(rtGlow.accentBorder)}`,
);
const rtPlain = findSection('sec-plain');
assert(
  rtPlain.accentBorder === undefined,
  `expected sec-plain to round-trip with no accentBorder, got ${JSON.stringify(rtPlain.accentBorder)}`,
);

// Glow without the optional `spread` round-trips with `spread` absent.
const glowNoSpreadSection = sectionWith('sec-glow-nospread', {
  type: 'glow',
  color: '#abcdef',
  radius: 32,
});
const noSpreadState: EditableSite = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-extra',
      slug: 'extra',
      title: 'Extra',
      width: 1440,
      sections: [glowNoSpreadSection],
    },
  ],
};
const rtExtra = decodeYDoc(encodeYDoc(noSpreadState));
const rtGlowNoSpread = rtExtra.pages[0]?.sections[0];
assert(
  rtGlowNoSpread?.accentBorder?.type === 'glow' &&
    rtGlowNoSpread.accentBorder.radius === 32 &&
    !('spread' in rtGlowNoSpread.accentBorder),
  `glow without spread should round-trip without spread; got ${JSON.stringify(
    rtGlowNoSpread?.accentBorder,
  )}`,
);
console.log('section-accent-border.smoke.ts: Yjs round-trip preserves every variant');

console.log('section-accent-border.smoke.ts: all assertions passed');
