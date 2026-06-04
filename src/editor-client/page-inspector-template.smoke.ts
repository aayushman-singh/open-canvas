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
//   7. DOM preview restore handles multiple text nodes under one parent.
//   8. Preview entry helpers filter drafts and key cache by page+collection.

import {
  filterPublishedTemplatePreviewEntries,
  isTemplatePreviewFetchCurrent,
  shouldRevertTemplatePreviewOnRender,
  substituteTemplatePlaceholderString,
  substituteTemplatePreviewInDom,
  templatePreviewCacheKey,
  revertTemplatePreviewInDom,
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

// 7. DOM preview restore handles multiple sibling text nodes under one parent.
{
  class FakeText {
    nodeType = 3;
    parentElement: FakeElement | null = null;
    constructor(public nodeValue: string | null) {}
  }

  class FakeElement {
    ownerDocument: FakeDocument;
    childNodes: Array<FakeText | FakeElement> = [];
    private attrs = new Map<string, string>();

    constructor(doc: FakeDocument) {
      this.ownerDocument = doc;
    }

    appendText(value: string): FakeText {
      const text = new FakeText(value);
      text.parentElement = this;
      this.childNodes.push(text);
      return text;
    }

    hasAttribute(name: string): boolean {
      return this.attrs.has(name);
    }

    setAttribute(name: string, value: string): void {
      this.attrs.set(name, value);
    }

    getAttribute(name: string): string | null {
      return this.attrs.get(name) ?? null;
    }

    removeAttribute(name: string): void {
      this.attrs.delete(name);
    }

    querySelectorAll(selector: string): FakeElement[] {
      assert(
        selector === '[data-opencanvas-placeholder-original]',
        'fake DOM only supports placeholder-original query',
      );
      const out: FakeElement[] = [];
      const visit = (node: FakeText | FakeElement): void => {
        if (node instanceof FakeElement) {
          if (node.hasAttribute('data-opencanvas-placeholder-original')) out.push(node);
          for (const child of node.childNodes) visit(child);
        }
      };
      visit(this);
      return out;
    }
  }

  class FakeDocument {
    createTreeWalker(scope: FakeElement): { nextNode(): FakeText | null } {
      const textNodes: FakeText[] = [];
      const visit = (node: FakeText | FakeElement): void => {
        if (node instanceof FakeText) {
          textNodes.push(node);
          return;
        }
        for (const child of node.childNodes) visit(child);
      };
      visit(scope);
      let idx = 0;
      return {
        nextNode(): FakeText | null {
          const next = textNodes[idx] ?? null;
          idx += 1;
          return next;
        },
      };
    }
  }

  const doc = new FakeDocument();
  const root = new FakeElement(doc);
  const parent = new FakeElement(doc);
  root.childNodes.push(parent);
  parent.appendText('{{title}}');
  parent.appendText(' by {{author}}');

  const entry = makeEntry({ title: 'Preview title', author: 'Preview author' });
  substituteTemplatePreviewInDom(root as unknown as Element, entry);
  assert(
    (parent.childNodes[0] as FakeText).nodeValue === 'Preview title' &&
      (parent.childNodes[1] as FakeText).nodeValue === ' by Preview author',
    'DOM preview must substitute every matching text node',
  );
  revertTemplatePreviewInDom(root as unknown as Element);
  assert(
    (parent.childNodes[0] as FakeText).nodeValue === '{{title}}' &&
      (parent.childNodes[1] as FakeText).nodeValue === ' by {{author}}',
    'DOM preview revert must restore every substituted text node',
  );
}

// 8. Preview helpers keep publish parity and avoid cache leakage.
{
  const published = makeEntry({ id: 'published', status: 'published' });
  const draft = { ...makeEntry({ id: 'draft' }), status: 'draft' };
  const missingStatus = makeEntry({ id: 'missing-status' });
  const filtered = filterPublishedTemplatePreviewEntries([published, draft, missingStatus]);
  assert(
    filtered.length === 1 && filtered[0]!.id === 'published',
    'preview entries must exclude drafts',
  );

  assert(
    templatePreviewCacheKey('page-1', 'blog') !== templatePreviewCacheKey('page-1', 'notes'),
    'preview cache key must include collectionSlug',
  );
  assert(
    isTemplatePreviewFetchCurrent({ id: 'page-1', collectionSlug: 'blog' }, 'page-1', 'blog'),
    'fetch result must be current when page and collection match',
  );
  assert(
    !isTemplatePreviewFetchCurrent({ id: 'page-1', collectionSlug: 'notes' }, 'page-1', 'blog'),
    'fetch result must be stale when collection changed on the same page',
  );
  assert(
    shouldRevertTemplatePreviewOnRender('page-1', {
      id: 'page-1',
      pageKind: 'collection-item-template',
    }),
    'active preview must revert before same-page inspector re-render',
  );
}

console.log('[page-inspector-template:smoke] OK');
