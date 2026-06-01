// src/og-image/render.tsx
//
// Satori card template. JSX → SVG. The card is a single 1200×630 surface
// laid out with flexbox primitives (the only layout Satori implements).
//
// Layout intent:
//   - Site name in small caps, top-left, tiny + muted.
//   - Page title as a large display heading.
//   - Optional page description as muted body text below the heading.
//   - Accent stripe across the bottom (24px tall) in the Style Kit accent.
//
// The card reads three tokens from the kit preset:
//   - `bg`           → page background
//   - `text`         → primary text colour
//   - `muted`        → muted (site name + description) text colour
//   - `accent`       → accent stripe + a thin tick under the title
//
// Font choice: one default OG font (Inter Regular + Bold) bundled at
// `./fonts/`. The plan calls out per-kit fonts as out of scope for POC.
//
// The JSX is authored as plain function calls via the satori-friendly
// `h(...)` helper rather than going through hono/jsx (which is configured
// globally in tsconfig). Satori does not need React; it walks any node tree
// with the `{type, props}` shape so we hand-build the tree here. This
// avoids forcing a per-file JSX pragma comment.

import satori from 'satori';
import { loadOgFonts } from './fonts/fonts.js';
import type { CanvasElement, CanvasSection, StyleKitPreset } from '../canvas/schema.js';

// File extension `.tsx` is kept so the convention matches the plan (the
// brief lists `src/og-image/render.tsx`), even though we don't emit JSX
// syntax. The build cost is identical.

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface RenderOgCardInput {
  siteName: string;
  pageTitle: string;
  pageDescription?: string;
  preset: StyleKitPreset;
}

interface SatoriNode {
  type: string;
  props: Record<string, unknown>;
}

function h(
  type: string,
  props: Record<string, unknown> | null,
  ...children: Array<SatoriNode | string | null | undefined>
): SatoriNode {
  const flat = children.flat().filter((c): c is SatoriNode | string => c != null);
  const finalProps: Record<string, unknown> = props === null ? {} : { ...props };
  finalProps.children = flat.length === 1 ? flat[0] : flat;
  return { type, props: finalProps };
}

/**
 * Build the JSX tree for the OG card. Returns a Satori-compatible node.
 */
