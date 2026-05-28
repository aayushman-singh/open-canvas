// src/canvas/layout/engine-smoke.ts
//
// Smoke test for the layout engine. Exercises:
//   - Stack (column + row) with hug and fill sizing
//   - Grid layout with 2/3/4 columns
//   - Split layout at each ratio
//   - Nested layouts (grid inside stack)
//   - Background containers (fill container in a stack)
//   - Color/font pinning (non-default tokens → pinnedStyle)
//   - Image prompt collection
//   - Element cap enforcement (MAX_ELEMENTS = 30)
//   - Output passes validateCanvasSiteState
//
// Pure, no network. Run: bun run src/canvas/layout/engine-smoke.ts

import { resolveDesignSection } from './engine.js';
import type { DesignSectionInput, LayoutNode, ElementNode } from './tree.js';
import { validateCanvasSiteState } from '../validate.js';
import { getStyleKitPreset } from '../style-kits.js';
import type { CanvasSiteState } from '../schema.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const CHARCOAL = getStyleKitPreset('charcoal');
const PAGE_WIDTH = 1440;

function wrapInState(section: import('../schema.js').CanvasSection): CanvasSiteState {
  return {
    styleKit: 'charcoal',
    pages: [{ id: 'page-1', slug: 'home', title: 'Smoke', width: PAGE_WIDTH, sections: [section] }],
  };
}

// ---------------------------------------------------------------------------
// 1. Simple column stack with hug elements
// ---------------------------------------------------------------------------

{
  const input: DesignSectionInput = {
    sectionName: 'Hero',
    height: 720,
    backgroundEffect: 'grain',
    entrance: 'fade-up',
    layout: {
      type: 'stack',
      direction: 'column',
      gap: 'normal',
      align: 'start',
      children: [
        {
          element: {
            type: 'text',
            text: {
              content: 'Hello World',
              role: 'heading',
              color: 'text',
              font: 'display',
              size: 48,
            },
          },
        },
        {
          element: {
            type: 'text',
            text: { content: 'A subtitle', role: 'body', color: 'muted', font: 'body', size: 18 },
          },
        },
        {
          element: {
            type: 'action',
            action: {
              label: 'Get started',
              variant: 'solid',
              href: { type: 'external', url: '#' },
            },
          },
        },
      ],
    },
  };

  const { section, imagePrompts } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);

  assert(section.name === 'Hero', 'section name');
  assert(section.height === 720, 'section height');
  assert(section.backgroundEffect === 'grain', 'background effect');
  assert(section.entrance === 'fade-up', 'entrance');
  assert(section.recipeId === 'custom', 'recipeId must be custom');
  assert(
    section.elements.length === 3,
    `expected 3 elements, got ${String(section.elements.length)}`,
  );
  assert(imagePrompts.size === 0, 'no image prompts expected');

  // Elements should be positioned within the section bounds
  for (const el of section.elements) {
    assert(el.box.x >= 0, `element ${el.id} x >= 0`);
    assert(el.box.y >= 0, `element ${el.id} y >= 0`);
    assert(el.box.w > 0, `element ${el.id} w > 0`);
    assert(el.box.h > 0, `element ${el.id} h > 0`);
    assert(
      el.box.x + el.box.w <= PAGE_WIDTH,
      `element ${el.id} fits page width: ${String(el.box.x + el.box.w)} <= ${String(PAGE_WIDTH)}`,
    );
    assert(
      el.box.y + el.box.h <= section.height,
      `element ${el.id} fits section height: ${String(el.box.y + el.box.h)} <= ${String(section.height)}`,
    );
  }

  // Text element with muted color should have pinnedStyle
  const subtitleEl = section.elements[1]!;
  assert(subtitleEl.type === 'text', 'second element is text');
  assert(
    subtitleEl.pinnedStyle !== undefined && subtitleEl.pinnedStyle['color'] === CHARCOAL.muted,
    'muted color should be pinned',
  );

  // Text element with default color should NOT have pinnedStyle.color
  const headingEl = section.elements[0]!;
  assert(headingEl.type === 'text', 'first element is text');
  assert(
    headingEl.pinnedStyle === undefined || headingEl.pinnedStyle['color'] === undefined,
    'default text color should not be pinned',
  );

  // Validate
  const result = validateCanvasSiteState(wrapInState(section));
  assert(result.valid, result.valid ? '' : `validation failed: ${result.errors.join('; ')}`);
}

