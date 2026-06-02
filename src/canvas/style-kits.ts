// src/canvas/style-kits.ts
//
// The single source of truth for the deterministic built-in Style Kits.
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
  MotionPreset,
  MotionPresetTokens,
  StyleKitPreset,
  SurfaceVariant,
  SurfaceVariantTokens,
} from './schema.js';
import {
  ACTION_VARIANTS,
  BUILT_IN_STYLE_KITS,
  MOTION_PRESETS,
  STYLE_KITS,
  SURFACE_VARIANTS,
} from './schema.js';

// --------------------------------------------------------------------------
// The kits.
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
    pill: { background: '#d9dde4', color: '#0c0c0d', weight: 600, borderRadius: '999px' },
    glass: {
      background: 'rgba(255, 255, 255, 0.08)',
      color: '#f6f6f6',
      border: '1px solid rgba(255, 255, 255, 0.16)',
      borderRadius: '12px',
      backdropFilter: 'blur(12px)',
    },
    brutalist: {
      background: '#0c0c0d',
      color: '#f6f6f6',
      border: '2px solid #f6f6f6',
      weight: 700,
      borderRadius: '0px',
      boxShadow: '4px 4px 0 #f6f6f6',
    },
    underline: {
      background: 'transparent',
      color: '#f6f6f6',
      textDecoration: 'underline',
      borderRadius: '0px',
      padding: '0',
    },
  },
  // Snappy motion — charcoal leans modern + technical.
  motionDurationMs: 320,
  motionEasing: 'cubic-bezier(0.2, 0.0, 0.0, 1.0)',
  motionPresets: {
    none: {},
    'fade-up': { transform: 'translateY(12px)', opacity: 0 },
    'fade-down': { transform: 'translateY(-12px)', opacity: 0 },
    'fade-in': { opacity: 0 },
    'fade-right': { transform: 'translateX(-12px)', opacity: 0 },
    'slide-left': { transform: 'translateX(20px)', opacity: 0 },
    'slide-up': { transform: 'translateY(20px)' },
    'slide-right': { transform: 'translateX(-20px)' },
    'scale-in': { transform: 'scale(0.96)', opacity: 0 },
    'zoom-out': { transform: 'scale(1.08)', opacity: 0 },
    'blur-in': { opacity: 0 },
    'rotate-in': { transform: 'rotate(-6deg) scale(0.95)', opacity: 0 },
    'flip-in': { transform: 'perspective(600px) rotateY(90deg)', opacity: 0 },
    'bounce-in': { transform: 'scale(0.6)', opacity: 0 },
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
    pill: { background: '#221610', color: '#fff7ef', weight: 700, borderRadius: '999px' },
    glass: {
      background: 'rgba(255, 247, 239, 0.55)',
      color: '#221610',
      border: '2px solid #221610',
      borderRadius: '8px',
      backdropFilter: 'blur(12px)',
    },
    brutalist: {
      background: '#fff7ef',
      color: '#221610',
      border: '3px solid #221610',
      weight: 800,
      borderRadius: '0px',
      boxShadow: '6px 6px 0 #221610',
    },
    underline: {
      background: 'transparent',
      color: '#221610',
      textDecoration: 'underline',
      borderRadius: '0px',
      padding: '0',
    },
  },
  // Editorial = snappy, with character.
  motionDurationMs: 280,
  motionEasing: 'cubic-bezier(0.4, 0.0, 0.2, 1.0)',
  motionPresets: {
    none: {},
    'fade-up': { transform: 'translateY(16px)', opacity: 0 },
    'fade-down': { transform: 'translateY(-16px)', opacity: 0 },
    'fade-in': { opacity: 0 },
    'fade-right': { transform: 'translateX(-16px)', opacity: 0 },
    'slide-left': { transform: 'translateX(24px)', opacity: 0 },
    'slide-up': { transform: 'translateY(24px)' },
    'slide-right': { transform: 'translateX(-24px)' },
    'scale-in': { transform: 'scale(0.94)', opacity: 0 },
    'zoom-out': { transform: 'scale(1.1)', opacity: 0 },
    'blur-in': { opacity: 0 },
    'rotate-in': { transform: 'rotate(-8deg) scale(0.93)', opacity: 0 },
    'flip-in': { transform: 'perspective(600px) rotateY(90deg)', opacity: 0 },
    'bounce-in': { transform: 'scale(0.55)', opacity: 0 },
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
    pill: { background: '#5b8def', color: '#0b1530', weight: 600, borderRadius: '999px' },
    glass: {
      background: 'rgba(91, 141, 239, 0.14)',
      color: '#e8efff',
      border: '1px solid rgba(91, 141, 239, 0.3)',
      borderRadius: '14px',
      backdropFilter: 'blur(12px)',
    },
    brutalist: {
      background: '#0b1530',
      color: '#e8efff',
      border: '2px solid #5b8def',
      weight: 700,
      borderRadius: '0px',
      boxShadow: '4px 4px 0 #5b8def',
    },
    underline: {
      background: 'transparent',
      color: '#5b8def',
      textDecoration: 'underline',
      borderRadius: '0px',
      padding: '0',
    },
  },
  // Soft motion — modern SaaS, medium pace.
  motionDurationMs: 420,
  motionEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  motionPresets: {
    none: {},
    'fade-up': { transform: 'translateY(14px)', opacity: 0 },
    'fade-down': { transform: 'translateY(-14px)', opacity: 0 },
    'fade-in': { opacity: 0 },
    'fade-right': { transform: 'translateX(-14px)', opacity: 0 },
    'slide-left': { transform: 'translateX(22px)', opacity: 0 },
    'slide-up': { transform: 'translateY(22px)' },
    'slide-right': { transform: 'translateX(-22px)' },
    'scale-in': { transform: 'scale(0.97)', opacity: 0 },
    'zoom-out': { transform: 'scale(1.06)', opacity: 0 },
    'blur-in': { opacity: 0 },
    'rotate-in': { transform: 'rotate(-5deg) scale(0.96)', opacity: 0 },
    'flip-in': { transform: 'perspective(600px) rotateY(90deg)', opacity: 0 },
    'bounce-in': { transform: 'scale(0.65)', opacity: 0 },
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
    pill: { background: '#7ec18e', color: '#0f1a14', weight: 600, borderRadius: '999px' },
    glass: {
      background: 'rgba(126, 193, 142, 0.14)',
      color: '#e7f3ea',
      border: '1px solid rgba(126, 193, 142, 0.3)',
      borderRadius: '16px',
      backdropFilter: 'blur(12px)',
    },
    brutalist: {
      background: '#0f1a14',
      color: '#e7f3ea',
      border: '2px solid #7ec18e',
      weight: 700,
      borderRadius: '0px',
      boxShadow: '4px 4px 0 #7ec18e',
    },
    underline: {
      background: 'transparent',
      color: '#7ec18e',
      textDecoration: 'underline',
      borderRadius: '0px',
      padding: '0',
    },
  },
  // Slow drifty — organic kit takes its time.
  motionDurationMs: 620,
  motionEasing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  motionPresets: {
    none: {},
    'fade-up': { transform: 'translateY(18px)', opacity: 0 },
    'fade-down': { transform: 'translateY(-18px)', opacity: 0 },
    'fade-in': { opacity: 0 },
    'fade-right': { transform: 'translateX(-18px)', opacity: 0 },
    'slide-left': { transform: 'translateX(28px)', opacity: 0 },
    'slide-up': { transform: 'translateY(28px)' },
    'slide-right': { transform: 'translateX(-28px)' },
    'scale-in': { transform: 'scale(0.95)', opacity: 0 },
    'zoom-out': { transform: 'scale(1.12)', opacity: 0 },
    'blur-in': { opacity: 0 },
    'rotate-in': { transform: 'rotate(-4deg) scale(0.94)', opacity: 0 },
    'flip-in': { transform: 'perspective(600px) rotateY(90deg)', opacity: 0 },
    'bounce-in': { transform: 'scale(0.7)', opacity: 0 },
    'stagger-children': { transform: 'translateY(12px)', opacity: 0, delayMs: 110 },
    'slow-drift': { transform: 'translateY(0px)' },
    'parallax-soft': { transform: 'translateY(10px)' },
  },
};

