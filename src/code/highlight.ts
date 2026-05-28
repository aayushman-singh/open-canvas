// src/code/highlight.ts
//
// Code Snippet — Shiki wrapper, fine-grained bundle, **synchronous**.
//
// We load EXACTLY the
// 11 curated languages + 1 light theme + the JavaScript regex engine.
// The umbrella `shiki` entry pulls in every language and theme on the
// planet (multi-MB) and is forbidden inside the Worker.
//
// SYNCHRONOUS RENDER PATH
// -----------------------
// `RENDER_DISPATCH['code']` is sync — `renderCanvasSnapshot` does not
// `await` the dispatch table. To honour that contract we use
// `createHighlighterCoreSync` paired with `createJavaScriptRegexEngine()`,
// which avoids the WASM init path entirely. Static imports of the curated
// 11 langs + 1 theme eager-bundle ~800KB of grammars at build time — that
// fits well inside the Worker's 10MB compressed budget and skips the
// runtime async dance.
//
// The previous async / WASM-engine sketch would have required pre-warming
// the highlighter before `renderCanvasSnapshot` (a sync function) was
// called, which would mean editing `src/routes/api/publish.ts`. The sync
// engine sidesteps the problem cleanly.
//
// Failure policy: if Shiki throws on a token it cannot lex, we let the
// error propagate. Unsupported *languages* fall back to a plain pre/code
// snippet via `renderPlainCodeSnippet`; any other failure is loud per the
// global "no silent fallbacks" rule.

import {
  createHighlighterCoreSync,
  type HighlighterCore,
} from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import githubLight from '@shikijs/themes/github-light';
import bash from '@shikijs/langs/bash';
import css from '@shikijs/langs/css';
import go from '@shikijs/langs/go';
import html from '@shikijs/langs/html';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import markdown from '@shikijs/langs/markdown';
import python from '@shikijs/langs/python';
import rust from '@shikijs/langs/rust';
import sql from '@shikijs/langs/sql';
import typescript from '@shikijs/langs/typescript';

import { CODE_LANGUAGES, type CodeLanguage } from '../canvas/elements/code.js';
import { themeForStyleKit, SHIKI_LIGHT_THEME } from './theme-map.js';

// --------------------------------------------------------------------------
// Synchronous highlighter singleton. One instance per Worker isolate; lives
// for the isolate's lifetime. The first render in a fresh isolate pays the
// grammar-compile cost (~5-15ms typical for 11 langs); every subsequent
// render is a pure-JS regex pass.
// --------------------------------------------------------------------------

let highlighter: HighlighterCore | null = null;

/**
 * Lazily build (or return the cached) Shiki highlighter loaded with our
 * curated 11-language + 1-theme bundle. Worker-isolate-scoped.
 *
 * Exposed for the smoke test (so it can confirm warmup is idempotent) and
 * for the renderer, which calls it once per render and gets the cached
 * instance back instantly.
 */
export function getHighlighter(): HighlighterCore {
  if (highlighter === null) {
    highlighter = createHighlighterCoreSync({
      themes: [githubLight],
      langs: [
        typescript,
        javascript,
        python,
        rust,
        go,
        json,
        bash,
        sql,
        html,
        css,
        markdown,
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighter;
}

/**
 * Type guard for the curated language list. Used by the render path and
 * the smoke test to gate Shiki vs the plain-text fallback.
 */
export function isSupportedLanguage(lang: string): lang is CodeLanguage {
  return (CODE_LANGUAGES as readonly string[]).includes(lang);
}

// --------------------------------------------------------------------------
// Highlight context + main entry.
// --------------------------------------------------------------------------

export interface HighlightCtx {
  /** Active Style Kit name. Drives theme selection via `themeForStyleKit`. */
  styleKit: string;
  /** When true, each rendered line carries a `.rev01-code-gutter` span. */
  showLineNumbers: boolean;
}

/**
 * Highlight `source` as `language` and return ready-to-paste HTML. The
 * returned string is a `<pre class="shiki ...">…</pre>` block with inline
 * `style="color: ..."` spans per token. The caller (`renderCode`) wraps it
 * with kit-themed surface chrome.
 *
 * Unsupported language: this function ONLY runs when the language is
 * curated; passing an unsupported language is a programming error and
 * throws loudly (callers must check `isSupportedLanguage(...)` first and
 * route to `renderPlainCodeSnippet`).
 */
export function highlightCode(
  source: string,
  language: CodeLanguage,
  ctx: HighlightCtx,
): string {
  const hl = getHighlighter();
  const theme = themeForStyleKit(ctx.styleKit);
  return hl.codeToHtml(source, {
    lang: language,
    theme,
    transformers: ctx.showLineNumbers
      ? [
          {
            // Wrap each rendered line with a leading
            // `<span class="rev01-code-gutter" data-line="N">N</span>`.
            // Shiki emits one `<span class="line">` per source line; the
            // `line` transformer hook lets us mutate the HAST node before
            // serialization. We prepend the gutter element so the number
            // shows up before any token spans.
            line(node, line) {
              node.children.unshift({
                type: 'element',
                tagName: 'span',
                properties: {
                  class: 'rev01-code-gutter',
                  'data-line': String(line),
                },
                children: [{ type: 'text', value: String(line) }],
              });
              // Stamp `data-line` on the line wrapper too — useful for
              // future per-line styling (e.g., scroll-to-line).
              const props = node.properties as Record<string, unknown>;
              props['data-line'] = String(line);
            },
          },
        ]
      : [],
  });
}

/**
 * Plain-text fallback for unsupported languages. Renders a `<pre><code>`
 * with the Style Kit's mono font; the source is HTML-escaped so untrusted
 * content cannot break out.
 *
 * Lives here (not in code.ts) so the smoke test can hit it directly and so
 * the "Shiki vs plain" decision sits in one module.
 */
export function renderPlainCodeSnippet(
  source: string,
  language: string,
  ctx: HighlightCtx,
): string {
  const escaped = escapeHtmlForCode(source);
  const inner = ctx.showLineNumbers ? wrapLinesWithGutter(escaped) : escaped;
  // `data-lang` lets the published snapshot carry the originally-requested
  // language even when we could not highlight it.
  return `<pre class="rev01-code rev01-code-plain" data-lang="${escapeAttrLite(language)}" style="font-family:var(--rev01-kit-font-mono);"><code>${inner}</code></pre>`;
}

// --------------------------------------------------------------------------
// Internal helpers. Kept private — the renderer never imports these.
// --------------------------------------------------------------------------

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

const ATTR_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtmlForCode(value: string): string {
  return value.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function escapeAttrLite(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ATTR_ESCAPES[ch] ?? ch);
}

function wrapLinesWithGutter(escaped: string): string {
  // `escaped` is already HTML-safe. Each source line becomes its own
  // `<span class="line">` so the gutter span sits before the content; this
  // matches Shiki's `<span class="line">` shape, so the published CSS can
  // style both highlighted and plain code with the same rules.
  const sourceLines = escaped.split('\n');
  return sourceLines
    .map((lineText, idx) => {
      const lineNumber = idx + 1;
      const gutter = `<span class="rev01-code-gutter" data-line="${String(lineNumber)}">${String(lineNumber)}</span>`;
      return `<span class="line" data-line="${String(lineNumber)}">${gutter}${lineText}</span>`;
    })
    .join('\n');
}

// Re-export so the rest of the wave can resolve "what theme are we using
// today?" through this single entry point.
export { SHIKI_LIGHT_THEME, themeForStyleKit };
