// src/code/smoke.ts
//
// Wishlist #19 — Code Block. Wave 4 smoke. Asserts:
//
//   1. TS snippet highlighted → output contains `<span style="color: ...">`
//      tokens from Shiki.
//   2. Unsupported language → plain pre/code fallback (no Shiki classes,
//      mono font intact).
//   3. `showLineNumbers: true` → one `.rev01-code-gutter` span per source
//      line in the Shiki output AND in the plain fallback.
//   4. Bundle-size sanity log (informational): reports approximate KB of
//      the curated 11-lang + 1-theme + JS-regex-engine subset.
//
// Run with `bun.cmd run code:smoke`. Exits non-zero on assertion failure
// so the wishlist:smoke runner short-circuits.

import { renderCode, type CodeElement } from '../canvas/elements/code.js';
import {
  getHighlighter,
  highlightCode,
  isSupportedLanguage,
  renderPlainCodeBlock,
} from './highlight.js';
import { SHIKI_LIGHT_THEME, themeForStyleKit } from './theme-map.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    process.stderr.write(`[code:smoke] FAIL — ${message}\n`);
    process.exit(1);
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

function makeBaseElement(): Omit<CodeElement, 'language' | 'source' | 'showLineNumbers'> {
  return {
    id: 'code-smoke',
    type: 'code',
    box: { x: 0, y: 0, w: 600, h: 300, z: 1 },
  };
}

// --------------------------------------------------------------------------
// Pre-warm + theme-map sanity. Forces the WASM-free sync highlighter to
// build its grammar tables before assertion 1 runs so the first timing
// measurement is not muddied by init.
// --------------------------------------------------------------------------
{
  const hl = getHighlighter();
  assert(hl !== null, 'getHighlighter returned null');
  // Second call must hand back the same cached instance.
  const hl2 = getHighlighter();
  assert(hl === hl2, 'getHighlighter must cache the highlighter instance at module scope');
  // Light theme is the only theme we ship in Wave 4.
  assert(
    themeForStyleKit('charcoal') === SHIKI_LIGHT_THEME,
    `themeForStyleKit('charcoal') expected ${SHIKI_LIGHT_THEME}, got ${themeForStyleKit('charcoal')}`,
  );
  assert(
    themeForStyleKit('orange-editorial') === SHIKI_LIGHT_THEME,
    `themeForStyleKit('orange-editorial') expected ${SHIKI_LIGHT_THEME}`,
  );
}

// --------------------------------------------------------------------------
// Assertion 1: TS snippet → highlighted output has inline-coloured spans.
// --------------------------------------------------------------------------
{
  const tsSnippet = `const greeting: string = 'hello';\nconsole.log(greeting);`;
  const html = highlightCode(tsSnippet, 'typescript', {
    styleKit: 'charcoal',
    showLineNumbers: false,
  });
  // Shiki emits inline-coloured token spans. The exact colour depends on
  // the theme; we only assert the *shape* — a span with a `color:` inline
  // style attribute — so the theme can change without breaking the smoke.
  const colourSpanRegex = /<span\s+style="color:\s*#[0-9A-Fa-f]{3,8}/;
  assert(
    colourSpanRegex.test(html),
    `TS highlight: expected at least one <span style="color: #..."> token, got snippet head: ${html.slice(0, 200)}`,
  );
  // Shiki wraps each line with `<span class="line">` — proves we are
  // actually going through Shiki's renderer (not the plain fallback).
  assert(
    html.includes('class="line"'),
    'TS highlight: expected Shiki to emit <span class="line"> per source line',
  );
  // The keyword `const` should appear inside a coloured span; the literal
  // string `const` is enough to prove the source survived round-trip.
  assert(html.includes('const'), 'TS highlight: source keyword "const" missing from output');
}

