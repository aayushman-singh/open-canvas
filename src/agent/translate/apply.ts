// src/agent/translate/apply.ts
//
// Wishlist #24 — Build + apply the op set for one translation batch.
//
// Two modes:
//
//   replace   — destructive. For every collected path: overwrite the string
//               with its translation. For every touched page: stamp
//               `locale: <to>`. Original pages and slugs are mutated in place.
//
//   sibling   — non-destructive (default). Original pages stay untouched.
//               For every page in the source state, we add a NEW page whose
//               `id` and `slug` are namespaced under the target locale
//               (`<locale>/<original-slug>`), whose strings are the translated
//               versions, and whose `locale` is set to `<to>`.
//
// The op set we emit is structural — not the existing CanvasAgentOp union.
// That union is rewriteText / replaceMedia / insertSection, all element-
// scoped; we need finer-grained "set text at this JSON path" ops AND
// page-level create/locale ops. To stay inside the "consume only" rule for
// `canvas-ops.ts`, we define a translate-local op union here. The route
// returns these ops in the preview payload; on accept the route applies
// them via `applyTranslateOps` (in this file) and writes the new state.
//
// We deliberately do NOT round-trip through the canvas-agent op pipeline —
// this is a bulk text rewrite, not an Owner-authored edit, and using the
// agent ops would force one element per text field (thousands of ops on a
// medium site) plus a fresh validate-everything pass per op.
//
// Path notation: see `collect.ts`. The parser here is a tiny, deliberately
// regex-free walk so the failure mode for a malformed path is a precise
// "could not navigate <path> at <step>" message rather than a generic
// JSONPath parser explosion.

import type { CanvasPage, CanvasSiteState } from '../../canvas/schema.js';
import {
  collectTranslatableStrings,
  type CollectedString,
} from './collect.js';
import {
  translateBatch,
  type Translator,
} from './llm.js';

export type TranslateMode = 'replace' | 'sibling';

export interface TranslateOptions {
  /** BCP-47 source language code (e.g. 'en'). */
  from: string;
  /** BCP-47 target language code (e.g. 'es'). */
  to: string;
  mode: TranslateMode;
}

// ---------------------------------------------------------------------------
// Op shapes — local to the translate subsystem.
// ---------------------------------------------------------------------------

export type TranslateOp =
  | {
      /** Replace mode: overwrite the string at <path> with <translated>. */
      kind: 'setStringAtPath';
      path: string;
      value: string;
    }
  | {
      /** Replace mode: stamp `pages[<idx>].locale` with the target locale. */
      kind: 'setPageLocale';
      pageIdx: number;
      locale: string;
    }
  | {
      /**
       * Sibling mode: insert a fully-formed CanvasPage at the end of `pages`.
       * The page is the translated duplicate of an original; the route /
       * accept handler is responsible for revalidating the resulting state.
       */
      kind: 'addTranslatedPage';
      page: CanvasPage;
    };

// ---------------------------------------------------------------------------
// Public surface.
// ---------------------------------------------------------------------------

export interface TranslateResult {
  /** Op set the editor / route applies to the editable state. */
  ops: TranslateOp[];
  /**
   * Preview state — `applyTranslateOps(state, ops)`. The caller diffs this
   * against the original to render the Owner-facing preview pane.
   */
  preview: CanvasSiteState;
  /**
   * Strings that were translated, with their original + translated values.
   * The editor surfaces this as a side-panel diff list.
   */
  changes: Array<{ path: string; original: string; translated: string }>;
}

/**
 * Translate `state` end-to-end: collect strings → batch translate → build
 * ops → apply ops → return ops + preview state. Pure function (no I/O beyond
 * the supplied translator).
 */
export async function translateSite(
  state: CanvasSiteState,
  opts: TranslateOptions,
  translator: Translator,
): Promise<TranslateResult> {
  const batch = collectTranslatableStrings(state);
  const { translations } = await translateBatch(translator, {
    from: opts.from,
    to: opts.to,
    batch,
  });

  const changes: TranslateResult['changes'] = batch.map((entry) => ({
    path: entry.path,
    original: entry.original,
    translated: translations[entry.path] ?? entry.original,
  }));

  const ops =
    opts.mode === 'replace'
      ? buildReplaceOps(state, batch, translations, opts.to)
      : buildSiblingOps(state, batch, translations, opts.to);

  const preview = applyTranslateOps(state, ops);

  return { ops, preview, changes };
}

/**
 * Apply a sequence of `TranslateOp`s against `state` and return a fresh
 * `CanvasSiteState`. The input is `structuredClone`d, so the original
 * reference is never mutated.
 */
