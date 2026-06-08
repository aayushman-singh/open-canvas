// src/canvas/adr-0016-du-narrowing.smoke.ts
//
// ADR 0016 follow-up smoke — round-trips the two patterns the ADR collapsed
// into real discriminated unions and asserts the narrowing behaviour the
// type now guarantees.
//
// Pattern 1 — `EditableSiteStyleKit`: a `'custom'` `EditableSite` round-trips
// through `validatePublishedSnapshot` → JSONB → `validatePublishedSnapshot`
// → typed read, and the narrowed `customStyleKit` is present.
//
// Pattern 2 — `ElementNodeBody`: every branch flows through the layout
// engine and produces a `CanvasElement` whose `type` matches the branch
// discriminator. The pre-DU `requireXProps` guards no longer exist; the
// switch in `createCanvasElement` narrows directly on `el.type`.

import { resolveDesignSection } from './layout/engine.js';
import type { DesignSectionInput, ElementNode } from './layout/tree.js';
import {
  pickStyleKitField,
  type EditableSite,
  type PublishedSnapshot,
  type StyleKitPreset,
} from './schema.js';
import { STYLE_KIT_PRESETS } from './style-kits.js';
import { validatePublishedSnapshot } from './validate.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[adr-0016-du-narrowing:smoke] ${message}`);
}

// ----------------------------------------------------------------------------
// Pattern 1 — EditableSiteStyleKit round-trip.
// ----------------------------------------------------------------------------

const customKit: StyleKitPreset = STYLE_KIT_PRESETS.charcoal;

const customEditable: EditableSite = {
  styleKit: 'custom',
  customStyleKit: customKit,
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'section-hero',
          recipeId: 'hero-split',
          name: 'Hero',
          height: 400,
          elements: [
            {
              id: 'text-hero',
              type: 'text',
              box: { x: 80, y: 120, w: 600, h: 80, z: 1 },
              content: [{ text: 'Hello' }],
              role: 'heading',
              fontSize: 48,
              fontWeight: 700,
              align: 'left',
            },
          ],
        },
      ],
    },
  ],
};

const customSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-06-05T00:00:00.000Z',
  ...pickStyleKitField(customEditable),
  pages: customEditable.pages,
};

const firstPass = validatePublishedSnapshot(customSnapshot);
assert(firstPass.valid, `validator rejected the custom snapshot pre-JSON: ${JSON.stringify(firstPass)}`);

const wire = JSON.parse(JSON.stringify(customSnapshot)) as unknown;
const secondPass = validatePublishedSnapshot(wire);
assert(secondPass.valid, `validator rejected the custom snapshot post-JSON: ${JSON.stringify(secondPass)}`);

const typed = wire as PublishedSnapshot;
if (typed.styleKit === 'custom') {
  // Narrowing test: this branch must expose `customStyleKit` as `StyleKitPreset`
  // (no `| undefined`). If the DU regresses to optional siblings, the
  // ts compile errors before the smoke runs.
  const preset: StyleKitPreset = typed.customStyleKit;
  assert(preset.accent === customKit.accent, 'custom round-trip lost accent');
} else {
  throw new Error('expected styleKit === "custom" after round-trip');
}

// Built-in branch — narrowing must also reject any access to customStyleKit.
const builtinEditable: EditableSite & { styleKit: 'charcoal' } = {
  styleKit: 'charcoal',
  pages: customEditable.pages,
};
// @ts-expect-error — `customStyleKit` is absent on the built-in branch
void builtinEditable.customStyleKit;

process.stdout.write('[adr-0016-du-narrowing:smoke] EditableSiteStyleKit round-trip OK\n');

// ----------------------------------------------------------------------------
// Pattern 2 — ElementNodeBody per-branch round-trip through the engine.
// ----------------------------------------------------------------------------

const elementBranches: ElementNode[] = [
  {
    element: {
      type: 'text',
      text: {
        content: 'Hello',
        role: 'heading',
        color: 'text',
        font: 'display',
        size: 48,
      },
    },
  },
  {
    element: {
      type: 'media',
      media: { imagePrompt: 'a sunlit landscape', fit: 'cover' },
    },
  },
  {
    element: {
      type: 'action',
      action: {
        label: [{ text: 'Click me' }],
        variant: 'solid',
        href: { type: 'external', url: 'https://example.com' },
      },
    },
  },
  {
    element: {
      type: 'shape',
      shape: { variant: 'circle' },
    },
  },
  {
    element: {
      type: 'container',
      container: { variant: 'flat', padding: 24 },
    },
  },
];

for (const node of elementBranches) {
  const input: DesignSectionInput = {
    sectionName: `du-${node.element.type}`,
    layout: { type: 'stack', children: [node] },
  };
  const result = resolveDesignSection(input, 1440, customKit);
  assert(
    result.section.elements.length === 1,
    `${node.element.type}: expected 1 element, got ${String(result.section.elements.length)}`,
  );
  const out = result.section.elements[0]!;
  assert(
    out.type === node.element.type,
    `${node.element.type}: expected output type to match, got ${out.type}`,
  );
}

// Compile-time narrowing on the DU — the body's branch determines the
// required prop. Pre-DU, a `{ type: 'text' }` with no `text` prop compiled
// fine; post-DU it must not.
//
// @ts-expect-error — text branch requires `text` prop
const _badText: ElementNode = { element: { type: 'text' } };
void _badText;

process.stdout.write('[adr-0016-du-narrowing:smoke] ElementNodeBody round-trip OK\n');
process.stdout.write('[adr-0016-du-narrowing:smoke] OK\n');
