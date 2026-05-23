// src/canvas/style-kits.ts
//
// The single source of truth for the four deterministic Style Kits.
//
// Both the editor preview (src/editor/canvas-styles.ts) and the public
// renderer (src/canvas/public-styles.ts) consume the SAME preset map via
// `buildAllStyleKitsCss`. There is exactly one place that knows how to
// translate a preset into CSS — drift between editor and visitor is
// impossible by construction.
//
// Token contract: every kit fills every field of `StyleKitPreset`. Every
// `Record<X, ...>` entry covers every value of X. TypeScript catches a
// missing token at compile time. Empty `{}` for a variant means "use the
// kit-wide default" — variants ARE always present, even when their override
// is intentionally empty.
//
// No fallbacks: if a kit name reaches the renderer that isn't in
// `STYLE_KIT_PRESETS`, `getStyleKitPreset` throws. The validator already
// rejects unknown kits at the API boundary; this is belt-and-braces.

import type {
  ActionVariant,
  ActionVariantTokens,
  BuiltInStyleKit,
  StyleKitPreset,
  SurfaceVariant,
  SurfaceVariantTokens,
} from './schema.js';
import {
  ACTION_VARIANTS,
  BUILT_IN_STYLE_KITS,
  STYLE_KITS,
  SURFACE_VARIANTS,
} from './schema.js';

// --------------------------------------------------------------------------
// The four kits.
// --------------------------------------------------------------------------

const CHARCOAL: StyleKitPreset = {
  bg: '#0c0c0d',
  panel: '#16171a',
  text: '#f6f6f6',
  muted: '#9a9aa3',
  accent: '#d9dde4',
  accentText: '#0c0c0d',
  fontFamilyDisplay: "'Inter', system-ui, -apple-system, sans-serif",
  fontFamilyBody: "'Inter', system-ui, -apple-system, sans-serif",
  fontFamilyMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  headingScale: 1.0,
  bodyScale: 1.0,
  labelScale: 0.85,
  lineHeight: 1.45,
  radius: '8px',
  borderWidth: '1px',
  shadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
  surfaceVariants: {
    flat: { background: '#16171a', shadow: 'none' },
    raised: { background: '#1c1d22', shadow: '0 10px 28px rgba(0, 0, 0, 0.45)', radius: '10px' },
    glass: {
      background: 'rgba(255, 255, 255, 0.06)',
      border: '1px solid rgba(255, 255, 255, 0.10)',
      shadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
    },
    outlined: { background: 'transparent', border: '1px solid #2a2b30' },
    sticker: {
      background: '#1f2024',
      border: '1px solid #2a2b30',
      shadow: '0 2px 0 #000, 0 8px 20px rgba(0, 0, 0, 0.4)',
      radius: '14px',
    },
    'editorial-frame': {
      background: 'transparent',
      border: '2px solid #d9dde4',
      radius: '0px',
    },
    'soft-panel': { background: '#1a1b1f', shadow: '0 1px 0 rgba(255,255,255,0.04) inset' },
  },
  shapeFill: '#d9dde4',
  shapeStroke: '#9a9aa3',
  shapeStrokeWidth: '1px',
  actionRadius: '8px',
  actionPadding: '10px 18px',
  actionVariants: {
    solid: { background: '#d9dde4', color: '#0c0c0d', weight: 600 },
    outline: { background: 'transparent', color: '#f6f6f6', border: '1px solid #d9dde4' },
    ghost: { background: 'transparent', color: '#f6f6f6' },
    pill: { background: '#d9dde4', color: '#0c0c0d', weight: 600 },
    glass: {
      background: 'rgba(255, 255, 255, 0.08)',
      color: '#f6f6f6',
      border: '1px solid rgba(255, 255, 255, 0.16)',
    },
    brutalist: {
      background: '#0c0c0d',
      color: '#f6f6f6',
      border: '2px solid #f6f6f6',
      weight: 700,
    },
    underline: { background: 'transparent', color: '#f6f6f6' },
  },
  // Snappy motion — charcoal leans modern + technical.
  motionDurationMs: 320,
  motionEasing: 'cubic-bezier(0.2, 0.0, 0.0, 1.0)',
  motionPresets: {
    none: {},
    'fade-up': { transform: 'translateY(12px)', opacity: 0 },
    'slide-left': { transform: 'translateX(20px)', opacity: 0 },
    'scale-in': { transform: 'scale(0.96)', opacity: 0 },
    'blur-in': { opacity: 0 },
    'stagger-children': { transform: 'translateY(8px)', opacity: 0, delayMs: 60 },
    'slow-drift': { transform: 'translateY(0px)' },
    'parallax-soft': { transform: 'translateY(6px)' },
  },
};

