// src/editor-client/ids.ts
//
// ADR 0015 Phase 2c — id generators. Pure, no DOM, no IIFE-local
// dependencies. canvas-client.ts:1952-1961 carries inline copies.
//
// `crypto.randomUUID` is the only dependency; if the browser does not
// expose it the editor cannot generate ids and `uuid()` throws loudly
// rather than degrading to a weaker generator. Every modern browser
// rev01 supports has had `crypto.randomUUID` for years; the explicit
// throw beats a silent fallback that would let weaker ids land in
// stored sites.

export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('crypto.randomUUID is required for editor id generation');
}

export function newElementId(): string {
  return 'el-' + uuid();
}

export function newSectionId(): string {
  return 'sec-' + uuid();
}

export function newPageId(): string {
  return 'page-' + uuid();
}
