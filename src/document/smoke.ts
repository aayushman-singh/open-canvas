// src/document/smoke.ts
//
// Manual smoke runner. Loads each fixture, validates it, renders the valid
// ones, and writes preview HTML next to the fixture. Exits non-zero if any
// fixture validates against expectation.
//
// Run with: bun run src/document/smoke.ts (or `bun run document:smoke`).

import { renderDoc } from './render.js';
import type { DocumentJSON, ThemeTokenSet } from './schema.js';
import { validateDocument, type ValidationResult } from './validate.js';

declare const Bun: {
  file: (path: string) => { text: () => Promise<string> };
  write: (path: string, data: string) => Promise<number>;
};
declare const process: { exit: (code: number) => never; cwd: () => string };

const FIXTURES_DIR = 'src/document/fixtures';

interface FixtureCase {
  name: string;
  expectValid: boolean;
  /** Substrings expected to appear in the error list when invalid. */
  expectedErrorMatches?: string[];
}

const CASES: FixtureCase[] = [
  { name: 'minimal', expectValid: true },
  { name: 'rich', expectValid: true },
  {
    name: 'invalid',
    expectValid: false,
    expectedErrorMatches: [
      'attrs.kind',
      'attrs.padding',
      'attrs.level',
      'attrs.align',
      'image src',
      'iframe host',
      'unknown block type "quote"',
      'unknown block type "action"',
      'section requires at least 1 child(ren)',
      'text nodes must not have content',
      'unknown mark type "strike"',
    ],
  },
];

const THEME: ThemeTokenSet = {
  paletteSeed: '#2bb1ff',
  font: { heading: 'IBM Plex Sans', body: 'IBM Plex Serif' },
  radius: 'md',
  density: 'normal',
};

let failed = false;

for (const c of CASES) {
  const path = `${FIXTURES_DIR}/${c.name}.json`;
  const text = await Bun.file(path).text();
  const parsed: unknown = JSON.parse(text);
  const result: ValidationResult = validateDocument(parsed);

  if (c.expectValid) {
    if (!result.valid) {
      failed = true;
      console.error(`[smoke] ${c.name}: expected valid, got errors:`);
      for (const e of result.errors) console.error(`  - ${e}`);
      continue;
    }
    console.log(`[smoke] ${c.name}: valid (${countNodes(parsed as DocumentJSON)} nodes)`);
    const html = renderDoc(parsed as DocumentJSON, THEME);
    if (!html.startsWith('<article')) {
      failed = true;
      console.error(`[smoke] ${c.name}: render output did not start with <article>`);
    }
    const previewPath = `${FIXTURES_DIR}/${c.name}.preview.html`;
    await Bun.write(previewPath, wrapPreview(c.name, html));
    console.log(`[smoke] ${c.name}: rendered -> ${previewPath}`);
  } else {
    if (result.valid) {
      failed = true;
      console.error(`[smoke] ${c.name}: expected invalid, got valid`);
      continue;
    }
    console.log(`[smoke] ${c.name}: invalid (${result.errors.length} errors)`);
    for (const e of result.errors) console.log(`  - ${e}`);
    const missing = (c.expectedErrorMatches ?? []).filter(
      (m) => !result.errors.some((e) => e.includes(m)),
    );
    if (missing.length > 0) {
      failed = true;
      console.error(`[smoke] ${c.name}: missing expected error substrings:`);
      for (const m of missing) console.error(`  - ${m}`);
    }
  }
}

if (failed) {
  console.error('[smoke] FAILED');
  process.exit(1);
}
console.log('[smoke] OK');

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function countNodes(doc: DocumentJSON): number {
  let n = 0;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    n++;
    const content = (node as { content?: unknown[] }).content;
    if (Array.isArray(content)) for (const child of content) walk(child);
  };
  walk(doc);
  return n;
}

function wrapPreview(name: string, html: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>rev01 fixture preview — ${escHtml(name)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #0b1020; color: #e6e8f2; }
  .rev01-doc { background: #fff; color: #111; padding: 24px; border-radius: 12px; max-width: 960px; margin: 0 auto; }
  .rev01-doc section { padding: 16px 0; border-bottom: 1px solid #eee; }
  .rev01-doc section:last-child { border-bottom: 0; }
  .rev01-doc .align-center { text-align: center; }
  .rev01-doc .align-end { text-align: right; }
  .rev01-doc .columns { display: grid; gap: 16px; }
  .rev01-doc .columns-2 { grid-template-columns: repeat(2, 1fr); }
  .rev01-doc .columns-3 { grid-template-columns: repeat(3, 1fr); }
  .rev01-doc .columns-4 { grid-template-columns: repeat(4, 1fr); }
  .rev01-doc img, .rev01-doc video, .rev01-doc iframe { max-width: 100%; }
  .rev01-doc .divider-space { height: 24px; }
  .rev01-doc .actions { display: flex; gap: 12px; }
  .rev01-doc .actions.align-center { justify-content: center; }
  .rev01-doc a[data-variant="primary"] { background: #2bb1ff; color: #fff; padding: 8px 14px; border-radius: 6px; text-decoration: none; }
  .rev01-doc a[data-variant="secondary"] { border: 1px solid #2bb1ff; color: #2bb1ff; padding: 8px 14px; border-radius: 6px; text-decoration: none; }
  .rev01-doc a[data-variant="ghost"] { color: #2bb1ff; text-decoration: underline; }
  header { color: #9ca3af; font-family: ui-monospace, monospace; margin-bottom: 16px; }
</style>
</head>
<body>
<header>rev01 / src/document / fixture: ${escHtml(name)}</header>
${html}
</body>
</html>
`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