function buildCardTree(input: RenderOgCardInput): SatoriNode {
  const { siteName, pageTitle, pageDescription, preset } = input;

  // The whole card.
  return h(
    'div',
    {
      style: {
        width: `${String(OG_WIDTH)}px`,
        height: `${String(OG_HEIGHT)}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: preset.bg,
        color: preset.text,
        // Generous padding — the title dominates the card.
        padding: '72px 80px 0 80px',
        fontFamily: 'Inter',
      },
    },
    // Top row: site name as small caps.
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          fontSize: '22px',
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: preset.muted,
        },
      },
      siteName,
    ),
    // Middle block — title and optional description.
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          // Push the block toward the lower-middle of the card; the accent
          // stripe sits beneath.
          marginBottom: '48px',
        },
      },
      // A short accent tick above the title for visual anchoring.
      h('div', {
        style: {
          width: '64px',
          height: '6px',
          backgroundColor: preset.accent,
          borderRadius: '999px',
          display: 'flex',
        },
      }),
      // Page title — display heading.
      h(
        'div',
        {
          style: {
            fontSize: '76px',
            fontWeight: 700,
            lineHeight: 1.1,
            color: preset.text,
            // Cap the heading width so very long titles wrap instead of
            // running off the card. 1080 ≈ card width minus left/right
            // padding (80+80=160 leaves 1040; 1040 is safer for serif
            // glyph overflow).
            maxWidth: '1040px',
            display: 'flex',
          },
        },
        truncate(pageTitle, 140),
      ),
      // Optional description — only emitted when present.
      pageDescription !== undefined && pageDescription.length > 0
        ? h(
            'div',
            {
              style: {
                fontSize: '28px',
                lineHeight: 1.4,
                color: preset.muted,
                maxWidth: '900px',
                display: 'flex',
              },
            },
            truncate(pageDescription, 200),
          )
        : null,
    ),
    // Bottom accent stripe — full-width band at the very edge.
    h('div', {
      style: {
        width: '100%',
        height: '24px',
        backgroundColor: preset.accent,
        display: 'flex',
        // Pull the stripe out of the padded interior so it touches the
        // card edges. Negative margin on the same axis as the parent
        // padding cancels it cleanly.
        marginLeft: '-80px',
        marginRight: '-80px',
        marginBottom: '0px',
      },
    }),
  );
}

/**
 * Hard text limit so a pathological title doesn't blow Satori's layout
 * solver budget. The visual cap from the maxWidth styles is the design
 * intent; this is a safety net.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Render the OG card to an SVG string via Satori. Caller composes
 * `rasteriseSvgToPng` to get the PNG bytes — this module stops at SVG so a
 * future need for an inline-SVG path (e.g. a debug endpoint) is trivial.
 */
export async function renderOgCardSvg(input: RenderOgCardInput): Promise<string> {
  const fonts = await loadOgFonts();
  const tree = buildCardTree(input);
  // `satori` accepts our hand-built `{type, props}` node — its walker uses
  // exactly that shape. The hand-built node structurally matches one branch
  // of the `ReactNode` union (`{} | ReactElement | ...`) so no cast is needed.
  return satori(tree, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [
      { name: 'Inter', data: fonts.regular, weight: 400, style: 'normal' },
      { name: 'Inter', data: fonts.bold, weight: 700, style: 'normal' },
    ],
    embedFont: true,
  });
}

// ---------------------------------------------------------------------------
// Section-based OG render — uses the actual hero section layout as the card.
// ---------------------------------------------------------------------------

export interface RenderOgFromSectionInput {
  section: CanvasSection;
  pageWidth: number;
  preset: StyleKitPreset;
}

/**
 * Render the first section's positioned elements as an OG image via Satori.
 * The output is a 1200×630 SVG that mirrors the hero section's visual layout,
 * giving the OG preview the look of the actual site design rather than a
 * generic text card.
 *
 * MediaElements are skipped — Satori cannot fetch arbitrary image URLs during
 * render and we don't have asset bytes available here.
 */
export async function renderOgFromSectionSvg(input: RenderOgFromSectionInput): Promise<string> {
  const tree = buildSectionTree(input);
  const fonts = await loadOgFonts();
  return satori(tree, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [
      { name: 'Inter', data: fonts.regular, weight: 400, style: 'normal' },
      { name: 'Inter', data: fonts.bold, weight: 700, style: 'normal' },
    ],
    embedFont: true,
  });
}

/**
 * Build the Satori node tree for a section-based OG card. Scales the section's
 * coordinate space (designed at `pageWidth × section.height`) down to fit
 * 1200×630, preserving aspect ratio.
 */
function buildSectionTree(input: RenderOgFromSectionInput): SatoriNode {
  const { section, pageWidth, preset } = input;
  const scaleX = OG_WIDTH / pageWidth;
  const scaleY = OG_HEIGHT / section.height;
  const scale = Math.min(scaleX, scaleY);

  const children: SatoriNode[] = [];

  // Sort by z-index for correct layering.
  const sorted = [...section.elements].sort((a, b) => a.box.z - b.box.z);

  for (const el of sorted) {
    const node = elementToSatoriNode(el, scale, preset);
    if (node) children.push(node);
  }

  return h(
    'div',
    {
      style: {
        width: `${String(OG_WIDTH)}px`,
        height: `${String(OG_HEIGHT)}px`,
        display: 'flex',
        position: 'relative',
        backgroundColor: preset.bg,
        overflow: 'hidden',
        fontFamily: 'Inter',
      },
    },
    ...children,
  );
}

/**
 * Map a single CanvasElement to a Satori node. Returns null for element types
 * that cannot be meaningfully rendered in a static OG context (media, embeds,
 * etc.).
 */
function elementToSatoriNode(
  el: CanvasElement,
  scale: number,
  preset: StyleKitPreset,
): SatoriNode | null {
  const baseStyle: Record<string, string | number> = {
    position: 'absolute',
    left: `${String(Math.round(el.box.x * scale))}px`,
    top: `${String(Math.round(el.box.y * scale))}px`,
    width: `${String(Math.round(el.box.w * scale))}px`,
    height: `${String(Math.round(el.box.h * scale))}px`,
    display: 'flex',
  };

  switch (el.type) {
    case 'text': {
      const plainText = el.content.map((r) => r.text).join('');
      return h(
        'div',
        {
          style: {
            ...baseStyle,
            fontSize: `${String(Math.round(el.fontSize * scale))}px`,
            fontWeight: el.fontWeight,
            color: el.role === 'heading' ? preset.text : preset.muted,
            alignItems: 'center',
            overflow: 'hidden',
          },
        },
        plainText,
      );
    }
    case 'shape':
      return h('div', {
        style: {
          ...baseStyle,
          backgroundColor: preset.shapeFill,
          borderRadius:
            el.variant === 'circle' || el.variant === 'pill'
              ? '9999px'
              : preset.radius,
        },
      });
    case 'container':
      return h('div', {
        style: {
          ...baseStyle,
          backgroundColor: preset.panel,
          borderRadius: preset.radius,
        },
      });
    case 'action':
      return h(
        'div',
        {
          style: {
            ...baseStyle,
            backgroundColor: preset.accent,
            color: preset.accentText,
            borderRadius: preset.actionRadius,
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: `${String(Math.round(16 * scale))}px`,
            fontWeight: 600,
          },
        },
        el.label.map((run) => run.text).join(''),
      );
    default:
      return null;
  }
}