// --------------------------------------------------------------------------
// Assertion 2: unsupported language → plain pre/code fallback. The element
// interface ships only the 11 curated languages, but runtime guards still
// route an unknown string through `renderPlainCodeBlock`. We exercise both
// the direct helper and the renderer's branch via a TypeScript cast — the
// renderer-side branch is the load-bearing one for migrated/corrupted state.
// --------------------------------------------------------------------------
{
  // Direct call.
  const plain = renderPlainCodeBlock("alert('hi')", 'brainfuck', {
    styleKit: 'blue-saas',
    showLineNumbers: false,
  });
  assert(plain.startsWith('<pre'), 'plain fallback: expected <pre> wrapper');
  assert(
    plain.includes('rev01-code-plain'),
    'plain fallback: expected `rev01-code-plain` marker class',
  );
  assert(
    !/<span\s+style="color:/.test(plain),
    'plain fallback: must NOT contain Shiki-style inline-coloured spans',
  );
  assert(
    plain.includes('var(--rev01-kit-font-mono)'),
    'plain fallback: expected mono CSS variable on the <pre>',
  );
  // The source must be HTML-escaped — single quotes pass through, but
  // angle brackets / ampersands would not. Sanity-check by escaping
  // something hostile.
  const hostile = renderPlainCodeBlock('<script>alert(1)</script>', 'wat', {
    styleKit: 'charcoal',
    showLineNumbers: false,
  });
  assert(
    !hostile.includes('<script>alert(1)</script>'),
    'plain fallback: hostile <script> tag was not escaped',
  );
  assert(
    hostile.includes('&lt;script&gt;'),
    'plain fallback: expected escaped &lt;script&gt; in output',
  );

  // Type-guard sanity: `isSupportedLanguage` rejects unknown strings.
  assert(
    !isSupportedLanguage('brainfuck'),
    "isSupportedLanguage('brainfuck') should be false",
  );
  assert(
    isSupportedLanguage('typescript'),
    "isSupportedLanguage('typescript') should be true",
  );

  // Renderer-side branch: build a CodeElement with a cast to simulate a
  // corrupted/migrated state that still made it to the renderer. The
  // renderer must route to the plain fallback rather than crash.
  const base = makeBaseElement();
  const el = {
    ...base,
    language: 'brainfuck',
    source: 'echo hi',
    showLineNumbers: false,
  } as unknown as CodeElement;
  const out = renderCode(el, { styleKit: 'blue-saas' });
  assert(
    out.includes('rev01-code-plain'),
    'renderCode: expected plain fallback for unsupported language at renderer boundary',
  );
  assert(
    out.includes('rev01-code-block'),
    'renderCode: expected outer rev01-code-block wrapper even for plain fallback',
  );
}

// --------------------------------------------------------------------------
// Assertion 3: showLineNumbers: true emits one gutter span per source line.
// We assert for both the Shiki path and the plain path so future theme
// edits cannot regress just one branch.
// --------------------------------------------------------------------------
{
  // Shiki path — TypeScript across 4 source lines.
  const fourLineSnippet = `const a = 1;\nconst b = 2;\nconst c = a + b;\nconsole.log(c);`;
  const expectedShikiLines = 4;
  const withGutter = highlightCode(fourLineSnippet, 'typescript', {
    styleKit: 'charcoal',
    showLineNumbers: true,
  });
  const shikiGutterCount = countOccurrences(withGutter, 'class="rev01-code-gutter"');
  assert(
    shikiGutterCount === expectedShikiLines,
    `Shiki gutter: expected ${String(expectedShikiLines)} gutter spans, got ${String(shikiGutterCount)}`,
  );
  // Each gutter span carries its line number; line 4 must be present.
  assert(
    withGutter.includes('data-line="4"'),
    'Shiki gutter: expected data-line="4" on the fourth gutter span',
  );

  // Confirm absence when the flag is off — proves the transformer hook is
  // actually keyed off `showLineNumbers`.
  const withoutGutter = highlightCode(fourLineSnippet, 'typescript', {
    styleKit: 'charcoal',
    showLineNumbers: false,
  });
  assert(
    !withoutGutter.includes('rev01-code-gutter'),
    'Shiki gutter: must NOT emit any gutter span when showLineNumbers is false',
  );

  // Plain path — 3 source lines, unsupported language.
  const plainSnippet = `line one\nline two\nline three`;
  const expectedPlainLines = 3;
  const plain = renderPlainCodeBlock(plainSnippet, 'foo-lang', {
    styleKit: 'green-organic',
    showLineNumbers: true,
  });
  const plainGutterCount = countOccurrences(plain, 'class="rev01-code-gutter"');
  assert(
    plainGutterCount === expectedPlainLines,
    `plain gutter: expected ${String(expectedPlainLines)} gutter spans, got ${String(plainGutterCount)}`,
  );
  assert(
    plain.includes('data-line="3"'),
    'plain gutter: expected data-line="3" on the third gutter span',
  );
}

// --------------------------------------------------------------------------
// Extra sanity: every curated language round-trips. Catches a copy-paste
// slip in `LANG_LOADERS` that would otherwise only show up the first time
// the renderer hits that language in production.
// --------------------------------------------------------------------------
{
  const samples: Record<string, string> = {
    typescript: 'const x: number = 1;',
    javascript: 'const x = 1;',
    python: 'x = 1\nprint(x)',
    rust: 'fn main() { println!("hi"); }',
    go: 'package main\nfunc main() {}',
    json: '{"x": 1}',
    bash: 'echo hello',
    sql: 'SELECT 1;',
    html: '<div>hi</div>',
    css: '.a { color: red; }',
    markdown: '# Heading\n\nbody',
  };
  for (const [lang, src] of Object.entries(samples)) {
    assert(isSupportedLanguage(lang), `lang round-trip: ${lang} reported unsupported`);
    const html = highlightCode(src, lang as 'typescript', {
      styleKit: 'charcoal',
      showLineNumbers: false,
    });
    assert(html.startsWith('<pre'), `${lang}: highlight output should start with <pre>`);
    assert(html.includes('class="line"'), `${lang}: highlight should emit <span class="line">`);
  }
}