const IVORY_PRESS: StyleKitPreset = {
  bg: '#F5EFE3',
  panel: '#FBF7EE',
  text: '#1A1916',
  muted: '#6E665A',
  accent: '#9C3520',
  accentText: '#FBF7EE',
  fontFamilyDisplay: "'EB Garamond', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
  fontFamilyBody: "'Inter', system-ui, -apple-system, sans-serif",
  fontFamilyMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  headingScale: 1.18,
  bodyScale: 1.02,
  labelScale: 0.82,
  lineHeight: 1.6,
  radius: '4px',
  borderWidth: '1px',
  // Hairline warm shadow — paper, not pillow.
  shadow: '0 1px 2px rgba(26, 25, 22, 0.05), 0 14px 36px rgba(26, 25, 22, 0.06)',
  surfaceVariants: {
    flat: { background: '#FBF7EE', shadow: 'none', radius: '4px' },
    raised: {
      background: '#FFFEFA',
      border: '1px solid rgba(26, 25, 22, 0.06)',
      shadow: '0 1px 2px rgba(26, 25, 22, 0.04), 0 18px 44px rgba(26, 25, 22, 0.07)',
      radius: '6px',
    },
    glass: {
      background: 'rgba(255, 254, 250, 0.62)',
      border: '1px solid rgba(26, 25, 22, 0.08)',
      shadow: '0 8px 24px rgba(26, 25, 22, 0.05)',
      radius: '4px',
    },
    outlined: { background: 'transparent', border: '1px solid rgba(26, 25, 22, 0.14)', radius: '4px' },
    sticker: {
      background: '#FFFEFA',
      border: '1px solid rgba(26, 25, 22, 0.10)',
      // Soft stamp offset — print artifact, not drop shadow.
      shadow: '4px 4px 0 rgba(26, 25, 22, 0.08), 0 1px 2px rgba(26, 25, 22, 0.04)',
      radius: '6px',
    },
    'editorial-frame': {
      background: 'transparent',
      border: '2px solid #9C3520',
      radius: '0px',
    },
    'soft-panel': { background: '#F0E9DA', shadow: '0 1px 0 rgba(26, 25, 22, 0.04) inset' },
  },
  shapeFill: '#9C3520',
  shapeStroke: '#6E665A',
  shapeStrokeWidth: '1px',
  actionRadius: '4px',
  actionPadding: '12px 22px',
  actionVariants: {
    solid: { background: '#1A1916', color: '#FBF7EE', weight: 600 },
    outline: { background: 'transparent', color: '#1A1916', border: '1px solid #1A1916', weight: 500 },
    ghost: { background: 'transparent', color: '#1A1916' },
    pill: { background: '#9C3520', color: '#FBF7EE', weight: 600, borderRadius: '999px' },
    glass: {
      background: 'rgba(255, 254, 250, 0.7)',
      color: '#1A1916',
      border: '1px solid rgba(26, 25, 22, 0.10)',
      borderRadius: '4px',
      backdropFilter: 'blur(12px)',
    },
    brutalist: {
      background: '#1A1916',
      color: '#FBF7EE',
      border: '2px solid #1A1916',
      weight: 700,
      borderRadius: '0px',
      boxShadow: '4px 4px 0 #9C3520',
    },
    underline: {
      background: 'transparent',
      color: '#9C3520',
      textDecoration: 'underline',
      borderRadius: '0px',
      padding: '0',
    },
  },
  // Medium-paced — editorial reads, doesn't sprint.
  motionDurationMs: 380,
  motionEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  motionPresets: {
    none: {},
    'fade-up': { transform: 'translateY(14px)', opacity: 0 },
    'fade-down': { transform: 'translateY(-14px)', opacity: 0 },
    'fade-in': { opacity: 0 },
    'fade-right': { transform: 'translateX(-14px)', opacity: 0 },
    'slide-left': { transform: 'translateX(22px)', opacity: 0 },
    'slide-up': { transform: 'translateY(22px)' },
    'slide-right': { transform: 'translateX(-22px)' },
    'scale-in': { transform: 'scale(0.97)', opacity: 0 },
    'zoom-out': { transform: 'scale(1.06)', opacity: 0 },
    'blur-in': { opacity: 0 },
    'rotate-in': { transform: 'rotate(-4deg) scale(0.97)', opacity: 0 },
    'flip-in': { transform: 'perspective(600px) rotateY(90deg)', opacity: 0 },
    'bounce-in': { transform: 'scale(0.7)', opacity: 0 },
    'stagger-children': { transform: 'translateY(10px)', opacity: 0, delayMs: 80 },
    'slow-drift': { transform: 'translateY(0px)' },
    'parallax-soft': { transform: 'translateY(6px)' },
  },
};