// ---------------------------------------------------------------------------
// 2. Grid layout (3 columns)
// ---------------------------------------------------------------------------

{
  const input: DesignSectionInput = {
    sectionName: 'Features',
    height: 600,
    layout: {
      type: 'grid',
      columns: 3,
      gap: 'normal',
      children: [
        {
          element: {
            type: 'text',
            text: {
              content: 'Feature A',
              role: 'heading',
              color: 'text',
              font: 'display',
              size: 24,
            },
          },
        },
        {
          element: {
            type: 'text',
            text: {
              content: 'Feature B',
              role: 'heading',
              color: 'text',
              font: 'display',
              size: 24,
            },
          },
        },
        {
          element: {
            type: 'text',
            text: {
              content: 'Feature C',
              role: 'heading',
              color: 'text',
              font: 'display',
              size: 24,
            },
          },
        },
      ],
    },
  };

  const { section } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  assert(section.elements.length === 3, 'grid should produce 3 elements');

  // Elements should be in 3 columns
  const xs = section.elements.map((e) => e.box.x);
  assert(xs[0]! < xs[1]!, 'col 0 left of col 1');
  assert(xs[1]! < xs[2]!, 'col 1 left of col 2');

  const result = validateCanvasSiteState(wrapInState(section));
  assert(result.valid, result.valid ? '' : `grid validation failed: ${result.errors.join('; ')}`);
}

// ---------------------------------------------------------------------------
// 3. Split layout
// ---------------------------------------------------------------------------

{
  const input: DesignSectionInput = {
    sectionName: 'Split Hero',
    height: 720,
    layout: {
      type: 'split',
      ratio: '1:1',
      gap: 'normal',
      children: [
        {
          type: 'stack',
          direction: 'column',
          gap: 'normal',
          children: [
            {
              element: {
                type: 'text',
                text: {
                  content: 'Left side heading',
                  role: 'heading',
                  color: 'text',
                  font: 'display',
                  size: 48,
                },
              },
            },
            {
              element: {
                type: 'text',
                text: {
                  content: 'Body text here',
                  role: 'body',
                  color: 'muted',
                  font: 'body',
                  size: 16,
                },
              },
            },
          ],
        },
        {
          element: {
            type: 'media',
            media: { imagePrompt: 'A professional workspace photo', fit: 'cover' },
          },
          size: 'fill',
        },
      ],
    },
  };

  const { section, imagePrompts } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);

  assert(
    section.elements.length === 3,
    `split should produce 3 elements (2 text + 1 media), got ${String(section.elements.length)}`,
  );

  // Image prompt should be collected
  assert(imagePrompts.size === 1, 'one image prompt expected');
  const mediaEl = section.elements.find((e) => e.type === 'media');
  assert(mediaEl !== undefined, 'media element should exist');
  assert(imagePrompts.has(mediaEl!.id), 'image prompt keyed by media element id');
  assert(
    imagePrompts.get(mediaEl!.id) === 'A professional workspace photo',
    'image prompt content',
  );

  const result = validateCanvasSiteState(wrapInState(section));
  assert(result.valid, result.valid ? '' : `split validation failed: ${result.errors.join('; ')}`);
}

// ---------------------------------------------------------------------------
// 4. Split ratio 2:1
// ---------------------------------------------------------------------------

{
  const input: DesignSectionInput = {
    sectionName: 'Asymmetric',
    height: 600,
    layout: {
      type: 'split',
      ratio: '2:1',
      gap: 'normal',
      children: [
        {
          element: {
            type: 'text',
            text: {
              content: 'Wide side',
              role: 'heading',
              color: 'text',
              font: 'display',
              size: 36,
            },
          },
        },
        {
          element: {
            type: 'text',
            text: { content: 'Narrow', role: 'body', color: 'text', font: 'body', size: 16 },
          },
        },
      ],
    },
  };

  const { section } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  assert(section.elements.length === 2, '2:1 split should produce 2 elements');

  const leftW = section.elements[0]!.box.w;
  const rightW = section.elements[1]!.box.w;
  assert(
    leftW > rightW,
    `2:1 ratio: left (${String(leftW)}) should be wider than right (${String(rightW)})`,
  );

  const result = validateCanvasSiteState(wrapInState(section));
  assert(
    result.valid,
    result.valid ? '' : `2:1 split validation failed: ${result.errors.join('; ')}`,
  );
}

