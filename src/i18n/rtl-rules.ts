// src/i18n/rtl-rules.ts
//
// Wishlist #25 — curated RTL locale list + `isRtl(locale)` lookup.
//
// Scope is intentionally narrow: the four scripts the POC supports are
// Arabic (ar), Farsi/Persian (fa), Hebrew (he), and Urdu (ur). We match the
// region-bare tag exactly (`ar`) and any BCP-47 region-qualified extension
// (`ar-EG`, `ar-SA`, …). Higher-cardinality subtag matching (script
// variants like `az-Arab`) is out of scope — the editor UI is the only
// surface that authors the tag and constrains it to the curated set.
//
// Curated rather than algorithmic on purpose: there is no `Intl` API we can
// call inside a Cloudflare Worker that returns "direction for this BCP-47
// tag" cheaply, and shipping a full CLDR table would dwarf the actual
// rendering code we own.

/**
 * The four RTL languages the POC supports. Region-qualified extensions of
 * these tags (e.g. `ar-EG`, `he-IL`) inherit RTL via {@link isRtl}.
 *
 * Exported for fixtures and the editor locale picker — runtime callers
 * should prefer {@link isRtl}.
 */
export const RTL_LOCALES = ['ar', 'fa', 'he', 'ur'] as const;
export type RtlLocale = (typeof RTL_LOCALES)[number];

const RTL_LOCALE_SET: ReadonlySet<string> = new Set(RTL_LOCALES);

/**
 * Returns true when the given BCP-47 locale tag belongs to an RTL script
 * the POC supports.
 *
 * Matching rule: the primary language subtag (everything before the first
 * `-`) must match an entry in {@link RTL_LOCALES}. Case-insensitive on the
 * primary subtag — `AR-eg` still resolves to RTL because the editor may
 * have normalised inconsistently.
 *
 * Returns false for unknown / empty input rather than throwing — the
 * caller (renderer + router) treats "unknown direction" as LTR by design.
 */
export function isRtl(locale: string | null | undefined): boolean {
  if (typeof locale !== 'string' || locale.length === 0) return false;
  const dashIdx = locale.indexOf('-');
  const primary = (dashIdx === -1 ? locale : locale.slice(0, dashIdx)).toLowerCase();
  return RTL_LOCALE_SET.has(primary);
}