const MIDNIGHT_VIOLET: StyleKitPreset = {
  bg: '#0A0815',
  panel: '#140F25',
  text: '#EFEAFF',
  muted: '#8C82B5',
  accent: '#C04CFF',
  accentText: '#0A0815',
  fontFamilyDisplay: "'Inter Tight', 'Inter', system-ui, -apple-system, sans-serif",
  fontFamilyBody: "'Inter', system-ui, -apple-system, sans-serif",
  fontFamilyMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  headingScale: 1.05,
  bodyScale: 0.96,
  labelScale: 0.82,
  lineHeight: 1.5,
  radius: '14px',
  borderWidth: '1px',
  // Violet glow + deep shadow — modern indie product.
  shadow: '0 8px 28px rgba(192, 76, 255, 0.18), 0 18px 48px rgba(0, 0, 0, 0.55)',
  surfaceVariants: {
    flat: { background: '#140F25', shadow: 'none', radius: '14px' },
    raised: {
      background: '#1B1530',
      border: '1px solid rgba(192, 76, 255, 0.10)',
      shadow: '0 10px 32px rgba(192, 76, 255, 0.14), 0 22px 56px rgba(0, 0, 0, 0.6)',
      radius: '18px',
    },
    glass: {
      background: 'rgba(192, 76, 255, 0.08)',
      border: '1px solid rgba(192, 76, 255, 0.22)',
      shadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
      radius: '14px',
    },
    outlined: {
      background: 'transparent',
      border: '1px solid rgba(192, 76, 255, 0.24)',
      radius: '14px',
    },
    sticker: {
      background: '#1B1530',
      border: '1px solid rgba(192, 76, 255, 0.30)',
      shadow: '0 4px 0 rgba(192, 76, 255, 0.35), 0 14px 32px rgba(0, 0, 0, 0.5)',
      radius: '14px',
    },
    'editorial-frame': {
      background: 'transparent',
      border: '2px solid #C04CFF',
      radius: '4px',
    },
    'soft-panel': {
      background: '#100B1F',
      shadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
    },
  },
  shapeFill: '#C04CFF',
  shapeStroke: '#8C82B5',
  shapeStrokeWidth: '1px',
  actionRadius: '12px',
  actionPadding: '12px 22px',
  actionVariants: {
    solid: { background: '#C04CFF', color: '#0A0815', weight: 600 },
    outline: { background: 'transparent', color: '#EFEAFF', border: '1px solid #C04CFF', weight: 500 },
    ghost: { background: 'transparent', color: '#EFEAFF' },
    pill: { background: '#C04CFF', color: '#0A0815', weight: 600, borderRadius: '999px' },
    glass: {
      background: 'rgba(192, 76, 255, 0.14)',
      color: '#EFEAFF',
      border: '1px solid rgba(192, 76, 255, 0.30)',
      borderRadius: '14px',
      backdropFilter: 'blur(12px)',
    },
    brutalist: {
      background: '#0A0815',
      color: '#C04CFF',
      border: '2px solid #C04CFF',
      weight: 700,
      borderRadius: '0px',
      boxShadow: '4px 4px 0 #C04CFF',
    },
    underline: {
      background: 'transparent',
      color: '#C04CFF',
      textDecoration: 'underline',
      borderRadius: '0px',
      padding: '0',
    },
  },
  // Smooth modern — out-quart for product feel.
  motionDurationMs: 400,
  motionEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  motionPresets: {
    none: {},
    'fade-up': { transform: 'translateY(14px)', opacity: 0 },
    'fade-down': { transform: 'translateY(-14px)', opacity: 0 },
    'fade-in': { opacity: 0 },
    'fade-right': { transform: 'translateX(-14px)', opacity: 0 },
    'slide-left': { transform: 'translateX(22px)', opacity: 0 },
    'slide-up': { transform: 'translateY(22px)' },
    'slide-right': { transform: 'translateX(-22px)' },
    'scale-in': { transform: 'scale(0.96)', opacity: 0 },
    'zoom-out': { transform: 'scale(1.08)', opacity: 0 },
    'blur-in': { opacity: 0 },
    'rotate-in': { transform: 'rotate(-5deg) scale(0.95)', opacity: 0 },
    'flip-in': { transform: 'perspective(600px) rotateY(90deg)', opacity: 0 },
    'bounce-in': { transform: 'scale(0.65)', opacity: 0 },
    'stagger-children': { transform: 'translateY(10px)', opacity: 0, delayMs: 70 },
    'slow-drift': { transform: 'translateY(0px)' },
    'parallax-soft': { transform: 'translateY(8px)' },
  },
};