const ORANGE_EDITORIAL: StyleKitPreset = {
  bg: '#fff7ef',
  panel: '#fbe9d2',
  text: '#221610',
  muted: '#7a5b48',
  accent: '#d6541b',
  accentText: '#fff7ef',
  fontFamilyDisplay: "'Playfair Display', 'Times New Roman', serif",
  fontFamilyBody: "'Inter', system-ui, -apple-system, sans-serif",
  fontFamilyMono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
  headingScale: 1.15,
  bodyScale: 1.0,
  labelScale: 0.9,
  lineHeight: 1.55,
  radius: '0px',
  borderWidth: '2px',
  // Hard editorial shadow — sharp, offset, no blur.
  shadow: '6px 6px 0 #221610',
  surfaceVariants: {
    flat: { background: '#fbe9d2', shadow: 'none', radius: '0px' },
    raised: {
      background: '#fff',
      border: '2px solid #221610',
      shadow: '8px 8px 0 #d6541b',
      radius: '0px',
    },
    glass: {
      background: 'rgba(255, 247, 239, 0.55)',
      border: '2px solid #221610',
      shadow: 'none',
      radius: '0px',
    },
    outlined: { background: 'transparent', border: '2px solid #221610', radius: '0px' },
    sticker: {
      background: '#ffd6a5',
      border: '2px solid #221610',
      shadow: '4px 4px 0 #221610',
      radius: '4px',
    },
    'editorial-frame': {
      background: 'transparent',
      border: '4px double #221610',
      radius: '0px',
    },
    'soft-panel': { background: '#f6dec2', shadow: 'none', radius: '2px' },
  },
  shapeFill: '#d6541b',
  shapeStroke: '#221610',
  shapeStrokeWidth: '2px',
  actionRadius: '0px',
  actionPadding: '12px 22px',
  actionVariants: {
    solid: { background: '#d6541b', color: '#fff7ef', weight: 700 },
    outline: { background: 'transparent', color: '#221610', border: '2px solid #221610' },
    ghost: { background: 'transparent', color: '#d6541b' },
    // Pill keeps its rounded shape even in this brutalist kit — owner choice.
    pill: { background: '#221610', color: '#fff7ef', weight: 700 },
    glass: {
      background: 'rgba(255, 247, 239, 0.55)',
      color: '#221610',
      border: '2px solid #221610',
    },
    brutalist: {
      background: '#fff7ef',
      color: '#221610',
      border: '3px solid #221610',
      weight: 800,
    },
    underline: { background: 'transparent', color: '#221610' },
  },
  // Editorial = snappy, with character.
  motionDurationMs: 280,
  motionEasing: 'cubic-bezier(0.4, 0.0, 0.2, 1.0)',
  motionPresets: {
    none: {},
    'fade-up': { transform: 'translateY(16px)', opacity: 0 },
    'slide-left': { transform: 'translateX(24px)', opacity: 0 },
    'scale-in': { transform: 'scale(0.94)', opacity: 0 },
    'blur-in': { opacity: 0 },
    'stagger-children': { transform: 'translateY(10px)', opacity: 0, delayMs: 80 },
    'slow-drift': { transform: 'translateY(0px)' },
    'parallax-soft': { transform: 'translateY(8px)' },
  },
};