// ---------------------------------------------------------------------------
// 5. Background container
// ---------------------------------------------------------------------------

{
  const input: DesignSectionInput = {
    sectionName: 'Card',
    height: 400,
    layout: {
      type: 'stack',
      direction: 'column',
      gap: 'tight',
      children: [
        {
          element: { type: 'container', container: { variant: 'outlined', padding: 32 } },
          size: 'fill',
        },
        {
          element: {
            type: 'text',
            text: {
              content: 'Card title',
              role: 'heading',
              color: 'text',
              font: 'display',
              size: 24,
            },
          },
        },
        {
          element: {
            type: 'text',
            text: {
              content: 'Card body text',
              role: 'body',
              color: 'muted',
              font: 'body',
              size: 16,
            },
          },
        },
      ],
    },
  };

  const { section } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);

  // Container should span the full area, text elements inside
  const containerEl = section.elements.find((e) => e.type === 'container');
  assert(containerEl !== undefined, 'container element should exist');

  // Text elements should be offset by the container's padding
  const textEls = section.elements.filter((e) => e.type === 'text');
  assert(textEls.length === 2, `expected 2 text elements, got ${String(textEls.length)}`);
  for (const t of textEls) {
    assert(
      t.box.x > containerEl!.box.x,
      `text ${t.id} x (${String(t.box.x)}) should be offset from container x (${String(containerEl!.box.x)})`,
    );
  }

  // Container z should be lower than text z
  for (const t of textEls) {
    assert(
      containerEl!.box.z < t.box.z,
      `container z (${String(containerEl!.box.z)}) should be lower than text z (${String(t.box.z)})`,
    );
  }

  const result = validateCanvasSiteState(wrapInState(section));
  assert(
    result.valid,
    result.valid ? '' : `bg container validation failed: ${result.errors.join('; ')}`,
  );
}

// ---------------------------------------------------------------------------
// 6. Nested layout — pricing grid (grid of stacks)
// ---------------------------------------------------------------------------

{
  const makeTier = (name: string, price: string): LayoutNode => ({
    type: 'stack',
    direction: 'column',
    gap: 'tight',
    children: [
      {
        element: { type: 'container', container: { variant: 'outlined', padding: 24 } },
        size: 'fill',
      },
      {
        element: {
          type: 'text',
          text: { content: name, role: 'heading', color: 'text', font: 'display', size: 24 },
        },
      },
      {
        element: {
          type: 'text',
          text: { content: price, role: 'heading', color: 'accent', font: 'display', size: 36 },
        },
      },
      {
        element: {
          type: 'action',
          action: {
            label: 'Get Started',
            variant: 'outline',
            href: { type: 'external', url: '#' },
          },
        },
      },
    ],
  });

  const input: DesignSectionInput = {
    sectionName: 'Pricing',
    height: 720,
    layout: {
      type: 'stack',
      direction: 'column',
      align: 'center',
      gap: 'loose',
      children: [
        {
          element: {
            type: 'text',
            text: {
              content: 'Simple, transparent pricing',
              role: 'heading',
              color: 'text',
              font: 'display',
              size: 48,
            },
          },
        },
        {
          type: 'grid',
          columns: 3,
          gap: 'normal',
          children: [
            makeTier('Starter', '$9/mo'),
            makeTier('Pro', '$29/mo'),
            makeTier('Enterprise', '$99/mo'),
          ],
        },
      ],
    },
  };

  const { section } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);

  // 1 heading + 3 tiers * (1 container + 2 text + 1 action) = 1 + 12 = 13
  assert(
    section.elements.length === 13,
    `pricing grid: expected 13 elements, got ${String(section.elements.length)}`,
  );

  // Heading text should be center-aligned
  const heading = section.elements[0]!;
  assert(
    heading.type === 'text' && heading.align === 'center',
    'pricing heading should be center-aligned',
  );

  const result = validateCanvasSiteState(wrapInState(section));
  assert(
    result.valid,
    result.valid ? '' : `pricing validation failed: ${result.errors.join('; ')}`,
  );
}

