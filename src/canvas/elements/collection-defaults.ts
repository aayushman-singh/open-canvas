// src/canvas/elements/collection-defaults.ts
//
// ADR 0063 dec 4 — built-in card template used by the materializer when
// `CollectionElement.display === 'card'`. The exported `DEFAULT_CARD_TEMPLATE`
// is the outer Container shell (`preset: 'card'`, linkable surface). Per-
// entry siblings (image, headline, excerpt, Read-more button) live as
// additional constants in this module so the materializer assembles full
// entry instances from one source of truth — adding fields to the default
// card layout means editing this file, never the materializer.
//
// `linkHref.url` and `linkLabel` carry `{{slug}}` / `{{title}}` tokens that
// the materializer's substituteInValue walk resolves per entry. The outer
// linkHref is also overwritten directly by the materializer with the full
// `/<collectionSlug>/<entry.slug>` URL because the collection slug isn't on
// the entry row — it lives on the CollectionElement.

import type { CanvasElement } from '../schema.js';
import type { ActionElement } from './action.js';
import type { ContainerElement } from './container.js';
import type { ImageMediaElement } from './media.js';
import type { TextElement } from './text.js';

const DEFAULT_CARD_CONTAINER: ContainerElement = {
  id: 'card-default-root',
  type: 'container',
  box: { x: 0, y: 0, w: 320, h: 360, z: 1 },
  variant: 'raised',
  preset: 'card',
  linkHref: { type: 'external', url: '/{{slug}}' },
  linkLabel: '{{title}}',
};

const DEFAULT_CARD_IMAGE: ImageMediaElement = {
  id: 'card-default-image',
  type: 'media',
  mediaKind: 'image',
  box: { x: 0, y: 0, w: 320, h: 180, z: 2 },
  assetId: '{{ogImageAssetId}}',
  alt: '{{title}}',
  fit: 'cover',
};

const DEFAULT_CARD_TITLE: TextElement = {
  id: 'card-default-title',
  type: 'text',
  box: { x: 16, y: 196, w: 288, h: 32, z: 3 },
  content: [{ text: '{{title}}' }],
  role: 'heading',
  fontSize: 20,
  fontWeight: 600,
  align: 'left',
};

const DEFAULT_CARD_EXCERPT: TextElement = {
  id: 'card-default-excerpt',
  type: 'text',
  box: { x: 16, y: 236, w: 288, h: 72, z: 4 },
  content: [{ text: '{{excerpt}}' }],
  role: 'body',
  fontSize: 14,
  fontWeight: 400,
  align: 'left',
};

const DEFAULT_CARD_BUTTON: ActionElement = {
  id: 'card-default-cta',
  type: 'action',
  box: { x: 16, y: 316, w: 120, h: 36, z: 5 },
  label: [{ text: 'Read more' }],
  variant: 'outline',
  href: { type: 'external', url: '/{{slug}}' },
};

/**
 * Built-in default card template — the outer Container surface the
 * materializer clones per entry when `CollectionElement.display === 'card'`.
 *
 * Per ADR 0063 dec 6 the whole card surface links to the entry detail page;
 * the materializer overwrites `linkHref.url` with
 * `/<collectionSlug>/<entry.slug>` at clone time (collection slug isn't on
 * the entry row), and `linkLabel`'s `{{title}}` token resolves via the
 * substituteInValue walk.
 *
 * `Readonly<...>` advertises the single-source-of-truth status; the
 * materializer deep-clones before any per-entry mutation.
 */
export const DEFAULT_CARD_TEMPLATE: Readonly<ContainerElement> = DEFAULT_CARD_CONTAINER;

/**
 * Per-entry sibling elements that accompany `DEFAULT_CARD_TEMPLATE`. Together
 * with the outer Container they form the full per-entry instance array the
 * materializer writes into the Collection's materialized children.
 *
 * Siblings are positioned absolutely against the same origin as the outer
 * Container (the canvas layout model is flat); the renderer composes the
 * "nested" card look from the shared origin + z-order, not from a children
 * field (canvas Containers have none — ADR 0011 dec 1).
 */
export const DEFAULT_CARD_SIBLINGS: readonly [
  ImageMediaElement,
  TextElement,
  TextElement,
  ActionElement,
] = [DEFAULT_CARD_IMAGE, DEFAULT_CARD_TITLE, DEFAULT_CARD_EXCERPT, DEFAULT_CARD_BUTTON];

/**
 * ADR 0065 D3 — seed payload for `CollectionElement.customTemplate` on the
 * first switch to `display === 'custom'`. Returns a fresh deep clone of the
 * outer Container + per-entry sibling tuple so the Owner immediately sees an
 * editable, customisable card.
 *
 * Per-Collection id disambiguation (codex review pass 1): every seeded
 * element's `id` is suffixed with `--<hostCollectionId>` so two Collections
 * on the same page that both switch to `'custom'` do not collide on the
 * built-in `card-default-root` / `card-default-image` / ... ids. The page-
 * level uniqueness check in `src/canvas/validate.ts` recurses into
 * `customTemplate` (ADR 0065 D2), so an unsuffixed seed would fail
 * validation and block save/publish. The suffix scheme mirrors the per-
 * entry suffix scheme used by `collection-materializer.ts`'s
 * `cloneAndSubstituteTemplate` (`${baseId}--${entry.slug}`); the seeder
 * uses `${baseId}--${collectionId}` so seed ids and materialized ids never
 * collide either (the materializer's output suffix carries an entry slug,
 * not a Collection id).
 *
 * Implemented via `structuredClone` rather than `JSON.parse(JSON.stringify(...))`
 * so future template defaults carrying non-JSON values (Date, Map) still
 * survive the seed. ADR 0065 D3 failure path: a `structuredClone` throw
 * surfaces to the caller — there is no silent empty-template fallback.
 *
 * Phase 2C (inspector wiring) and the Reset-template button are the
 * production callers; both pass the host Collection's id verbatim.
 */
export function seedCustomTemplate(hostCollectionId: string): CanvasElement[] {
  const suffix = `--${hostCollectionId}`;
  const cloneAndSuffix = <T extends CanvasElement>(source: T): T => {
    const clone = structuredClone(source);
    clone.id = `${source.id}${suffix}`;
    return clone;
  };
  return [
    cloneAndSuffix(DEFAULT_CARD_TEMPLATE as ContainerElement),
    ...DEFAULT_CARD_SIBLINGS.map((sibling) => cloneAndSuffix(sibling)),
  ];
}
