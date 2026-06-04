// src/editor-client/page-inspector-template.smoke.ts
//
// ADR 0060 Pass 2 — exercises the placeholder substitution helper used by
// the editor's template preview panel. The DOM walker is exercised
// indirectly: bare Bun has no DOM, so the smoke targets the pure
// string-in/string-out function `substituteTemplatePlaceholderString`
// (the same shape the publish-time materializer uses, ensuring the editor
// preview matches what publish renders).
//
// Coverage:
//   1. Every known `{{field}}` token substitutes from the entry row.
//   2. `{{tag}}` resolves to the entry's first tag (empty string when none).
//   3. Unknown `{{thing}}` tokens are left intact (user-authored
//      mustache-shaped copy survives the preview).
//   4. Repeated tokens substitute every occurrence (the publisher does the
//      same, so the preview must too).
//   5. Empty string input + empty entry fields produce an empty string.
//   6. Multi-line text is preserved across substitutions.

import {
  substituteTemplatePlaceholderString,
  type TemplatePreviewEntry,
} from './page-inspector.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[page-inspector-template:smoke] ' + message);
}

function makeEntry(overrides: Partial<TemplatePreviewEntry> = {}): TemplatePreviewEntry {
  return {
    id: 'entry-1',
    slug: 'hello-world',
    title: 'Hello, World',
    excerpt: 'A short excerpt.',
    body: 'The body text.',
    publishedDate: '2026-06-04',
    author: 'Aayushman',
    category: 'blog',
    tags: ['notes', 'design'],
    ...overrides,
  };
}

// 1. Each known field substitutes.
{
  const entry = makeEntry();
  assert(
    substituteTemplatePlaceholderString('{{title}}', entry) === 'Hello, World',
    'title token must substitute',
  );
  assert(
    substituteTemplatePlaceholderString('{{excerpt}}', entry) === 'A short excerpt.',
    'excerpt token must substitute',
  );
  assert(
    substituteTemplatePlaceholderString('{{body}}', entry) === 'The body text.',
    'body token must substitute',
  );
  assert(
    substituteTemplatePlaceholderString('{{publishedDate}}', entry) === '2026-06-04',
    'publishedDate token must substitute',
  );
  assert(
    substituteTemplatePlaceholderString('{{author}}', entry) === 'Aayushman',
    'author token must substitute',
  );
  assert(
    substituteTemplatePlaceholderString('{{category}}', entry) === 'blog',
    'category token must substitute',
  );
  assert(
    substituteTemplatePlaceholderString('{{slug}}', entry) === 'hello-world',
    'slug token must substitute',
  );
}

// 2. `{{tag}}` resolves to the first tag, or '' when none.
{
  const entry = makeEntry();
  assert(
    substituteTemplatePlaceholderString('{{tag}}', entry) === 'notes',
    'tag token must resolve to the first tag',
  );
  const empty = makeEntry({ tags: [] });
  assert(
    substituteTemplatePlaceholderString('{{tag}}', empty) === '',
    'tag token must be empty when tags is empty',
  );
}

// 3. Unknown tokens pass through unchanged.
{
  const entry = makeEntry();
  const input = 'Read {{author}} on {{unknownField}} for {{title}}';
  const expected = 'Read Aayushman on {{unknownField}} for Hello, World';
  assert(
    substituteTemplatePlaceholderString(input, entry) === expected,
    'unknown tokens must pass through unchanged',
  );
}

// 4. Repeated tokens — every occurrence substituted.
{
  const entry = makeEntry();
  const input = '{{title}} — {{title}} — {{title}}';
  const expected = 'Hello, World — Hello, World — Hello, World';
  assert(
    substituteTemplatePlaceholderString(input, entry) === expected,
    'every occurrence of a token must be substituted',
  );
}

// 5. Empty input -> empty output (no spurious replacement).
{
  const entry = makeEntry({ title: '', excerpt: '' });
  assert(
    substituteTemplatePlaceholderString('', entry) === '',
    'empty input must produce empty output',
  );
  assert(
    substituteTemplatePlaceholderString('{{title}}{{excerpt}}', entry) === '',
    'empty-field substitutions must concatenate cleanly',
  );
}

// 6. Multi-line preservation.
{
  const entry = makeEntry();
  const input = 'Title: {{title}}\nBy {{author}}\n\n{{body}}';
  const expected = 'Title: Hello, World\nBy Aayushman\n\nThe body text.';
  assert(
    substituteTemplatePlaceholderString(input, entry) === expected,
    'multi-line layout must survive substitution',
  );
}

console.log('[page-inspector-template:smoke] OK');
