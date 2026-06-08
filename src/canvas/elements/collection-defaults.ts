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
 * Default outer-Container width/height the seed was authored against
 * (`DEFAULT_CARD_CONTAINER.box.w/h`). Exported as named constants so the
 * scale-to-host computation reads as "scale relative to the seed's native
 * canvas" rather than carrying magic numbers at the call site.
 */
const SEED_NATIVE_WIDTH = 320;
const SEED_NATIVE_HEIGHT = 360;

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
 * Codex review pass 5 finding 1 — accepts host Collection dimensions
 * (`hostBoxW`, `hostBoxH`) and proportionally scales every seeded child's
 * `box.x/y/w/h` so each child fits inside the host. The validator recurses
 * customTemplate against the Collection element's `box.w/h` (pass 1 F1's
 * parent-meta wiring), so an unscaled seed against a small host (e.g.
 * 200x200) produced 8 box-bound errors and blocked save/publish.
 *
 * Uniform scale `min(hostBoxW / SEED_NATIVE_WIDTH, hostBoxH /
 * SEED_NATIVE_HEIGHT, 1)` — capped at 1 so larger hosts do NOT upscale the
 * seed (the default layout would look stretched). The scale is uniform so
 * the seed's aspect ratios survive. All resulting box fields are rounded
 * to integers to avoid float-drift accumulating across save/publish cycles
 * (canvas geometry is whole-pixel per ADR 0011).
 *
 * Phase 2C (inspector wiring) and the Reset-template button are the
 * production callers; both pass the host Collection's id verbatim and the
 * host's current `box.w` / `box.h`.
 */
export function seedCustomTemplate(
  hostCollectionId: string,
  hostBoxW: number,
  hostBoxH: number,
): CanvasElement[] {
  const suffix = `--${hostCollectionId}`;
  const widthRatio = hostBoxW > 0 ? hostBoxW / SEED_NATIVE_WIDTH : 1;
  const heightRatio = hostBoxH > 0 ? hostBoxH / SEED_NATIVE_HEIGHT : 1;
  const scale = Math.min(widthRatio, heightRatio, 1);
  const scaleBox = (box: { x: number; y: number; w: number; h: number; z: number }): {
    x: number;
    y: number;
    w: number;
    h: number;
    z: number;
  } => ({
    x: Math.round(box.x * scale),
    y: Math.round(box.y * scale),
    w: Math.round(box.w * scale),
    h: Math.round(box.h * scale),
    z: box.z,
  });
  const cloneAndSuffix = <T extends CanvasElement>(source: T): T => {
    const clone = structuredClone(source);
    clone.id = `${source.id}${suffix}`;
    clone.box = scaleBox(source.box);
    return clone;
  };
  return [
    cloneAndSuffix(DEFAULT_CARD_TEMPLATE as ContainerElement),
    ...DEFAULT_CARD_SIBLINGS.map((sibling) => cloneAndSuffix(sibling)),
  ];
}