export function applyTranslateOps(state: CanvasSiteState, ops: TranslateOp[]): CanvasSiteState {
  const next = structuredClone(state);
  for (const op of ops) {
    applyOne(next, op);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Internal — op builders.
// ---------------------------------------------------------------------------

function buildReplaceOps(
  state: CanvasSiteState,
  batch: CollectedString[],
  translations: Record<string, string>,
  toLocale: string,
): TranslateOp[] {
  const ops: TranslateOp[] = [];
  // Track which pages we touched so we only stamp locale on pages that
  // actually changed. A page with no translatable strings still gets the
  // locale stamp because the Owner explicitly asked for a site-wide
  // translation — but the brief is silent on that edge so we err toward the
  // safer "only touch what we translated" interpretation: stamp every page
  // (deterministic, predictable for the Owner).
  for (const entry of batch) {
    const translated = translations[entry.path];
    if (typeof translated !== 'string') continue;
    if (translated === entry.original) continue; // no-op — skip to keep ops minimal
    ops.push({ kind: 'setStringAtPath', path: entry.path, value: translated });
  }
  state.pages.forEach((_, pIdx) => {
    ops.push({ kind: 'setPageLocale', pageIdx: pIdx, locale: toLocale });
  });
  return ops;
}

function buildSiblingOps(
  state: CanvasSiteState,
  batch: CollectedString[],
  translations: Record<string, string>,
  toLocale: string,
): TranslateOp[] {
  // Sibling mode: build each translated page in memory by cloning the
  // original, walking the batch entries that belong to that page, and
  // mutating the clone with translations. Each translated page becomes a
  // single `addTranslatedPage` op.
  const ops: TranslateOp[] = [];
  state.pages.forEach((page, pIdx) => {
    const cloned: CanvasPage = structuredClone(page);
    // Namespace id + slug under the locale. The locale prefix uses '/' as
    // the separator because the published routing layer (Wave 5 #25) treats
    // `/<locale>/<slug>` as a single path; collapsing the prefix into the
    // id with a hyphen would break id stability if the Owner renames the
    // slug later. We use a hyphenated id (locale-slug) so the id is a valid
    // identifier; the slug retains the slash-prefixed form for routing.
    cloned.id = `${page.id}-${toLocale}`;
    cloned.slug = `${toLocale}/${page.slug}`;
    cloned.locale = toLocale;
    // Apply this page's slice of the batch onto the clone.
    const pagePrefix = `pages[${String(pIdx)}]`;
    for (const entry of batch) {
      if (!entry.path.startsWith(`${pagePrefix}.`)) continue;
      const translated = translations[entry.path];
      if (typeof translated !== 'string') continue;
      // The path lives in the original state's address space; rewrite the
      // page index to `0` so `setValueAtPathOnPage` can navigate into the
      // CLONE's body without re-indexing.
      const subPath = entry.path.slice(pagePrefix.length + 1); // drop "pages[N]."
      setValueAtSubPath(cloned, subPath, translated);
    }
    ops.push({ kind: 'addTranslatedPage', page: cloned });
  });
  return ops;
}

// ---------------------------------------------------------------------------
// Internal — op applier.
// ---------------------------------------------------------------------------

function applyOne(state: CanvasSiteState, op: TranslateOp): void {
  switch (op.kind) {
    case 'setStringAtPath':
      setValueAtFullPath(state, op.path, op.value);
      return;
    case 'setPageLocale': {
      const page = state.pages[op.pageIdx];
      if (!page) {
        throw new Error(
          `applyTranslateOps(setPageLocale): pages[${String(op.pageIdx)}] does not exist`,
        );
      }
      page.locale = op.locale;
      return;
    }
    case 'addTranslatedPage':
      state.pages.push(structuredClone(op.page));
      return;
  }
}

// ---------------------------------------------------------------------------
// Path navigation. Two entry points:
//
//   setValueAtFullPath  — navigates from `state.pages[N]...`.
//   setValueAtSubPath   — navigates from a page root; used when we've already
//                         picked the page to mutate (sibling mode).
//
// Both reuse `walkAndSet`, which parses one segment at a time.
// ---------------------------------------------------------------------------

function setValueAtFullPath(state: CanvasSiteState, path: string, value: string): void {
  // Every full path starts with `pages[<idx>]`. We peel that off, navigate
  // to the page, then hand the rest to setValueAtSubPath.
  const match = /^pages\[(\d+)\]\.(.+)$/.exec(path);
  if (!match) {
    throw new Error(`translate/apply: malformed path (expected pages[N].…): ${JSON.stringify(path)}`);
  }
  const pageIdx = Number(match[1]);
  const subPath = match[2];
  if (subPath === undefined) {
    throw new Error(`translate/apply: malformed path (no sub-path): ${JSON.stringify(path)}`);
  }
  const page = state.pages[pageIdx];
  if (!page) {
    throw new Error(`translate/apply: pages[${String(pageIdx)}] does not exist`);
  }
  setValueAtSubPath(page, subPath, value);
}

function setValueAtSubPath(pageRoot: CanvasPage, subPath: string, value: string): void {
  // Parse the sub-path into segments. Examples:
  //
  //   title                                                       → ['title']
  //   description                                                 → ['description']
  //   sections[0].elements[2].content[1].text                     → ['sections', 0, 'elements', 2, 'content', 1, 'text']
  //   sections[0].elements[3].rows[0].cells.col-1                 → ['sections', 0, 'elements', 3, 'rows', 0, 'cells', 'col-1']
  const segments = parseSegments(subPath);
  walkAndSet(pageRoot, segments, value, subPath);
}

type Segment = { kind: 'key'; name: string } | { kind: 'index'; index: number };

function parseSegments(path: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < path.length) {
    // Skip leading separators.
    if (path[i] === '.') {
      i++;
      continue;
    }
    if (path[i] === '[') {
      // Read integer until ']'.
      const close = path.indexOf(']', i);
      if (close < 0) {
        throw new Error(`translate/apply: unterminated '[' in path ${JSON.stringify(path)}`);
      }
      const num = Number(path.slice(i + 1, close));
      if (!Number.isInteger(num) || num < 0) {
        throw new Error(
          `translate/apply: non-integer index in path ${JSON.stringify(path)} at offset ${String(i)}`,
        );
      }
      out.push({ kind: 'index', index: num });
      i = close + 1;
      continue;
    }
    // Read identifier until '.' or '[' or end.
    let j = i;
    while (j < path.length && path[j] !== '.' && path[j] !== '[') j++;
    if (j === i) {
      throw new Error(
        `translate/apply: empty key at offset ${String(i)} in path ${JSON.stringify(path)}`,
      );
    }
    out.push({ kind: 'key', name: path.slice(i, j) });
    i = j;
  }
  return out;
}

/**
 * Walk `root` along `segments`, setting the final segment to `value`. Throws
 * loudly when any intermediate step fails — the failure mode for a path that
 * does not exist is a noisy error, not a silent skip.
 */
function walkAndSet(root: unknown, segments: Segment[], value: string, fullPath: string): void {
  if (segments.length === 0) {
    throw new Error(`translate/apply: empty path on ${JSON.stringify(fullPath)}`);
  }
  let cursor: unknown = root;
  for (let s = 0; s < segments.length - 1; s++) {
    const seg = segments[s];
    if (!seg) break;
    cursor = stepInto(cursor, seg, fullPath, s);
  }
  const last = segments[segments.length - 1];
  if (!last) {
    throw new Error(`translate/apply: missing final segment on ${JSON.stringify(fullPath)}`);
  }
  if (last.kind === 'key') {
    if (!isRecord(cursor)) {
      throw new Error(
        `translate/apply: cannot set key ${JSON.stringify(last.name)} on non-object (path ${JSON.stringify(fullPath)})`,
      );
    }
    cursor[last.name] = value;
    return;
  }
  // last.kind === 'index'
  if (!Array.isArray(cursor)) {
    throw new Error(
      `translate/apply: cannot set index ${String(last.index)} on non-array (path ${JSON.stringify(fullPath)})`,
    );
  }
  cursor[last.index] = value;
}

function stepInto(cursor: unknown, seg: Segment, fullPath: string, segIdx: number): unknown {
  if (seg.kind === 'key') {
    if (!isRecord(cursor)) {
      throw new Error(
        `translate/apply: cannot read key ${JSON.stringify(seg.name)} at segment ${String(segIdx)} of ${JSON.stringify(fullPath)} (cursor is ${typeof cursor})`,
      );
    }
    const next: unknown = cursor[seg.name];
    if (next === undefined) {
      throw new Error(
        `translate/apply: missing key ${JSON.stringify(seg.name)} at segment ${String(segIdx)} of ${JSON.stringify(fullPath)}`,
      );
    }
    return next;
  }
  // seg.kind === 'index'
  if (!Array.isArray(cursor)) {
    throw new Error(
      `translate/apply: cannot index [${String(seg.index)}] at segment ${String(segIdx)} of ${JSON.stringify(fullPath)} (cursor is ${typeof cursor})`,
    );
  }
  const next: unknown = cursor[seg.index];
  if (next === undefined) {
    throw new Error(
      `translate/apply: out-of-bounds index ${String(seg.index)} at segment ${String(segIdx)} of ${JSON.stringify(fullPath)}`,
    );
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