// ---------------------------------------------------------------------------
// 7. Row stack
// ---------------------------------------------------------------------------

{
  const input: DesignSectionInput = {
    sectionName: 'Row',
    height: 400,
    layout: {
      type: 'stack',
      direction: 'row',
      gap: 'normal',
      children: [
        {
          element: {
            type: 'text',
            text: { content: 'Left', role: 'heading', color: 'text', font: 'display', size: 36 },
          },
          size: 'fill',
        },
        {
          element: {
            type: 'text',
            text: { content: 'Right', role: 'heading', color: 'text', font: 'display', size: 36 },
          },
          size: 'fill',
        },
      ],
    },
  };

  const { section } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  assert(section.elements.length === 2, 'row stack should produce 2 elements');
  assert(
    section.elements[0]!.box.x < section.elements[1]!.box.x,
    'left element should be left of right',
  );

  const result = validateCanvasSiteState(wrapInState(section));
  assert(result.valid, result.valid ? '' : `row validation failed: ${result.errors.join('; ')}`);
}

// ---------------------------------------------------------------------------
// 8. Height clamping
// ---------------------------------------------------------------------------

{
  const input: DesignSectionInput = {
    sectionName: 'Clamped low',
    height: 50,
    layout: {
      type: 'stack',
      direction: 'column',
      children: [
        {
          element: {
            type: 'text',
            text: { content: 'Short', role: 'body', color: 'text', font: 'body', size: 14 },
          },
        },
      ],
    },
  };

  const { section } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  assert(
    section.height >= 240,
    `height should be clamped to >= 240, got ${String(section.height)}`,
  );

  const result = validateCanvasSiteState(wrapInState(section));
  assert(result.valid, result.valid ? '' : `clamped validation: ${result.errors.join('; ')}`);
}

{
  const input: DesignSectionInput = {
    sectionName: 'Clamped high',
    height: 9999,
    layout: {
      type: 'stack',
      direction: 'column',
      children: [
        {
          element: {
            type: 'text',
            text: { content: 'Tall', role: 'body', color: 'text', font: 'body', size: 14 },
          },
        },
      ],
    },
  };

  const { section } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  assert(
    section.height <= 1200,
    `height should be clamped to <= 1200, got ${String(section.height)}`,
  );

  const result = validateCanvasSiteState(wrapInState(section));
  assert(result.valid, result.valid ? '' : `clamped high validation: ${result.errors.join('; ')}`);
}

// ---------------------------------------------------------------------------
// 9. Element cap (MAX_ELEMENTS = 30)
// ---------------------------------------------------------------------------

{
  const children: ElementNode[] = [];
  for (let i = 0; i < 40; i++) {
    children.push({
      element: {
        type: 'text',
        text: { content: `Item ${String(i)}`, role: 'body', color: 'text', font: 'body', size: 14 },
      },
    });
  }

  const input: DesignSectionInput = {
    sectionName: 'Cap test',
    height: 1200,
    layout: { type: 'stack', direction: 'column', gap: 'tight', children },
  };

  let threw = false;
  try {
    resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  } catch (err) {
    threw = err instanceof Error && err.message.includes('maximum element count');
  }
  assert(threw, 'layout engine must reject layouts that exceed the maximum element count');
}

// ---------------------------------------------------------------------------
// 10. Font pinning — mono font on heading should produce pinnedStyle
// ---------------------------------------------------------------------------

{
  const input: DesignSectionInput = {
    sectionName: 'Mono heading',
    height: 400,
    layout: {
      type: 'stack',
      direction: 'column',
      children: [
        {
          element: {
            type: 'text',
            text: { content: 'Code-like', role: 'heading', color: 'text', font: 'mono', size: 32 },
          },
        },
      ],
    },
  };

  const { section } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  const el = section.elements[0]!;
  assert(el.type === 'text', 'element is text');
  assert(
    el.pinnedStyle !== undefined && el.pinnedStyle['font-family'] === CHARCOAL.fontFamilyMono,
    'mono font on heading should produce font-family pinnedStyle',
  );

  const result = validateCanvasSiteState(wrapInState(section));
  assert(result.valid, result.valid ? '' : `font pin validation: ${result.errors.join('; ')}`);
}

