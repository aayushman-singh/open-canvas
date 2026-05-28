// src/canvas/util/id.ts
//
// Shared id-regeneration helpers for canvas section cloning. Both
// `section-import.ts` (seed-only) and `library-section-import.ts` (arbitrary
// Owner Assets) need to mint fresh ids for cloned sections + elements while
// preserving the semantic prefix of the original id (e.g. `el-heading-…`).
//
// The shape `{prefix}-{8-hex}` is the cross-canvas convention — section
// recipes in `recipes.ts` and the layout engine mint ids the same way; this
// module is the import-path's home for that convention.

/**
 * Strip a trailing `-{8-hex}` suffix from an id, returning the semantic
 * prefix. Inputs without that suffix are returned unchanged so semantic
 * names like `el-heading` survive a re-clone of an already-imported section.
 *
 * Empty input collapses to `el` so the caller always has a non-empty prefix
 * to mint a fresh id from.
 */
export function rolePrefix(originalId: string): string {
  const lastDash = originalId.lastIndexOf('-');
  if (lastDash <= 0) return originalId || 'el';
  const tail = originalId.slice(lastDash + 1);
  if (/^[a-f0-9]{8}$/i.test(tail)) return originalId.slice(0, lastDash);
  return originalId;
}

/**
 * Mint a fresh id under the given prefix using 8 hex chars of randomness.
 * The hex tail is what `rolePrefix` recognises and strips on a re-clone, so
 * the two functions form a stable round-trip.
 */
export function newId(prefix: string): string {
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `${prefix}-${random}`;
}