// --------------------------------------------------------------------------
// Renderer integration: full CodeElement → outer wrapper carries kit panel
// background and the kit mono font family.
// --------------------------------------------------------------------------
{
  const base = makeBaseElement();
  const el: CodeElement = {
    ...base,
    language: 'typescript',
    source: 'const x = 1;',
    showLineNumbers: true,
  };
  const out = renderCode(el, { styleKit: 'charcoal' });
  assert(out.startsWith('<div class="rev01-code-block"'), 'wrapper: expected rev01-code-block div');
  // Charcoal panel is #16171a — see `src/canvas/style-kits.ts`. We assert
  // the literal hex so a kit drift trips the smoke loudly.
  assert(
    out.includes('background:#16171a'),
    `wrapper: expected charcoal panel #16171a inline-style, got snippet head: ${out.slice(0, 200)}`,
  );
  // The inline style is HTML-attribute-escaped via `escapeCssValue` →
  // `escapeAttr`, so single quotes around the family name appear as the
  // entity reference `&#39;`. Asserting against the escaped form also
  // confirms the renderer's defensive escape is wired through.
  assert(
    out.includes('&#39;JetBrains Mono&#39;'),
    `wrapper: expected charcoal mono family "JetBrains Mono" (attribute-escaped) in inline style, got snippet head: ${out.slice(0, 240)}`,
  );
  assert(out.includes('data-language="typescript"'), 'wrapper: expected data-language attribute');
  assert(out.includes('data-line-numbers="true"'), 'wrapper: expected data-line-numbers="true"');
  assert(out.includes('rev01-code-gutter'), 'wrapper: expected gutter spans in inner HTML');
}

// --------------------------------------------------------------------------
// Bundle-size sanity log (informational). We round up the static-import
// payload sizes from `node_modules/@shikijs/*` so the wave can confirm the
// Worker stays under the 5MB compressed soft budget called out in the
// brief. This is *informational* — the smoke does not assert a hard cap
// because compression ratios depend on the bundler config.
//
// The numbers below are read at runtime via `fs.statSync` so a future
// Shiki update can be spotted without re-running `du`.
// --------------------------------------------------------------------------
{
  // Lazy import — only the smoke needs `node:fs`; the highlighter itself
  // never touches the filesystem (Workers do not have it).
  const fs = await import('node:fs');
  const pathParts = [
    '@shikijs/themes/dist/github-light.mjs',
    '@shikijs/langs/dist/typescript.mjs',
    '@shikijs/langs/dist/javascript.mjs',
    '@shikijs/langs/dist/python.mjs',
    '@shikijs/langs/dist/rust.mjs',
    '@shikijs/langs/dist/go.mjs',
    '@shikijs/langs/dist/json.mjs',
    '@shikijs/langs/dist/bash.mjs',
    '@shikijs/langs/dist/shellscript.mjs',
    '@shikijs/langs/dist/sql.mjs',
    '@shikijs/langs/dist/html.mjs',
    '@shikijs/langs/dist/css.mjs',
    '@shikijs/langs/dist/markdown.mjs',
    'shiki/dist/core.mjs',
    'shiki/dist/engine-javascript.mjs',
  ];
  let totalBytes = 0;
  for (const rel of pathParts) {
    const abs = `node_modules/${rel}`;
    try {
      const stat = fs.statSync(abs);
      totalBytes += stat.size;
    } catch {
      // Not fatal — if a file is missing the test would already have failed
      // upstream. We log a soft warning.
      process.stdout.write(`[code:smoke] (info) bundle-size probe missing ${abs}\n`);
    }
  }
  const totalKb = Math.round(totalBytes / 1024);
  process.stdout.write(
    `[code:smoke] (info) curated bundle subset ~${String(totalKb)}KB raw (11 langs + github-light + core + JS regex engine)\n`,
  );
  // Soft cap log — the Workers limit is 10MB compressed. Even unminified
  // and uncompressed we expect ~900KB; we log if we're over 3MB raw so a
  // future Shiki bump that pulls in a fat lang is visible.
  if (totalKb > 3072) {
    process.stdout.write(
      `[code:smoke] (warn) bundle subset > 3072KB raw — confirm Worker bundle stays under 5MB compressed\n`,
    );
  }
}

process.stdout.write('[code:smoke] OK — 4 assertions passed (highlight, fallback, gutter, sizes)\n');