// ---------------------------------------------------------------------------
// 11. Every style kit produces valid output
// ---------------------------------------------------------------------------

import { BUILT_IN_STYLE_KITS } from '../schema.js';

for (const kit of BUILT_IN_STYLE_KITS) {
  const preset = getStyleKitPreset(kit);
  const input: DesignSectionInput = {
    sectionName: `Kit ${kit}`,
    height: 600,
    layout: {
      type: 'split',
      ratio: '1:1',
      children: [
        {
          element: {
            type: 'text',
            text: { content: 'Hello', role: 'heading', color: 'accent', font: 'display', size: 48 },
          },
        },
        {
          element: { type: 'media', media: { imagePrompt: 'test image', fit: 'cover' } },
          size: 'fill',
        },
      ],
    },
  };

  const { section, imagePrompts } = resolveDesignSection(input, PAGE_WIDTH, preset);
  assert(imagePrompts.size === 1, `kit ${kit}: one image prompt`);

  const state: CanvasSiteState = {
    styleKit: kit,
    pages: [{ id: 'page-1', slug: 'home', title: 'Smoke', width: PAGE_WIDTH, sections: [section] }],
  };
  const result = validateCanvasSiteState(state);
  assert(
    result.valid,
    result.valid ? '' : `kit ${kit} validation failed: ${result.errors.join('; ')}`,
  );
}

// ---------------------------------------------------------------------------
// 12. Deeply nested layout — no crash, respects element cap
// ---------------------------------------------------------------------------

