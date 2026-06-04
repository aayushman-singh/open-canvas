// src/fonts/face-emit.ts
//
// `@font-face` block generator for the public renderer.
//
// The renderer ships uploaded fonts via a per-site stylesheet block emitted
// alongside the existing canvas styles. Each block declares ONE font face
// pointing at `/fonts/<contentHash>` (served by `src/fonts/route.ts`'s
// public read handler).
//
// Output contract:
//
//   @font-face {
//     font-family: "<name>";
//     src: url('/fonts/<contentHash>') format('woff2');
//     font-display: swap;
//     font-weight: <weight>;
//     font-style: <style>;
//   }
//
// `font-display: swap` is non-negotiable — the brief acceptance criteria
// names "no FOUT" and "system fallback shows until the WOFF2 finishes."
// `swap` keeps the fallback visible during the block period and swaps in
// the uploaded face the moment it lands. The path is relative so the
// browser inherits the document's origin (works under both the
// `<subdomain>.<APP_DOMAIN>` host and any Cloudflare-for-SaaS
// custom hostname owned by `src/custom-domain/`).

import {
  collectReferencedFontHashes,
  makeFontLookup,
  type FontTokenTriple,
  type SiteFontRef,
} from './resolve.js';

/**
 * Emit a single `@font-face` block for one site-font row. Used by both the
 * full-state emitter below and any caller that wants to ship a single face
 * (e.g. a future preview-on-hover affordance in the theme panel).
 *
 * The font name is JSON.stringify-quoted so multi-word names round-trip
 * safely. The content hash is restricted to `[0-9a-fA-F]+` so the URL
 * cannot smuggle CSS terminators / quotes / parens — the schema validator
 * is the primary enforcer; this is belt-and-braces.
 */
export function emitSingleFontFace(font: SiteFontRef): string {
  if (!/^[0-9a-fA-F]+$/.test(font.contentHash)) {
    throw new Error(
      `emitSingleFontFace: contentHash must be hex, got ${JSON.stringify(font.contentHash)} — refusing to emit @font-face for a non-hex hash`,
    );
  }
  const familyQuoted = JSON.stringify(font.name);
  return [
    `@font-face {`,
    `  font-family: ${familyQuoted};`,
    `  src: url('/fonts/${font.contentHash}') format('woff2');`,
    `  font-display: swap;`,
    `  font-weight: ${String(font.weight)};`,
    `  font-style: ${font.style};`,
    `}`,
  ].join('\n');
}

/**
 * Shape the renderer passes in: the kit's three font tokens (so we can see
 * which `font:<hash>` references are in play) plus the site's font catalog
 * (so we can look up names / weights / styles).
 */
export interface FaceEmitInput {
  /** The three font tokens off the resolved Style Kit. */
  tokens: FontTokenTriple;
  /**
   * Every font row attached to this site. The emitter walks the kit's
   * font tokens and emits a block per referenced hash; rows the kit does
   * not reference are silently skipped (no point shipping bytes the page
   * won't render).
   */
  fonts: ReadonlyArray<SiteFontRef>;
}

/**
 * Emit the full set of `@font-face` blocks the public renderer needs for a
 * given site. Returns the empty string when no `font:<hash>` references
 * appear in the kit's font tokens — the public renderer concatenates this
 * unconditionally, so an empty string means "no extra CSS." Throws when a
 * referenced hash has no matching row (same fail-loud contract as
 * `resolveFontFamilyValue`).
 *
 * The output is ordered by the token positions (display → body → mono) so
 * the emitted CSS is stable across calls.
 */
export function emitFontFaceBlocks(input: FaceEmitInput): string {
  const referenced = collectReferencedFontHashes(input.tokens);
  if (referenced.length === 0) return '';
  const lookup = makeFontLookup(input.fonts);
  const blocks: string[] = [];
  for (const hash of referenced) {
    const font = lookup.byHash(hash);
    if (!font) {
      throw new Error(
        `emitFontFaceBlocks: font token references hash "${hash}" but no matching siteFont row was supplied — pass the full font catalog or remove the dangling token`,
      );
    }
    blocks.push(emitSingleFontFace(font));
  }
  return blocks.join('\n');
}

/**
 * Emit one `@font-face` block per supplied site font, regardless of whether
 * the Style Kit's font tokens reference them. The text-inspector font-family
 * picker writes the chosen font's *name* directly into a text element's
 * `pinnedStyle["font-family"]` (so the renderer-side `font:<hash>` resolver
 * never sees it). The public renderer therefore needs every uploaded font's
 * face declaration available on the page so element-level pins can resolve.
 *
 * Returns the empty string when `fonts` is empty so the renderer can
 * concatenate the result unconditionally. Output is ordered by the input
 * array's order so callers can pre-sort for stable CSS diffs.
 */
export function emitAllSiteFontFaceBlocks(fonts: ReadonlyArray<SiteFontRef>): string {
  if (fonts.length === 0) return '';
  return fonts.map(emitSingleFontFace).join('\n');
}
