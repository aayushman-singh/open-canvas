// src/agent/translate/smoke.ts
//
// Wishlist #24 — Manual smoke for the auto-translate subsystem.
//
// Assertions (mirroring the brief):
//   1. Site with one page + three text elements; stub translator reverses
//      each string.
//   2. Sibling mode: a new page exists at slug `es/<original>`,
//      `locale: 'es'`, with reversed strings; original page untouched.
//   3. Replace mode: original page has reversed strings and `locale: 'es'`.
//   4. Shape-mismatch translator: retries up to MAX_ATTEMPTS-1 times, then
//      throws loudly on the final failure.
//   5. Code element `source` field is never translated in either mode.
//
// Run with `bun.cmd run translate:smoke`.

import type {
  CanvasPage,
  CanvasSection,
  CanvasSiteState,
  TextElement,
} from '../../canvas/schema.js';
import type { CodeElement } from '../../canvas/elements/code.js';
import { collectTranslatableStrings } from './collect.js';
import { translateBatch, type Translator, type TranslateBatchInput } from './llm.js';
import { translateSite } from './apply.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[translate:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// Stub translator: reverses each `original` string and returns the response in
// the documented `{translations: Record<path, string>}` shape. Used by every
// happy-path assertion to keep the smoke deterministic and offline.
// ---------------------------------------------------------------------------
class ReverseTranslator implements Translator {
  translate(input: TranslateBatchInput): Promise<unknown> {
    const translations: Record<string, string> = {};
    for (const entry of input.batch) {
      translations[entry.path] = reverseString(entry.original);
    }
    return Promise.resolve({ translations });
  }
}

function reverseString(s: string): string {
  return s.split('').reverse().join('');
}

