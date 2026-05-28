// src/fonts/resolve.ts
//
// Resolves `"font:<contentHash>"` references found inside a
// Style Kit's font tokens (`fontFamilyDisplay` / `fontFamilyBody` /
// `fontFamilyMono`) into a real CSS `font-family` value chain.
//
// Contract:
//   - A token whose value starts with `font:` carries a `siteFont.contentHash`
//     suffix. The renderer looks up the matching site-font row (passed in
//     via the `lookup` map) and emits the chain `"<name>", system-ui,
//     sans-serif`.
//   - Tokens that don't start with `font:` pass through verbatim — built-in
//     kits and pre-#12 custom kits keep working byte-for-byte.
//   - Unknown / missing references throw loudly. Per the repo's "all-or-
//     nothing" policy there is no silent fallback to a system stack; the
//     Owner deleted the font and the resolver surfaces the dangling token.
//     The face-emit module owns the parallel job of collecting every font
//     referenced by a kit so the public renderer can ship the corresponding
//     @font-face blocks alongside the resolved family chain.

/** Prefix a Style Kit token uses to point at an uploaded font. */
export const FONT_REF_PREFIX = 'font:';

/** Minimal shape the resolver needs from a `siteFont` row. */
export interface SiteFontRef {
  contentHash: string;
  name: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
}

/**
 * Lookup contract: given a content hash, return the matching site font or
 * `undefined`. Callers materialise this from a DB read or a fixture array
 * before invoking the resolver.
 */
export interface FontLookup {
  byHash(contentHash: string): SiteFontRef | undefined;
}

export function makeFontLookup(fonts: ReadonlyArray<SiteFontRef>): FontLookup {
  const index = new Map<string, SiteFontRef>();
  for (const font of fonts) {
    index.set(font.contentHash, font);
  }
  return {
    byHash(contentHash) {
      return index.get(contentHash);
    },
  };
}

/**
 * Test whether a Style Kit token string carries a `font:<hash>` reference.
 * Cheap string check; the heavier validation runs inside `resolveFontFamilyValue`.
 */
export function isFontReference(token: string): boolean {
  return token.startsWith(FONT_REF_PREFIX);
}

/**
 * Extract the content-hash suffix from a `font:<hash>` token. Returns null
 * when the token is not a font reference. Whitespace / quote-wrappers found
 * in real-world Owner edits are tolerated so the token can be authored as
 * either `font:abc...` or `'font:abc...'`.
 */
export function parseFontReference(token: string): string | null {
  const trimmed = token.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed.startsWith(FONT_REF_PREFIX)) return null;
  const hash = trimmed.slice(FONT_REF_PREFIX.length).trim();
  if (hash.length === 0) return null;
  return hash;
}

/**
 * Translate a Style Kit font token into the CSS `font-family` value chain
 * the renderer ships. The optional `fallback` chain is appended after the
 * named font; defaults to `system-ui, sans-serif` per the brief's contract.
 *
 * Throws when the token references an unknown font. The render boundary
 * catches this exactly once (publish-time validation) so a broken token
 * never silently degrades to a system stack on the visitor's page.
 */
export function resolveFontFamilyValue(
  token: string,
  lookup: FontLookup,
  fallback = 'system-ui, sans-serif',
): string {
  const hash = parseFontReference(token);
  if (hash === null) {
    // Passthrough — not a font: reference. Token is already a literal
    // CSS family chain.
    return token;
  }
  const font = lookup.byHash(hash);
  if (!font) {
    throw new Error(
      `resolveFontFamilyValue: no site font registered for hash "${hash}" — referenced token "${token}" cannot be rendered. Re-upload the font or pick a different token.`,
    );
  }
  // Quote the family name so a multi-word name (e.g. "My Font") stays one
  // token in the CSS chain. JSON.stringify uses double quotes, matching the
  // built-in kits' convention.
  return `${JSON.stringify(font.name)}, ${fallback}`;
}

/**
 * Walk a Style Kit's three font tokens and resolve any `font:<hash>`
 * references against the supplied lookup. Tokens that are not font
 * references pass through verbatim. Use this from the render boundary to
 * rewrite the kit before feeding it to the CSS builder.
 *
 * Note: this returns a new object; the input is treated as read-only.
 */
export interface FontTokenTriple {
  fontFamilyDisplay: string;
  fontFamilyBody: string;
  fontFamilyMono: string;
}
export function resolveFontTokens<T extends FontTokenTriple>(
  tokens: T,
  lookup: FontLookup,
): T {
  return {
    ...tokens,
    fontFamilyDisplay: resolveFontFamilyValue(tokens.fontFamilyDisplay, lookup),
    fontFamilyBody: resolveFontFamilyValue(tokens.fontFamilyBody, lookup),
    fontFamilyMono: resolveFontFamilyValue(tokens.fontFamilyMono, lookup),
  };
}

/**
 * Collect every distinct `font:<hash>` content-hash referenced by a Style
 * Kit's three font tokens. Used by the face-emit module to figure out
 * which @font-face blocks the public renderer must ship.
 */
export function collectReferencedFontHashes(
  tokens: Pick<FontTokenTriple, 'fontFamilyDisplay' | 'fontFamilyBody' | 'fontFamilyMono'>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of [tokens.fontFamilyDisplay, tokens.fontFamilyBody, tokens.fontFamilyMono]) {
    const hash = parseFontReference(token);
    if (hash !== null && !seen.has(hash)) {
      seen.add(hash);
      out.push(hash);
    }
  }
  return out;
}
