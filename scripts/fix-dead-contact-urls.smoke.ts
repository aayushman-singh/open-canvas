import type { CanvasElement, CanvasPage, CanvasSection, EditableSite } from '../src/canvas/schema.js';
import { rewriteDeadContactUrlsInState } from './fix-dead-contact-urls.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[fix-dead-contact-urls:smoke] ${message}`);
}

function action(id: string, url: string): CanvasElement {
  return {
    id,
    type: 'action',
    box: { x: 0, y: 0, w: 100, h: 40, z: 1 },
    label: 'Contact sales',
    href: { type: 'external', url },
    variant: 'solid',
  } as CanvasElement;
}

function section(id: string, elements: CanvasElement[]): CanvasSection {
  return {
    id,
    name: id,
    x: 0,
    y: 0,
    width: 1200,
    height: 400,
    background: '#fff',
    elements,
  };
}

function page(id: string, slug: string, elements: CanvasElement[]): CanvasPage {
  return {
    id,
    slug,
    title: slug,
    width: 1200,
    sections: [section(`${id}-hero`, elements)],
  };
}

function state(pages: CanvasPage[]): EditableSite {
  return { styleKit: 'charcoal', pages };
}

const affected = state([page('home', 'index', [action('cta', '/contact')])]);
const affectedTouched = rewriteDeadContactUrlsInState(affected);
assert(affectedTouched === 1, `expected one fixture-derived URL rewrite, got ${String(affectedTouched)}`);
const affectedAction = affected.pages[0]?.sections[0]?.elements[0];
assert(
  affectedAction?.type === 'action' &&
    affectedAction.href.type === 'external' &&
    affectedAction.href.url === 'mailto:hello@example.com',
  'expected fixture-derived /contact action to be rewritten to mailto',
);

const legitimateContactPage = state([
  page('contact', 'contact', []),
  page('home', 'index', [action('contact-link', '/contact')]),
]);
const legitimateTouched = rewriteDeadContactUrlsInState(legitimateContactPage);
assert(
  legitimateTouched === 0,
  `expected state with a real contact page to be skipped, got ${String(legitimateTouched)} rewrites`,
);
const legitimateAction = legitimateContactPage.pages[1]?.sections[0]?.elements[0];
assert(
  legitimateAction?.type === 'action' &&
    legitimateAction.href.type === 'external' &&
    legitimateAction.href.url === '/contact',
  'expected legitimate /contact action to remain untouched',
);

console.log('[fix-dead-contact-urls:smoke] OK');