// ---------------------------------------------------------------------------
// Build a deterministic source site: 1 page, 3 text elements + 1 code element
// whose `source` field must survive untouched.
// ---------------------------------------------------------------------------
function buildSourceState(): CanvasSiteState {
  const text1: TextElement = {
    id: 'el-text-1',
    type: 'text',
    box: { x: 0, y: 0, w: 200, h: 60, z: 1 },
    content: [{ text: 'Hello world' }],
    role: 'heading',
    fontSize: 32,
    fontWeight: 700,
    align: 'left',
  };
  const text2: TextElement = {
    id: 'el-text-2',
    type: 'text',
    box: { x: 0, y: 80, w: 200, h: 60, z: 1 },
    content: [{ text: 'A second line' }, { text: 'split across runs' }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
  };
  const text3: TextElement = {
    id: 'el-text-3',
    type: 'text',
    box: { x: 0, y: 160, w: 200, h: 60, z: 1 },
    content: [{ text: 'Third element' }],
    role: 'label',
    fontSize: 14,
    fontWeight: 500,
    align: 'left',
  };
  const CODE_SOURCE = 'const x = 42; // do not translate me';
  const code1: CodeElement = {
    id: 'el-code-1',
    type: 'code',
    box: { x: 0, y: 240, w: 400, h: 200, z: 1 },
    language: 'typescript',
    source: CODE_SOURCE,
    showLineNumbers: true,
  };
  const section: CanvasSection = {
    id: 'sec-1',
    recipeId: 'hero-split',
    name: 'Hero',
    height: 600,
    elements: [text1, text2, text3, code1],
  };
  const page: CanvasPage = {
    id: 'page-home',
    slug: 'home',
    title: 'Home',
    width: 1440,
    sections: [section],
    description: 'A demo page',
  };
  return {
    styleKit: 'charcoal',
    symbols: [],
    pages: [page],
  };
}

// ---------------------------------------------------------------------------
// Helper: extract a code element from a state by id (so we can verify its
// `source` field across modes without hand-coding indices).
// ---------------------------------------------------------------------------
function findCodeElement(state: CanvasSiteState, pageSlug: string, elementId: string): CodeElement {
  const page = state.pages.find((p) => p.slug === pageSlug);
  assert(page !== undefined, `page with slug ${pageSlug} should exist`);
  for (const section of page!.sections) {
    for (const el of section.elements) {
      if (el.id === elementId && el.type === 'code') return el;
    }
  }
  throw new Error(`[translate:smoke] code element ${elementId} not found on ${pageSlug}`);
}

// ---------------------------------------------------------------------------
// Assertion 1: collectTranslatableStrings finds the three text runs (text1
// has one run, text2 has two, text3 has one — four runs total) plus the page
// title and description. Code source is NOT in the batch.
// ---------------------------------------------------------------------------
{
  const state = buildSourceState();
  const batch = collectTranslatableStrings(state);
  // Expected entries: title, description, 4 text runs.
  const expected = [
    'pages[0].title',
    'pages[0].description',
    'pages[0].sections[0].elements[0].content[0].text',
    'pages[0].sections[0].elements[1].content[0].text',
    'pages[0].sections[0].elements[1].content[1].text',
    'pages[0].sections[0].elements[2].content[0].text',
  ];
  for (const path of expected) {
    assert(
      batch.some((entry) => entry.path === path),
      `collect should include path ${path}`,
    );
  }
  // Code source must NOT appear.
  for (const entry of batch) {
    assert(
      !entry.path.includes('elements[3].source'),
      `collect must NOT include code source (got ${entry.path})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Assertion 2: sibling mode produces a new page at slug `es/home` with
// locale 'es' and reversed strings. Original page untouched.
// ---------------------------------------------------------------------------
{
  const state = buildSourceState();
  const result = await translateSite(state, { from: 'en', to: 'es', mode: 'sibling' }, new ReverseTranslator());

  // Original page reference must be untouched (deep-equality on the
  // important fields — the apply path structuredClones the state so by-
  // reference equality won't hold, but the values must match).
  assert(state.pages.length === 1, 'original state.pages length must be unchanged after sibling translate');
  assert(state.pages[0]!.slug === 'home', 'original slug must be unchanged');
  assert(state.pages[0]!.title === 'Home', 'original title must be unchanged');
  assert(
    (state.pages[0]!.sections[0]!.elements[0] as TextElement).content[0]!.text === 'Hello world',
    'original text element must be unchanged',
  );

  assert(result.preview.pages.length === 2, 'sibling mode must add one new page (preview)');
  const newPage = result.preview.pages.find((p) => p.slug === 'es/home');
  assert(newPage !== undefined, "sibling page at slug 'es/home' must exist");
  assert(newPage!.locale === 'es', "sibling page locale must be 'es'");
  assert(newPage!.title === reverseString('Home'), 'sibling page title must be reversed');
  assert(
    newPage!.description === reverseString('A demo page'),
    'sibling page description must be reversed',
  );
  const newText1 = newPage!.sections[0]!.elements[0] as TextElement;
  assert(
    newText1.content[0]!.text === reverseString('Hello world'),
    'sibling text element 1 must have reversed content',
  );
  const newText2 = newPage!.sections[0]!.elements[1] as TextElement;
  assert(
    newText2.content[0]!.text === reverseString('A second line'),
    'sibling text element 2 run 0 must be reversed',
  );
  assert(
    newText2.content[1]!.text === reverseString('split across runs'),
    'sibling text element 2 run 1 must be reversed',
  );

  // Code source untouched on BOTH original and sibling.
  const origCode = findCodeElement(result.preview, 'home', 'el-code-1');
  assert(
    origCode.source === 'const x = 42; // do not translate me',
    'original page code source must be unchanged in sibling mode',
  );
  const sibCode = findCodeElement(result.preview, 'es/home', 'el-code-1');
  assert(
    sibCode.source === 'const x = 42; // do not translate me',
    'sibling page code source must be unchanged in sibling mode',
  );
}

// ---------------------------------------------------------------------------
// Assertion 3: replace mode mutates original pages in place and stamps
// locale.
// ---------------------------------------------------------------------------
{
  const state = buildSourceState();
  const result = await translateSite(state, { from: 'en', to: 'es', mode: 'replace' }, new ReverseTranslator());

  assert(result.preview.pages.length === 1, 'replace mode must NOT add pages');
  const page = result.preview.pages[0]!;
  assert(page.slug === 'home', 'replace mode must keep original slug');
  assert(page.locale === 'es', "replace mode must stamp locale='es' on the page");
  assert(page.title === reverseString('Home'), 'replace mode must overwrite page title');
  assert(
    page.description === reverseString('A demo page'),
    'replace mode must overwrite page description',
  );
  const t1 = page.sections[0]!.elements[0] as TextElement;
  assert(t1.content[0]!.text === reverseString('Hello world'), 'replace text 1 must be reversed');
  const t2 = page.sections[0]!.elements[1] as TextElement;
  assert(t2.content[0]!.text === reverseString('A second line'), 'replace text 2 run 0 reversed');
  assert(
    t2.content[1]!.text === reverseString('split across runs'),
    'replace text 2 run 1 reversed',
  );

  // Code source untouched.
  const code = findCodeElement(result.preview, 'home', 'el-code-1');
  assert(
    code.source === 'const x = 42; // do not translate me',
    'replace mode must not touch code element source',
  );
}

// ---------------------------------------------------------------------------
// Assertion 4: shape mismatch triggers retries and a loud final throw.
// We use translateBatch directly here so we can count the attempts.
// ---------------------------------------------------------------------------
{
  let attempts = 0;
  const badTranslator: Translator = {
    translate(): Promise<unknown> {
      attempts++;
      // Always return a malformed shape (missing `translations` field).
      return Promise.resolve({ wrong_field: 'oops' });
    },
  };
  let threw = false;
  try {
    await translateBatch(badTranslator, {
      from: 'en',
      to: 'es',
      batch: [{ path: 'pages[0].title', original: 'Hello' }],
    });
  } catch (err) {
    threw = true;
    const msg = err instanceof Error ? err.message : String(err);
    assert(
      msg.includes('shape contract violated'),
      `error message must explain shape contract violation (got ${msg})`,
    );
    assert(msg.includes('attempt'), 'error message must mention the attempts');
  }
  assert(threw, 'translateBatch must throw on persistent shape mismatch');
  assert(attempts === 3, `translateBatch must retry up to 3 attempts total (got ${String(attempts)})`);
}

// ---------------------------------------------------------------------------
// Assertion 5 (extra): shape-mismatch translator that recovers on the second
// attempt — translateBatch must return the recovered response and not throw.
// ---------------------------------------------------------------------------
{
  let attempts = 0;
  const flakyTranslator: Translator = {
    translate(input: TranslateBatchInput): Promise<unknown> {
      attempts++;
      if (attempts === 1) {
        return Promise.resolve({ no_translations_here: true });
      }
      const translations: Record<string, string> = {};
      for (const entry of input.batch) {
        translations[entry.path] = reverseString(entry.original);
      }
      return Promise.resolve({ translations });
    },
  };
  const result = await translateBatch(flakyTranslator, {
    from: 'en',
    to: 'es',
    batch: [{ path: 'pages[0].title', original: 'Hello' }],
  });
  assert(attempts === 2, `flaky translator must succeed on attempt 2 (got ${String(attempts)})`);
  assert(
    result.translations['pages[0].title'] === reverseString('Hello'),
    'flaky translator recovery must produce the correct translation',
  );
}

console.log('[translate:smoke] OK');
process.exit(0);