const BLUE_SAAS: StyleKitPreset = {
  bg: '#0b1530',
  panel: '#11203f',
  text: '#e8efff',
  muted: '#8da3c8',
  accent: '#5b8def',
  accentText: '#0b1530',
  fontFamilyDisplay: "'Inter Tight', system-ui, -apple-system, sans-serif",
  fontFamilyBody: "'Inter Tight', system-ui, -apple-system, sans-serif",
  fontFamilyMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  headingScale: 1.05,
  bodyScale: 0.95,
  labelScale: 0.85,
  lineHeight: 1.5,
  radius: '12px',
  borderWidth: '1px',
  shadow: '0 8px 24px rgba(11, 21, 48, 0.55)',
  surfaceVariants: {
    flat: { background: '#11203f', shadow: 'none', radius: '12px' },
    raised: {
      background: '#15295a',
      shadow: '0 14px 36px rgba(8, 16, 36, 0.6)',
      radius: '16px',
    },
    glass: {
      background: 'rgba(91, 141, 239, 0.10)',
      border: '1px solid rgba(91, 141, 239, 0.22)',
      shadow: '0 6px 18px rgba(11, 21, 48, 0.4)',
      radius: '12px',
    },
    outlined: { background: 'transparent', border: '1px solid #2a4180' },
    sticker: {
      background: '#1b2f63',
      border: '1px solid #2a4180',
      shadow: '0 4px 0 #08122a, 0 10px 22px rgba(8, 16, 36, 0.45)',
      radius: '14px',
    },
    'editorial-frame': {
      background: 'transparent',
      border: '2px solid #5b8def',
      radius: '4px',
    },
    'soft-panel': { background: '#142755', shadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' },
  },
  shapeFill: '#5b8def',
  shapeStroke: '#8da3c8',
  shapeStrokeWidth: '1px',
  actionRadius: '10px',
  actionPadding: '10px 20px',
  actionVariants: {
    solid: { background: '#5b8def', color: '#0b1530', weight: 600 },
    outline: { background: 'transparent', color: '#e8efff', border: '1px solid #5b8def' },
    ghost: { background: 'transparent', color: '#8da3c8' },
    pill: { background: '#5b8def', color: '#0b1530', weight: 600 },
    glass: {
      background: 'rgba(91, 141, 239, 0.14)',
      color: '#e8efff',
      border: '1px solid rgba(91, 141, 239, 0.3)',
    },
    brutalist: {
      background: '#0b1530',
      color: '#e8efff',
      border: '2px solid #5b8def',
      weight: 700,
    },
    underline: { background: 'transparent', color: '#5b8def' },
  },
  // Soft motion — modern SaaS, medium pace.
  motionDurationMs: 420,
  motionEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  motionPresets: {
    none: {},
    'fade-up': { transform: 'translateY(14px)', opacity: 0 },
    'slide-left': { transform: 'translateX(22px)', opacity: 0 },
    'scale-in': { transform: 'scale(0.97)', opacity: 0 },
    'blur-in': { opacity: 0 },
    'stagger-children': { transform: 'translateY(10px)', opacity: 0, delayMs: 70 },
    'slow-drift': { transform: 'translateY(0px)' },
    'parallax-soft': { transform: 'translateY(8px)' },
  },
};

const GREEN_ORGANIC: StyleKitPreset = {
  bg: '#0f1a14',
  panel: '#152821',
  text: '#e7f3ea',
  muted: '#9bb4a4',
  accent: '#7ec18e',
  accentText: '#0f1a14',
  fontFamilyDisplay: "'Manrope', system-ui, -apple-system, sans-serif",
  fontFamilyBody: "'Inter', system-ui, -apple-system, sans-serif",
  fontFamilyMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  headingScale: 1.08,
  bodyScale: 1.02,
  labelScale: 0.9,
  lineHeight: 1.6,
  radius: '20px',
  borderWidth: '1px',
  shadow: '0 12px 32px rgba(8, 18, 12, 0.5)',
  surfaceVariants: {
    flat: { background: '#152821', shadow: 'none', radius: '20px' },
    raised: {
      background: '#1a3128',
      shadow: '0 18px 44px rgba(8, 18, 12, 0.55)',
      radius: '28px',
    },
    glass: {
      background: 'rgba(126, 193, 142, 0.12)',
      border: '1px solid rgba(126, 193, 142, 0.22)',
      shadow: '0 8px 22px rgba(8, 18, 12, 0.4)',
      radius: '24px',
    },
    outlined: { background: 'transparent', border: '1px solid #2c4d3e', radius: '20px' },
    sticker: {
      background: '#1f3a2f',
      border: '1px solid #2c4d3e',
      shadow: '0 6px 0 #08120c, 0 14px 26px rgba(8, 18, 12, 0.45)',
      radius: '24px',
    },
    'editorial-frame': {
      background: 'transparent',
      border: '2px solid #7ec18e',
      radius: '32px',
    },
    'soft-panel': { background: '#172d24', radius: '20px' },
  },
  shapeFill: '#7ec18e',
  shapeStroke: '#9bb4a4',
  shapeStrokeWidth: '1px',
  actionRadius: '999px',
  actionPadding: '12px 22px',
  actionVariants: {
    solid: { background: '#7ec18e', color: '#0f1a14', weight: 600 },
    outline: { background: 'transparent', color: '#e7f3ea', border: '1px solid #7ec18e' },
    ghost: { background: 'transparent', color: '#9bb4a4' },
    pill: { background: '#7ec18e', color: '#0f1a14', weight: 600 },
    glass: {
      background: 'rgba(126, 193, 142, 0.14)',
      color: '#e7f3ea',
      border: '1px solid rgba(126, 193, 142, 0.3)',
    },
    brutalist: {
      background: '#0f1a14',
      color: '#e7f3ea',
      border: '2px solid #7ec18e',
      weight: 700,
    },
    underline: { background: 'transparent', color: '#7ec18e' },
  },
  // Slow drifty — organic kit takes its time.
  motionDurationMs: 620,
  motionEasing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  motionPresets: {
    none: {},
    'fade-up': { transform: 'translateY(18px)', opacity: 0 },
    'slide-left': { transform: 'translateX(28px)', opacity: 0 },
    'scale-in': { transform: 'scale(0.95)', opacity: 0 },
    'blur-in': { opacity: 0 },
    'stagger-children': { transform: 'translateY(12px)', opacity: 0, delayMs: 110 },
    'slow-drift': { transform: 'translateY(0px)' },
    'parallax-soft': { transform: 'translateY(10px)' },
  },
};

// `satisfies` enforces that the literal is a valid `Record<BuiltInStyleKit, ...>`
// AND lets the four field shapes stay precise. `'custom'` (Phase 0 scaffold
// for Wave 2 #10) is NOT a key here — it resolves at render time from
// `CanvasSiteState.customStyleKit` instead.
export const STYLE_KIT_PRESETS: Record<BuiltInStyleKit, StyleKitPreset> = {
  charcoal: CHARCOAL,
  'orange-editorial': ORANGE_EDITORIAL,
  'blue-saas': BLUE_SAAS,
  'green-organic': GREEN_ORGANIC,
} satisfies Record<BuiltInStyleKit, StyleKitPreset>;

// --------------------------------------------------------------------------
// Lookup helper. Fails loudly so a corrupted kit name never silently
// degrades into "the default" — there is no default. The validator already
// rejects unknown kits at the API boundary; this guard is belt-and-braces.
// --------------------------------------------------------------------------

export function getStyleKitPreset(kit: string): StyleKitPreset {
  // Note: 'custom' (Phase 0 scaffold for Wave 2 #10) does not have a row in
  // STYLE_KIT_PRESETS. Callers that may pass 'custom' must check the selector
  // and route through `customStyleKit` before calling this. Calling
  // getStyleKitPreset('custom') is treated as a programming error and throws.
  if (!Object.prototype.hasOwnProperty.call(STYLE_KIT_PRESETS, kit)) {
    throw new Error(
      `getStyleKitPreset: unknown style kit ${JSON.stringify(kit)} — expected one of ${STYLE_KITS.join(', ')}`,
    );
  }
  const preset = STYLE_KIT_PRESETS[kit as BuiltInStyleKit];
  if (preset === undefined) {
    throw new Error(`getStyleKitPreset: preset table missing entry for ${JSON.stringify(kit)}`);
  }
  return preset;
}

// --------------------------------------------------------------------------
// CSS builder — translates the preset table into the CSS that both the
// editor preview and the public renderer ship. One implementation, no drift.
//
// Output shape, per kit:
//
//   [data-style-kit="<kit>"] { --rev01-kit-bg: ...; --rev01-kit-accent: ...; ... }
//   [data-style-kit="<kit>"] [data-element-type="action"][data-variant="X"] { ... }
//   [data-style-kit="<kit>"] [data-element-type="container"][data-variant="X"] { ... }
//   [data-style-kit="<kit>"] [data-element-type="shape"] { ... }
//   [data-style-kit="<kit>"] [data-motion-preset="X"] { ... + @keyframes ... }
//
// The selector deliberately keys off `[data-style-kit]`, `[data-element-type]`,
// and `[data-variant]` — all attributes that the renderer + editor stamp on
// the wrapper. That makes the CSS purely declarative and lets pinned styles
// override per-element via inline `style="..."` without fighting specificity.
//
// Custom-property prefix `--rev01-kit-*` is intentional: it sits beside the
// editor-chrome's `--rev01-*` namespace without colliding. Chrome (topbar,
// inspector, status) uses `--rev01-accent`/`--rev01-bg` for its own dark UI;
// kit consumers read `--rev01-kit-accent`/`--rev01-kit-bg`. The legacy
// `--kit-bg`/`--kit-fg`/`--kit-accent` aliases are also emitted so the
// existing public + editor CSS that references them keeps working.
// --------------------------------------------------------------------------

function quoteCssString(value: string): string {
  // Selectors quote attribute values with double quotes; values inside CSS
  // declarations are emitted as-is. Both callers go through this only when
  // they need an attribute-selector literal.
  return JSON.stringify(value);
}

function declaration(prop: string, value: string | number): string {
  return `${prop}: ${String(value)};`;
}

function buildKitTokenBlock(kitName: BuiltInStyleKit, preset: StyleKitPreset): string {
  // Kit tokens are namespaced `--rev01-kit-*` to keep them off the editor
  // chrome's `--rev01-*` namespace. Editor chrome (src/editor/canvas-styles.ts)
  // sets its own `--rev01-bg`/`--rev01-accent` on :root for the topbar,
  // inspector, and status bar; those are unrelated to the document being
  // edited. Per-kit visuals live entirely behind the `--rev01-kit-*` prefix
  // plus the legacy `--kit-*` aliases that the existing editor / public CSS
  // still references.
  const tokens: string[] = [
    declaration('--rev01-kit-bg', preset.bg),
    declaration('--rev01-kit-panel', preset.panel),
    declaration('--rev01-kit-text', preset.text),
    declaration('--rev01-kit-muted', preset.muted),
    declaration('--rev01-kit-accent', preset.accent),
    declaration('--rev01-kit-accent-text', preset.accentText),
    declaration('--rev01-kit-font-display', preset.fontFamilyDisplay),
    declaration('--rev01-kit-font-body', preset.fontFamilyBody),
    declaration('--rev01-kit-font-mono', preset.fontFamilyMono),
    declaration('--rev01-kit-heading-scale', String(preset.headingScale)),
    declaration('--rev01-kit-body-scale', String(preset.bodyScale)),
    declaration('--rev01-kit-label-scale', String(preset.labelScale)),
    declaration('--rev01-kit-line-height', String(preset.lineHeight)),
    declaration('--rev01-kit-radius', preset.radius),
    declaration('--rev01-kit-border-width', preset.borderWidth),
    declaration('--rev01-kit-shadow', preset.shadow),
    declaration('--rev01-kit-shape-fill', preset.shapeFill),
    declaration('--rev01-kit-shape-stroke', preset.shapeStroke),
    declaration('--rev01-kit-shape-stroke-width', preset.shapeStrokeWidth),
    declaration('--rev01-kit-action-radius', preset.actionRadius),
    declaration('--rev01-kit-action-padding', preset.actionPadding),
    declaration('--rev01-kit-motion-duration', `${String(preset.motionDurationMs)}ms`),
    declaration('--rev01-kit-motion-easing', preset.motionEasing),
    // Legacy `--kit-*` aliases — the editor + public CSS already references
    // these via `var(--kit-bg) / var(--kit-fg) / var(--kit-accent)`. Keeping
    // them aliased to the kit preset means we did not have to touch every
    // single rule. The kit map remains the single source of truth.
    declaration('--kit-bg', preset.bg),
    declaration('--kit-fg', preset.text),
    declaration('--kit-accent', preset.accent),
  ];
  return `[data-style-kit=${quoteCssString(kitName)}] {\n  ${tokens.join('\n  ')}\n}`;
}

function buildActionVariantBlock(
  kitName: BuiltInStyleKit,
  variant: ActionVariant,
  tokens: ActionVariantTokens,
): string {
  const decls: string[] = [];
  if (tokens.background !== undefined) decls.push(declaration('background', tokens.background));
  if (tokens.color !== undefined) decls.push(declaration('color', tokens.color));
  if (tokens.border !== undefined) decls.push(declaration('border', tokens.border));
  if (tokens.weight !== undefined) decls.push(declaration('font-weight', tokens.weight));
  if (decls.length === 0) return '';
  return `[data-style-kit=${quoteCssString(kitName)}] [data-element-type="action"][data-variant=${quoteCssString(variant)}] .rev01-action {\n  ${decls.join('\n  ')}\n}`;
}

function buildSurfaceVariantBlock(
  kitName: BuiltInStyleKit,
  variant: SurfaceVariant,
  tokens: SurfaceVariantTokens,
): string {
  const decls: string[] = [];
  if (tokens.background !== undefined) decls.push(declaration('background', tokens.background));
  if (tokens.border !== undefined) decls.push(declaration('border', tokens.border));
  if (tokens.shadow !== undefined) decls.push(declaration('box-shadow', tokens.shadow));
  if (tokens.radius !== undefined) decls.push(declaration('border-radius', tokens.radius));
  if (decls.length === 0) return '';
  return `[data-style-kit=${quoteCssString(kitName)}] [data-element-type="container"][data-variant=${quoteCssString(variant)}] .rev01-surface {\n  ${decls.join('\n  ')}\n}`;
}

function buildShapeBlock(kitName: BuiltInStyleKit, preset: StyleKitPreset): string {
  return `[data-style-kit=${quoteCssString(kitName)}] [data-element-type="shape"] .rev01-shape {
  background: ${preset.shapeFill};
  border: ${preset.shapeStrokeWidth} solid ${preset.shapeStroke};
}`;
}

function buildMotionKeyframes(): string {
  // One set of keyframes, reused by every kit. Per-kit duration/easing is
  // applied via the [data-motion-preset] selector below. Keyframe names are
  // global (CSS keyframes are not scoped) so the names get a `rev01-` prefix
  // to avoid clashing with anything a future stylesheet might define.
  return `@keyframes rev01-fade-up { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes rev01-slide-left { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes rev01-scale-in { from { transform: scale(0.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes rev01-blur-in { from { filter: blur(8px); opacity: 0; } to { filter: blur(0); opacity: 1; } }
@keyframes rev01-slow-drift { 0% { transform: translateY(0); } 50% { transform: translateY(-6px); } 100% { transform: translateY(0); } }
@keyframes rev01-parallax-soft { from { transform: translateY(6px); } to { transform: translateY(0); } }`;
}

function buildMotionBlock(kitName: BuiltInStyleKit): string {
  // Each preset maps to a CSS animation by name. The kit's duration/easing
  // come from the kit-level token block (already on the wrapper); we only
  // attach the animation name here so a single rule per preset works for
  // every kit. The `--rev01-kit-motion-*` tokens are already set on the
  // wrapper by `buildKitTokenBlock` — no need to redeclare here.
  const presetRules: string[] = [
    `[data-style-kit=${quoteCssString(kitName)}] [data-motion-preset="fade-up"] {\n  animation: rev01-fade-up var(--rev01-kit-motion-duration) var(--rev01-kit-motion-easing) both;\n}`,
    `[data-style-kit=${quoteCssString(kitName)}] [data-motion-preset="slide-left"] {\n  animation: rev01-slide-left var(--rev01-kit-motion-duration) var(--rev01-kit-motion-easing) both;\n}`,
    `[data-style-kit=${quoteCssString(kitName)}] [data-motion-preset="scale-in"] {\n  animation: rev01-scale-in var(--rev01-kit-motion-duration) var(--rev01-kit-motion-easing) both;\n}`,
    `[data-style-kit=${quoteCssString(kitName)}] [data-motion-preset="blur-in"] {\n  animation: rev01-blur-in var(--rev01-kit-motion-duration) var(--rev01-kit-motion-easing) both;\n}`,
    `[data-style-kit=${quoteCssString(kitName)}] [data-motion-preset="parallax-soft"] {\n  animation: rev01-parallax-soft var(--rev01-kit-motion-duration) var(--rev01-kit-motion-easing) both;\n}`,
    `[data-style-kit=${quoteCssString(kitName)}] [data-motion-preset="slow-drift"] {\n  animation: rev01-slow-drift calc(var(--rev01-kit-motion-duration) * 4) ease-in-out infinite;\n}`,
    `[data-style-kit=${quoteCssString(kitName)}] [data-motion-preset="stagger-children"] {\n  animation: rev01-fade-up var(--rev01-kit-motion-duration) var(--rev01-kit-motion-easing) both;\n}`,
  ];
  return presetRules.join('\n');
}

function buildKitBlock(kitName: BuiltInStyleKit, preset: StyleKitPreset): string {
  const parts: string[] = [buildKitTokenBlock(kitName, preset), buildShapeBlock(kitName, preset)];
  for (const variant of ACTION_VARIANTS) {
    const block = buildActionVariantBlock(kitName, variant, preset.actionVariants[variant]);
    if (block) parts.push(block);
  }
  for (const variant of SURFACE_VARIANTS) {
    const block = buildSurfaceVariantBlock(kitName, variant, preset.surfaceVariants[variant]);
    if (block) parts.push(block);
  }
  parts.push(buildMotionBlock(kitName));
  return parts.join('\n');
}

/**
 * Emit the full CSS for every kit, including motion keyframes. Consumed by
 * the editor preview stylesheet and the public renderer's inline <style>
 * block. Output is stable across calls (preset map is frozen at module load).
 */
export function buildAllStyleKitsCss(): string {
  const keyframes = buildMotionKeyframes();
  // Iterate built-in kits only. `'custom'` resolves at render time from
  // `CanvasSiteState.customStyleKit`; emitting a kit-wide CSS block for a
  // value that lives in per-site state would mix layers.
  const kitBlocks = BUILT_IN_STYLE_KITS.map((kit) =>
    buildKitBlock(kit, STYLE_KIT_PRESETS[kit]),
  );
  // Per-element typography uses the kit's font tokens. The display family
  // applies to headings; body to body; label to labels. These rules live at
  // the kit level so role-specific size scales also work (the renderer
  // already emits the absolute fontSize; the scale here is a multiplier so
  // owner-set sizes still respect the kit's modular scale).
  const baseTextRules: string[] = [];
  for (const kit of BUILT_IN_STYLE_KITS) {
    baseTextRules.push(
      `[data-style-kit=${quoteCssString(kit)}] [data-element-type="text"][data-role="heading"] .rev01-text {\n  font-family: var(--rev01-kit-font-display);\n}`,
      `[data-style-kit=${quoteCssString(kit)}] [data-element-type="text"][data-role="body"] .rev01-text {\n  font-family: var(--rev01-kit-font-body);\n  line-height: var(--rev01-kit-line-height);\n}`,
      `[data-style-kit=${quoteCssString(kit)}] [data-element-type="text"][data-role="label"] .rev01-text {\n  font-family: var(--rev01-kit-font-body);\n  letter-spacing: 0.04em;\n}`,
    );
  }
  return [keyframes, baseTextRules.join('\n'), kitBlocks.join('\n')].join('\n');
}