{
  const deepNested: LayoutNode = {
    type: 'stack',
    direction: 'column',
    children: [
      {
        type: 'grid',
        columns: 3,
        children: [
          {
            type: 'split',
            ratio: '1:1',
            children: [
              {
                element: {
                  type: 'text',
                  text: { content: 'Deep 1', role: 'body', color: 'text', font: 'body', size: 14 },
                },
              },
              {
                element: {
                  type: 'text',
                  text: { content: 'Deep 2', role: 'body', color: 'text', font: 'body', size: 14 },
                },
              },
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            children: [
              {
                element: {
                  type: 'text',
                  text: { content: 'Deep 3', role: 'body', color: 'text', font: 'body', size: 14 },
                },
              },
            ],
          },
          { element: { type: 'shape', shape: { variant: 'circle' } } },
        ],
      },
    ],
  };

  const input: DesignSectionInput = { sectionName: 'Deep', height: 600, layout: deepNested };
  const { section } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  assert(
    section.elements.length === 4,
    `deep nested: expected 4 elements, got ${String(section.elements.length)}`,
  );

  const result = validateCanvasSiteState(wrapInState(section));
  assert(result.valid, result.valid ? '' : `deep nested validation: ${result.errors.join('; ')}`);
}

// ---------------------------------------------------------------------------
// 13. Out-of-bounds font size clamping
// ---------------------------------------------------------------------------

{
  const input: DesignSectionInput = {
    sectionName: 'Clamp font',
    height: 400,
    layout: {
      type: 'stack',
      direction: 'column',
      children: [
        {
          element: {
            type: 'text',
            text: { content: 'Tiny', role: 'body', color: 'text', font: 'body', size: 2 },
          },
        },
        {
          element: {
            type: 'text',
            text: { content: 'Huge', role: 'heading', color: 'text', font: 'display', size: 200 },
          },
        },
      ],
    },
  };

  const { section } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  const tiny = section.elements[0]!;
  const huge = section.elements[1]!;
  assert(tiny.type === 'text' && tiny.fontSize >= 12, 'font size clamped to >= 12');
  assert(huge.type === 'text' && huge.fontSize <= 96, 'font size clamped to <= 96');

  const result = validateCanvasSiteState(wrapInState(section));
  assert(result.valid, result.valid ? '' : `font clamp validation: ${result.errors.join('; ')}`);
}

// ---------------------------------------------------------------------------
// 14. All elements fit within section bounds (post-resolve clamp)
// ---------------------------------------------------------------------------

{
  const input: DesignSectionInput = {
    sectionName: 'Boundary',
    height: 300,
    layout: {
      type: 'stack',
      direction: 'column',
      gap: 'loose',
      children: [
        {
          element: {
            type: 'text',
            text: {
              content:
                'A very long text element that should not exceed section boundaries regardless of content length',
              role: 'body',
              color: 'text',
              font: 'body',
              size: 16,
            },
          },
        },
        {
          element: {
            type: 'text',
            text: {
              content: 'Another element',
              role: 'body',
              color: 'text',
              font: 'body',
              size: 16,
            },
          },
        },
        {
          element: {
            type: 'text',
            text: { content: 'Third element', role: 'body', color: 'text', font: 'body', size: 16 },
          },
        },
        {
          element: {
            type: 'text',
            text: {
              content: 'Fourth element',
              role: 'body',
              color: 'text',
              font: 'body',
              size: 16,
            },
          },
        },
        {
          element: {
            type: 'text',
            text: { content: 'Fifth element', role: 'body', color: 'text', font: 'body', size: 16 },
          },
        },
      ],
    },
  };

  const { section } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  for (const el of section.elements) {
    assert(el.box.x >= 0, `${el.id}: x >= 0`);
    assert(el.box.y >= 0, `${el.id}: y >= 0`);
    assert(el.box.x + el.box.w <= PAGE_WIDTH, `${el.id}: x+w <= pageWidth`);
    assert(el.box.y + el.box.h <= section.height, `${el.id}: y+h <= sectionHeight`);
  }

  const result = validateCanvasSiteState(wrapInState(section));
  assert(result.valid, result.valid ? '' : `boundary validation: ${result.errors.join('; ')}`);
}

// ---------------------------------------------------------------------------
// 15. Multiple media elements with image prompts
// ---------------------------------------------------------------------------

{
  const input: DesignSectionInput = {
    sectionName: 'Multi-image',
    height: 600,
    layout: {
      type: 'grid',
      columns: 3,
      children: [
        {
          element: {
            type: 'media',
            media: { imagePrompt: 'A sunset over mountains', fit: 'cover' },
          },
          size: 'fill',
        },
        {
          element: {
            type: 'media',
            media: { imagePrompt: 'A city skyline at night', fit: 'cover' },
          },
          size: 'fill',
        },
        {
          element: {
            type: 'media',
            media: { imagePrompt: 'A forest path in autumn', fit: 'contain' },
          },
          size: 'fill',
        },
      ],
    },
  };

  const { section, imagePrompts } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  assert(imagePrompts.size === 3, `expected 3 image prompts, got ${String(imagePrompts.size)}`);
  assert(section.elements.length === 3, 'three media elements');

  for (const el of section.elements) {
    assert(el.type === 'media', 'all elements are media');
    if (el.type === 'media') {
      assert(el.assetId === '', 'assetId should be empty (awaiting generation)');
    }
    assert(imagePrompts.has(el.id), `image prompt for ${el.id}`);
  }
}

// ---------------------------------------------------------------------------
// 16. Empty children list — no crash
// ---------------------------------------------------------------------------

{
  const input: DesignSectionInput = {
    sectionName: 'Empty',
    layout: { type: 'stack', direction: 'column', children: [] },
  };

  const { section } = resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  assert(section.elements.length === 0, 'empty layout produces no elements');

  // Empty section won't pass validation (needs at least one section in the page)
  // but the engine itself shouldn't crash.
}

// ---------------------------------------------------------------------------
// 17. Missing element props — loud failure, no invented defaults
// ---------------------------------------------------------------------------

{
  const input = {
    sectionName: 'Missing props',
    layout: {
      type: 'stack',
      direction: 'column',
      children: [{ element: { type: 'text' } }],
    },
  } as unknown as DesignSectionInput;

  let threw = false;
  try {
    resolveDesignSection(input, PAGE_WIDTH, CHARCOAL);
  } catch (err) {
    threw = err instanceof Error && err.message.includes('text element requires text props');
  }
  assert(threw, 'layout engine must reject text elements without text props');
}

console.log('[layout-engine:smoke] OK');