// The exported registry is the public contract consumers index into.
// `'custom'` is NOT a key here —
// it resolves at render time from `EditableSite.customStyleKit` instead.
export const STYLE_KIT_PRESETS: Record<BuiltInStyleKit, StyleKitPreset> = {
  charcoal: CHARCOAL,
  'orange-editorial': ORANGE_EDITORIAL,
  'blue-saas': BLUE_SAAS,
  'green-organic': GREEN_ORGANIC,
  'ivory-press': IVORY_PRESS,
  'midnight-violet': MIDNIGHT_VIOLET,
};

// --------------------------------------------------------------------------
// Lookup helper. Fails loudly so a corrupted kit name never silently
// degrades into "the default" — there is no default. The validator already
// rejects unknown kits at the API boundary; this guard is belt-and-braces.
// --------------------------------------------------------------------------

export function getStyleKitPreset(kit: string): StyleKitPreset {
  // `'custom'` is not a key in STYLE_KIT_PRESETS — callers that may see it
  // route through `resolveStyleKitWithCustom(state)` instead. Calling
  // `getStyleKitPreset('custom')` is treated as a programming error and throws.
  if (!Object.prototype.hasOwnProperty.call(STYLE_KIT_PRESETS, kit)) {
    throw new Error(
      `getStyleKitPreset: unknown style kit ${JSON.stringify(kit)} — expected one of ${STYLE_KITS.join(', ')}`,
    );
  }
  return STYLE_KIT_PRESETS[kit as BuiltInStyleKit];
}

