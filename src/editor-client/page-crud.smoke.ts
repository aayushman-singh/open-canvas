import type { EditorContext } from './editor-context.js';
import { findActionPageLinkReferences, openPageSeoAfterSave } from './page-crud.js';

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

async function flushSeoOpenMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

{
  const globalWindow = globalThis as unknown as { window?: unknown };
  const originalWindow = globalWindow.window;
  const opened = {
    opener: {} as unknown,
    closed: false,
    location: { href: '' },
    close() {
      this.closed = true;
    },
  };
  const events: string[] = [];
  globalWindow.window = {
    open(url: string, target: string) {
      events.push('open:' + url + ':' + target);
      return opened;
    },
  };
  const ctx = {
    flushPendingSave: () => {
      events.push('flush');
      return Promise.resolve(true);
    },
    setStatus(message: string) {
      events.push('status:' + message);
    },
  } as unknown as EditorContext;

  try {
    openPageSeoAfterSave(ctx, '/dashboard/sites/site-1/settings/seo?page=home');
    await flushSeoOpenMicrotasks();
  } finally {
    globalWindow.window = originalWindow;
  }

  assert(
    events[0] === 'open:about:blank:_blank' && events[1] === 'flush',
    'SEO helper must reserve a tab synchronously before awaiting the save flush',
  );
  assert(opened.opener === null, 'SEO helper must sever opener on the reserved tab');
  assert(
    opened.location.href === '/dashboard/sites/site-1/settings/seo?page=home',
    'SEO helper must navigate the reserved tab after a successful save flush',
  );
  assert(!opened.closed, 'SEO helper must keep the reserved tab open after a successful save');
}

{
  const globalWindow = globalThis as unknown as { window?: unknown };
  const originalWindow = globalWindow.window;
  const opened = {
    opener: {} as unknown,
    closed: false,
    location: { href: '' },
    close() {
      this.closed = true;
    },
  };
  globalWindow.window = {
    open() {
      return opened;
    },
  };
  const ctx = {
    flushPendingSave: () => Promise.resolve(false),
    setStatus() {},
  } as unknown as EditorContext;

  try {
    openPageSeoAfterSave(ctx, '/dashboard/sites/site-1/settings/seo?page=home');
    await flushSeoOpenMicrotasks();
  } finally {
    globalWindow.window = originalWindow;
  }

  assert(opened.closed, 'SEO helper must close the reserved tab when save flush fails');
  assert(opened.location.href === '', 'SEO helper must not navigate after save flush failure');
}

{
  const globalWindow = globalThis as unknown as { window?: unknown };
  const originalWindow = globalWindow.window;
  const events: string[] = [];
  globalWindow.window = {
    open() {
      return null;
    },
  };
  const ctx = {
    flushPendingSave: () => {
      events.push('flush');
      return Promise.resolve(true);
    },
    setStatus(message: string) {
      events.push(message);
    },
  } as unknown as EditorContext;

  try {
    openPageSeoAfterSave(ctx, '/dashboard/sites/site-1/settings/seo?page=home');
  } finally {
    globalWindow.window = originalWindow;
  }

  assert(
    events.includes('Could not open SEO panel: popup blocked'),
    'SEO helper must surface popup blocking to the status line',
  );
  assert(!events.includes('flush'), 'SEO helper must not flush save after popup blocking');
}

console.log('[page-crud:smoke] OK');
