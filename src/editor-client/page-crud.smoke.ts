import type { EditorContext } from './editor-context.js';
import { findActionPageLinkReferences } from './page-crud.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pageRefAction(id: string, label: string): unknown {
  return {
    id,
    type: 'action',
    label: [{ text: label }],
    href: { type: 'page', pageId: 'target' },
  };
}

function refsFor(elements: unknown[]): string[] {
  const ctx = {
    state: {
      pages: [
        {
          id: 'home',
          title: 'Home',
          slug: '',
          sections: [{ id: 'sec-home', name: 'Main', elements }],
        },
        {
          id: 'target',
          title: 'Target',
          slug: 'target',
          sections: [],
        },
      ],
    },
  } as unknown as EditorContext;

  return findActionPageLinkReferences(ctx, 'target');
}

const directRefs = refsFor([pageRefAction('direct-cta', 'Direct CTA')]);
assert(
  directRefs.includes('Home / Main / Direct CTA'),
  'expected direct section action page refs to be detected',
);

const tabRefs = refsFor([
  {
    id: 'tabs',
    type: 'tabs',
    activeTabId: 'overview',
    tabs: [
      {
        id: 'overview',
        elements: [pageRefAction('tab-cta', 'Tab CTA')],
      },
    ],
  },
]);
assert(
  tabRefs.includes('Home / Main / Tab CTA'),
  'expected action page refs inside tabs to be detected',
);

const collectionRefs = refsFor([
  {
    id: 'collection',
    type: 'collection',
    entries: [[pageRefAction('collection-cta', 'Collection CTA')]],
  },
]);
assert(
  collectionRefs.includes('Home / Main / Collection CTA'),
  'expected action page refs inside collection entries to be detected',
);

console.log('[page-crud:smoke] OK');
