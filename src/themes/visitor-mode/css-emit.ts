// src/themes/visitor-mode/css-emit.ts
//
// Dual-mode CSS emitter. Produces a small CSS string with two blocks:
//
//   :root { ... light tokens ... }
//   :root[data-mode="dark"] { ... dark tokens ... }
//
// This is in ADDITION TO the per-kit CSS that `buildAllStyleKitsCss()`
// already emits — that one is keyed by `[data-style-kit="<kit>"]` and is
// mode-agnostic (it emits a single light-only token block per built-in).
// The dual-mode CSS here lifts the ACTIVE kit's tokens to the `:root` level
// so the toggle can flip them without re-running the per-kit selector
// machinery. The two layers stack: the per-kit block sets tokens on the
// kit-wrapped subtree; this block sets them on `:root` so any descendant
// that reads `var(--rev01-kit-*)` sees the mode-appropriate value.
//
// Why :root, not the kit-wrapped subtree:
//   - Cascade simplicity. `:root[data-mode="dark"]` is one selector; flipping
//     it has zero specificity surprises for downstream rules.
//   - First-paint correctness. The early mode-setter script stamps `data-mode`
//     on `<html>` (i.e. `:root`) BEFORE the visitor's paint engine reads
//     custom properties. Targeting `:root[data-mode="dark"]` means the dark
//     tokens are already winning at first paint.
//
// We only emit the dark block when the resolved kit actually has a dark
// variant (either via `kit.dark` directly, or via the sibling built-in
// dark table). If neither is present, the dark block is structurally equal
// to the light block — the emitter still produces both so the toggle stays
// a no-op visually instead of a no-op-with-bug (i.e. the visitor toggles
// and sees nothing change, which is the documented contract for a kit
// without a dark variant).

import type { StyleKitPreset } from '../../canvas/schema.js';

import { resolveStyleKitForMode, withBuiltInDark } from './resolve.js';

/**
 * Emit the dual-mode token CSS for a given Style Kit. Pass the active kit
 * already resolved to its preset (built-in or custom). `kitId` is used to
 * consult the built-in dark sidecar; pass the kit's `'custom'` selector
 * value for a custom kit (the sidecar returns undefined for unknown ids, so
 * `'custom'` correctly opts out of built-in dark fallback).
 *
 * Output is deterministic for a given input — no timestamps, no randomness.
 * The caller embeds the string in an inline `<style>` tag.
 */
export function emitDualModeCss(kit: StyleKitPreset, kitId: string): string {
  // Light projection — the kit itself, with any `dark` partial stripped
  // (the resolver does that for us in dark mode; for light we just clone
  // out the `dark` field so the emitter never reads it). Strip is purely
  // cosmetic — the emitter only reads the scalar fields it knows about.
  const lightKit = resolveStyleKitForMode(kit, 'light');
  // Dark projection — if the kit lacks `dark` we consult the built-in
  // sidecar to stitch in a dark partial for known built-ins. If neither
  // exists, the resolver returns the light kit and the dark block ends up
  // identical to light (documented).
  const kitWithDark = withBuiltInDark(kit, kitId);
  const darkKit = resolveStyleKitForMode(kitWithDark, 'dark');

  const lightDecls = renderTokenDeclarations(lightKit);
  const darkDecls = renderTokenDeclarations(darkKit);

  return `:root {\n${lightDecls}\n}\n:root[data-mode="dark"] {\n${darkDecls}\n}`;
}

// --------------------------------------------------------------------------
// Declaration renderer — same `--rev01-kit-*` namespace the per-kit block
// uses, so existing CSS that reads `var(--rev01-kit-bg)` works without
// modification. We do NOT redeclare the variant records here (surfaceVariants
// / actionVariants / motionPresets) — those are still styled by the per-kit
// block keyed off `[data-style-kit]`. The mode-flip story for variants would
// require a wider refactor of the public stylesheet and is deferred.
// --------------------------------------------------------------------------

function renderTokenDeclarations(kit: StyleKitPreset): string {
  // Indent + newline for readability. The emitter is invoked once per page
  // load so the cost is negligible. Order matches `buildKitTokenBlock` in
  // `src/canvas/style-kits.ts` so the two outputs line up under a diff.
  const lines: string[] = [
    `  --rev01-kit-bg: ${kit.bg};`,
    `  --rev01-kit-panel: ${kit.panel};`,
    `  --rev01-kit-text: ${kit.text};`,
    `  --rev01-kit-muted: ${kit.muted};`,
    `  --rev01-kit-accent: ${kit.accent};`,
    `  --rev01-kit-accent-text: ${kit.accentText};`,
    `  --rev01-kit-font-display: ${kit.fontFamilyDisplay};`,
    `  --rev01-kit-font-body: ${kit.fontFamilyBody};`,
    `  --rev01-kit-font-mono: ${kit.fontFamilyMono};`,
    `  --rev01-kit-heading-scale: ${String(kit.headingScale)};`,
    `  --rev01-kit-body-scale: ${String(kit.bodyScale)};`,
    `  --rev01-kit-label-scale: ${String(kit.labelScale)};`,
    `  --rev01-kit-line-height: ${String(kit.lineHeight)};`,
    `  --rev01-kit-radius: ${kit.radius};`,
    `  --rev01-kit-border-width: ${kit.borderWidth};`,
    `  --rev01-kit-shadow: ${kit.shadow};`,
    `  --rev01-kit-shape-fill: ${kit.shapeFill};`,
    `  --rev01-kit-shape-stroke: ${kit.shapeStroke};`,
    `  --rev01-kit-shape-stroke-width: ${kit.shapeStrokeWidth};`,
    `  --rev01-kit-action-radius: ${kit.actionRadius};`,
    `  --rev01-kit-action-padding: ${kit.actionPadding};`,
    `  --rev01-kit-motion-duration: ${String(kit.motionDurationMs)}ms;`,
    `  --rev01-kit-motion-easing: ${kit.motionEasing};`,
    // Legacy `--kit-*` aliases mirror what `buildKitTokenBlock` emits so
    // pre-existing CSS that reads the short names also flips with the mode.
    `  --kit-bg: ${kit.bg};`,
    `  --kit-fg: ${kit.text};`,
    `  --kit-accent: ${kit.accent};`,
  ];
  return lines.join('\n');
}