// --------------------------------------------------------------------------
// `'custom'` dispatch slot.
//
// The custom-kit resolver lives in `src/themes/custom-resolve.ts` so the
// runtime validator + the editor panel can share one source of truth. We
// re-export it here so callers that already import from this module can
// route `'custom'` through the same dispatch as built-ins. The re-export
// IS a dependency on `src/themes/` — callers that need to avoid pulling
// `custom-resolve` transitively must import it from its source module
// instead. `getStyleKitPreset(kit: string)` keeps its
// 'custom-is-a-programming-error' contract; callers that may see `'custom'`
// switch to `resolveStyleKitWithCustom(state)` instead.
// --------------------------------------------------------------------------

export { resolveStyleKitWithCustom } from '../themes/custom-resolve.js';

// --------------------------------------------------------------------------
// CSS builder — translates the preset table into the CSS that both the
// editor preview and the public renderer ship. One implementation, no drift.
//
// Output shape, per kit:
//
//   [data-style-kit="<kit>"] { --opencanvas-kit-bg: ...; --opencanvas-kit-accent: ...; ... }
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
// Custom-property prefix `--opencanvas-kit-*` is intentional: it sits beside the
// editor-chrome's `--opencanvas-*` namespace without colliding. Chrome (header,
// inspector, status) uses `--opencanvas-accent`/`--opencanvas-bg` for its own dark UI;
// kit consumers read `--opencanvas-kit-accent`/`--opencanvas-kit-bg`. The legacy
// `--kit-bg`/`--kit-fg`/`--kit-accent` aliases are also emitted so the
// existing public + editor CSS that references them keeps working.
// --------------------------------------------------------------------------

function quoteCssString(value: string): string {
  // Safe only because every kit + preset name we pass is kebab-case ASCII;
  // JSON.stringify is not a full CSS string-token escaper.
  return JSON.stringify(value);
}

function declaration(prop: string, value: string | number): string {
  return `${prop}: ${String(value)};`;
}

function buildKitTokenBlock(kitName: string, preset: StyleKitPreset): string {
  // Kit tokens are namespaced `--opencanvas-kit-*` to keep them off the editor
  // chrome's `--opencanvas-*` namespace. Editor chrome (src/editor/canvas-styles.ts)
  // sets its own `--opencanvas-bg`/`--opencanvas-accent` on :root for the header,
  // inspector, and status bar; those are unrelated to the document being
  // edited. Per-kit visuals live entirely behind the `--opencanvas-kit-*` prefix
  // plus the legacy `--kit-*` aliases that the existing editor / public CSS
  // still references.
  const tokens: string[] = [
    declaration('--opencanvas-kit-bg', preset.bg),
    declaration('--opencanvas-kit-panel', preset.panel),
    declaration('--opencanvas-kit-text', preset.text),
    declaration('--opencanvas-kit-muted', preset.muted),
    declaration('--opencanvas-kit-accent', preset.accent),
    declaration('--opencanvas-kit-accent-text', preset.accentText),
    declaration('--opencanvas-kit-font-display', preset.fontFamilyDisplay),
    declaration('--opencanvas-kit-font-body', preset.fontFamilyBody),
    declaration('--opencanvas-kit-font-mono', preset.fontFamilyMono),
    declaration('--opencanvas-kit-heading-scale', String(preset.headingScale)),
    declaration('--opencanvas-kit-body-scale', String(preset.bodyScale)),
    declaration('--opencanvas-kit-label-scale', String(preset.labelScale)),
    declaration('--opencanvas-kit-line-height', String(preset.lineHeight)),
    declaration('--opencanvas-kit-radius', preset.radius),
    declaration('--opencanvas-kit-border-width', preset.borderWidth),
    declaration('--opencanvas-kit-shadow', preset.shadow),
    declaration('--opencanvas-kit-shape-fill', preset.shapeFill),
    declaration('--opencanvas-kit-shape-stroke', preset.shapeStroke),
    declaration('--opencanvas-kit-shape-stroke-width', preset.shapeStrokeWidth),
    declaration('--opencanvas-kit-action-radius', preset.actionRadius),
    declaration('--opencanvas-kit-action-padding', preset.actionPadding),
    declaration('--opencanvas-kit-motion-duration', `${String(preset.motionDurationMs)}ms`),
    declaration('--opencanvas-kit-motion-easing', preset.motionEasing),
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
  kitName: string,
  variant: ActionVariant,
  tokens: ActionVariantTokens,
): string {
  const decls: string[] = [];
  if (tokens.background !== undefined) decls.push(declaration('background', tokens.background));
  if (tokens.color !== undefined) decls.push(declaration('color', tokens.color));
  if (tokens.border !== undefined) decls.push(declaration('border', tokens.border));
  if (tokens.weight !== undefined) decls.push(declaration('font-weight', tokens.weight));
  if (tokens.borderRadius !== undefined) decls.push(declaration('border-radius', tokens.borderRadius));
  if (tokens.textDecoration !== undefined) decls.push(declaration('text-decoration', tokens.textDecoration));
  if (tokens.backdropFilter !== undefined) decls.push(declaration('backdrop-filter', tokens.backdropFilter));
  if (tokens.boxShadow !== undefined) decls.push(declaration('box-shadow', tokens.boxShadow));
  if (tokens.padding !== undefined) decls.push(declaration('padding', tokens.padding));
  if (tokens.letterSpacing !== undefined) decls.push(declaration('letter-spacing', tokens.letterSpacing));
  if (decls.length === 0) return '';
  return `[data-style-kit=${quoteCssString(kitName)}] [data-element-type="action"][data-variant=${quoteCssString(variant)}] .opencanvas-action {\n  ${decls.join('\n  ')}\n}`;
}

function buildSurfaceVariantBlock(
  kitName: string,
  variant: SurfaceVariant,
  tokens: SurfaceVariantTokens,
): string {
  const decls: string[] = [];
  if (tokens.background !== undefined) decls.push(declaration('background', tokens.background));
  if (tokens.border !== undefined) decls.push(declaration('border', tokens.border));
  if (tokens.shadow !== undefined) decls.push(declaration('box-shadow', tokens.shadow));
  if (tokens.radius !== undefined) decls.push(declaration('border-radius', tokens.radius));
  if (decls.length === 0) return '';
  return `[data-style-kit=${quoteCssString(kitName)}] [data-element-type="container"][data-variant=${quoteCssString(variant)}] .opencanvas-surface {\n  ${decls.join('\n  ')}\n}`;
}

function buildShapeBlock(kitName: string, preset: StyleKitPreset): string {
  return `[data-style-kit=${quoteCssString(kitName)}] [data-element-type="shape"] .opencanvas-shape {
  background: ${preset.shapeFill};
  border: ${preset.shapeStrokeWidth} solid ${preset.shapeStroke};
}`;
}

// Motion presets that share the simple "from kit tokens → identity resting
// state" shape. Everything else (`none`, the multi-stop `bounce-in`, the
// continuous-loop `slow-drift`, the entrance-with-amplitude `parallax-soft`,
// the reuses-fade-up `stagger-children`) is special-cased below.
//
// The resting `opacity` reads `--opencanvas-element-opacity` (set by the
// renderer when `elementStyle.opacity` is present) so an entrance with
// `animation-fill-mode: both` doesn't pin the wrapper at opacity:1 and
// silently override an authored 0.3. var()'s fallback is 1, so elements
// without an explicit opacity behave identically to before.
const MOTION_ENTRANCE_RESTING_STATE: Record<string, string> = {
  'fade-up': 'transform: translateY(0); opacity: var(--opencanvas-element-opacity, 1);',
  'fade-down': 'transform: translateY(0); opacity: var(--opencanvas-element-opacity, 1);',
  'fade-in': 'opacity: var(--opencanvas-element-opacity, 1);',
  'fade-right': 'transform: translateX(0); opacity: var(--opencanvas-element-opacity, 1);',
  'slide-left': 'transform: translateX(0); opacity: var(--opencanvas-element-opacity, 1);',
  'slide-up': 'transform: translateY(0);',
  'slide-right': 'transform: translateX(0);',
  'scale-in': 'transform: scale(1); opacity: var(--opencanvas-element-opacity, 1);',
  'zoom-out': 'transform: scale(1); opacity: var(--opencanvas-element-opacity, 1);',
  // `blur-in`'s filter dimension isn't expressible in `MotionPresetTokens`;
  // the blur(8px) initial AND blur(0) resting are hardcoded here.
  'blur-in': 'filter: blur(0); opacity: var(--opencanvas-element-opacity, 1);',
  'rotate-in': 'transform: rotate(0) scale(1); opacity: var(--opencanvas-element-opacity, 1);',
  'flip-in': 'transform: perspective(600px) rotateY(0); opacity: var(--opencanvas-element-opacity, 1);',
};

function buildEntranceKeyframe(ns: string, preset: MotionPreset, tokens: MotionPresetTokens): string {
  const fromParts: string[] = [];
  if (tokens.transform !== undefined) fromParts.push(`transform: ${tokens.transform};`);
  if (tokens.opacity !== undefined) fromParts.push(`opacity: ${String(tokens.opacity)};`);
  // `blur-in` always starts blurred regardless of kit — the schema's
  // `MotionPresetTokens` has no filter field, so the blur amount lives here.
  if (preset === 'blur-in') fromParts.push('filter: blur(8px);');
  const resting = MOTION_ENTRANCE_RESTING_STATE[preset];
  if (resting === undefined) {
    throw new Error(`buildEntranceKeyframe: no resting state for ${preset}`);
  }
  return `@keyframes ${ns}-${preset} { from { ${fromParts.join(' ')} } to { ${resting} } }`;
}

function buildMotionKeyframes(kitName: string, preset: StyleKitPreset): string {
  // Per-kit keyframes named `opencanvas-<kit>-<preset>`. Each kit's
  // `motionPresets[p]` seeds the initial state so each kit's declared
  // amplitude (charcoal translateY(12px) vs orange translateY(16px) vs
  // green translateY(18px) …) actually takes effect.
  const ns = `opencanvas-${kitName}`;
  const blocks: string[] = [];
  for (const p of MOTION_PRESETS) {
    if (p === 'none') continue;
    if (p === 'stagger-children') continue; // Reuses the kit's fade-up keyframe.
    if (p === 'bounce-in') continue;
    if (p === 'slow-drift') continue;
    if (p === 'parallax-soft') continue;
    blocks.push(buildEntranceKeyframe(ns, p, preset.motionPresets[p]));
  }
  // `bounce-in`: 4-stop overshoot. Initial scale comes from the kit;
  // 60%/80% overshoot stops are intrinsic to the preset's character.
  const bounceFrom = preset.motionPresets['bounce-in'].transform ?? 'scale(0.6)';
  blocks.push(
    `@keyframes ${ns}-bounce-in { 0% { transform: ${bounceFrom}; opacity: 0; } 60% { transform: scale(1.12); opacity: var(--opencanvas-element-opacity, 1); } 80% { transform: scale(0.95); } 100% { transform: scale(1); } }`,
  );
  // `slow-drift`: continuous loop. The data seeds `translateY(0px)` across
  // all four built-in kits (the resting centre of the drift); the loop
  // amplitude (-6px peak) is fixed because the effect is by definition
  // subtle and uniform.
  blocks.push(
    `@keyframes ${ns}-slow-drift { 0% { transform: translateY(0); } 50% { transform: translateY(-6px); } 100% { transform: translateY(0); } }`,
  );
  // `parallax-soft`: gentle entrance offset. Initial Y derived from the
  // kit so each kit's parallax amplitude actually differs in the output.
  const parallaxFrom = preset.motionPresets['parallax-soft'].transform ?? 'translateY(6px)';
  blocks.push(
    `@keyframes ${ns}-parallax-soft { from { transform: ${parallaxFrom}; } to { transform: translateY(0); } }`,
  );
  return blocks.join('\n');
}

function buildMotionBlock(kitName: string): string {
  // Each preset attaches its kit-namespaced keyframe. Duration + easing come
  // from `--opencanvas-kit-motion-*` tokens already set on the wrapper by
  // `buildKitTokenBlock`. Three presets deviate from the kit-default cadence:
  //   - `bounce-in` overrides easing with an overshoot curve (the
  //     definition of "bounce").
  //   - `slow-drift` is a continuous loop, not an entrance: it runs longer
  //     (calc(dur * 4)) on a symmetric ease.
  //   - `stagger-children` reuses the kit's fade-up keyframe; the
  //     between-child delay is wired at the call site, not in the keyframe.
  const sk = quoteCssString(kitName);
  const ns = `opencanvas-${kitName}`;
  const dur = 'var(--opencanvas-kit-motion-duration)';
  const eas = 'var(--opencanvas-kit-motion-easing)';
  // Per-element animation-delay is driven by the `--opencanvas-motion-delay`
  // custom property the renderer sets on the wrapper from
  // element.motion.delayMs. Without this, the `data-motion-delay-ms`
  // attribute was set but no CSS ever consumed it, so all entrance
  // animations on a page fired simultaneously (and the editor's
  // "Replay all animations" looked broken because everything finished in
  // one ~300ms flash instead of staggering across the page).
  const dly = 'var(--opencanvas-motion-delay, 0s)';
  const entranceRule = (p: MotionPreset): string =>
    `[data-style-kit=${sk}] [data-motion-preset="${p}"] {\n  animation: ${ns}-${p} ${dur} ${eas} ${dly} both;\n}`;
  const rules: string[] = [];
  for (const p of MOTION_PRESETS) {
    if (p === 'none') continue;
    if (p === 'bounce-in') continue;
    if (p === 'stagger-children') continue;
    if (p === 'slow-drift') continue;
    if (p === 'parallax-soft') continue;
    rules.push(entranceRule(p));
  }
  // Emit the four trailing presets in canonical schema order
  // (bounce-in, stagger-children, slow-drift, parallax-soft) so the CSS
  // cascade matches `MOTION_PRESETS` exactly.
  rules.push(
    `[data-style-kit=${sk}] [data-motion-preset="bounce-in"] {\n  animation: ${ns}-bounce-in ${dur} ${eas} ${dly} both;\n  animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);\n}`,
  );
  rules.push(
    `[data-style-kit=${sk}] [data-motion-preset="stagger-children"] {\n  animation: ${ns}-fade-up ${dur} ${eas} ${dly} both;\n}`,
  );
  rules.push(
    `[data-style-kit=${sk}] [data-motion-preset="slow-drift"] {\n  animation: ${ns}-slow-drift calc(${dur} * 4) ease-in-out ${dly} infinite;\n}`,
  );
  rules.push(entranceRule('parallax-soft'));
  return rules.join('\n');
}

function buildTextRules(kitName: string): string {
  // Per-role font + line-height. Labels reuse the body font but get loosened
  // tracking — eyebrow / overline labels are typically rendered at small
  // sizes and the extra letter-spacing keeps them legible at that scale.
  const sk = quoteCssString(kitName);
  return [
    `[data-style-kit=${sk}] [data-element-type="text"][data-role="heading"] .opencanvas-text {\n  font-family: var(--opencanvas-kit-font-display);\n}`,
    `[data-style-kit=${sk}] [data-element-type="text"][data-role="body"] .opencanvas-text {\n  font-family: var(--opencanvas-kit-font-body);\n  line-height: var(--opencanvas-kit-line-height);\n}`,
    `[data-style-kit=${sk}] [data-element-type="text"][data-role="label"] .opencanvas-text {\n  font-family: var(--opencanvas-kit-font-body);\n  letter-spacing: 0.04em;\n}`,
  ].join('\n');
}

function buildKitBlock(kitName: string, preset: StyleKitPreset): string {
  const parts: string[] = [
    buildKitTokenBlock(kitName, preset),
    buildShapeBlock(kitName, preset),
    buildTextRules(kitName),
  ];
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
 * Emit CSS for one concrete kit name and preset, including its own motion
 * keyframes. Built-in kit CSS is emitted through `buildAllStyleKitsCss`;
 * public visitor responses use this helper to append the per-site custom
 * kit block when `styleKit === 'custom'`.
 */
export function buildStyleKitCss(kitName: string, preset: StyleKitPreset): string {
  // Empty kit name would produce `[data-style-kit=""]` selectors — those
  // match nothing the renderer stamps, so the page would silently render
  // without kit styling. Fail loudly instead.
  if (kitName.length === 0) {
    throw new Error('buildStyleKitCss: kitName must be non-empty');
  }
  return [buildMotionKeyframes(kitName, preset), buildKitBlock(kitName, preset)].join('\n');
}

/**
 * Emit the full CSS for every built-in kit, including per-kit motion
 * keyframes. Consumed by the editor preview stylesheet and the public
 * renderer's inline <style> block. Output is stable across calls (preset
 * map is frozen at module load).
 */
export function buildAllStyleKitsCss(): string {
  // Iterate built-in kits only. `'custom'` resolves at render time from
  // `EditableSite.customStyleKit`; emitting a kit-wide CSS block for a
  // value that lives in per-site state would mix layers.
  const keyframes = BUILT_IN_STYLE_KITS.map((kit) =>
    buildMotionKeyframes(kit, STYLE_KIT_PRESETS[kit]),
  );
  const kitBlocks = BUILT_IN_STYLE_KITS.map((kit) => buildKitBlock(kit, STYLE_KIT_PRESETS[kit]));
  return [...keyframes, ...kitBlocks].join('\n');
}
