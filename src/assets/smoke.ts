// src/assets/smoke.ts
//
// `bun run assets:smoke` — exercises the asset pipeline against in-memory
// stubs of R2 and the DB. The smoke avoids the live Neon DB and the live R2
// binding because the route layer is not the unit under test here — the
// upload / read / delete primitives are.
//
// Coverage (per the brief's 0.6.E spec):
//
//   1. Upload of a 32-byte PNG returns the expected
//      {id, contentHash, r2Key, width, height, byteSize: 32}; sha256 matches.
//   2. Re-upload of the same bytes by the same Owner returns the SAME row
//      (dedup); no new R2 put.
//   3. Re-upload of the same bytes by a DIFFERENT Owner returns a NEW row
//      (Owner-rooted), shares the R2 object.
//   4. Read of `/assets/:contentHash` returns the stored bytes with the
//      correct Content-Type and the immutable Cache-Control.
//   5. Read with `?w=200` triggers the cf.image subrequest with the right
//      transform options.
//   6. Delete without confirm returns the reference report
//      (status = confirm_required).
//   7. Delete with confirm removes the row and the R2 object when no
//      siblings remain; the sibling-aware path keeps the R2 object when
//      another ownerAsset row points at the same contentHash.
//   8. Lottie JSON uploads are first-class owner assets and bypass image
//      transforms on read.

import { deleteOwnerAsset } from './delete.js';
import { sha256Hex } from './hash.js';
import { readOwnerAsset, type CfImageFetcher, type CfImageOptions } from './read.js';
import { createR2Client, type R2BucketLike, type R2PutOptions } from './r2-client.js';
import { uploadOwnerAsset, UploadAssetError } from './upload.js';
import {
  collectReferencedAssets,
  collectReferencedAssetIds,
  collectUnfilledAssetReferences,
  isAssetSubstitutionToken,
  type AssetReferenceRoot,
} from './site-assets.js';
import type { CanvasElement, CanvasPage, EditableSite } from '../canvas/schema.js';
import { seedCustomTemplate } from '../canvas/elements/collection-defaults.js';
import { prepareSeedAssetsForCustomer } from '../routes/api/sites.js';
import type { Db } from '../db/client.js';
import { ownerAsset, site, slotHistory } from '../db/schema.js';
import type { OwnerAssetKind } from './kinds.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[assets:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// In-memory R2 mock
// ---------------------------------------------------------------------------

interface MockR2Entry {
  bytes: Uint8Array;
  contentType: string;
}

class MockR2 implements R2BucketLike {
  store = new Map<string, MockR2Entry>();
  putCount = 0;
  conditionalMissCount = 0;

  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    if (options?.onlyIf?.etagDoesNotMatch === '*' && this.store.has(key)) {
      this.conditionalMissCount += 1;
      return Promise.resolve(null);
    }
    if (typeof value === 'string') {
      throw new Error('mock R2 does not accept string put bodies');
    }
    if (value instanceof ReadableStream) {
      throw new Error('mock R2 does not accept ReadableStream put bodies');
    }
    let bytes: Uint8Array;
    if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value.slice(0));
    } else {
      const view = value;
      bytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    }
    this.store.set(key, {
      bytes,
      contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream',
    });
    this.putCount += 1;
    return Promise.resolve(makeR2Object(key, this.store.get(key)!.contentType));
  }

  get(key: string): Promise<R2ObjectBody | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    return Promise.resolve(makeR2ObjectBody(key, entry));
  }

  head(key: string): Promise<R2Object | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    return Promise.resolve(makeR2Object(key, entry.contentType));
  }

  delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) this.store.delete(k);
    return Promise.resolve();
  }
}

function makeR2Object(key: string, contentType: string): R2Object {
  // The real R2Object has many more fields; we expose the subset the
  // production wrapper reads. The cast is intentional because the mock is
  // only ever used through the typed surface we control.
  return {
    key,
    httpMetadata: { contentType },
    customMetadata: {},
  } as unknown as R2Object;
}

function makeR2ObjectBody(key: string, entry: MockR2Entry): R2ObjectBody {
  const responseForBody = new Response(entry.bytes);
  return {
    key,
    httpMetadata: { contentType: entry.contentType },
    customMetadata: {},
    body: responseForBody.body!,
    arrayBuffer: () => Promise.resolve(entry.bytes.buffer.slice(0)),
    text: () => Promise.resolve(new TextDecoder().decode(entry.bytes)),
    json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(entry.bytes)) as unknown),
    blob: () => Promise.resolve(new Blob([entry.bytes], { type: entry.contentType })),
  } as unknown as R2ObjectBody;
}

// ---------------------------------------------------------------------------
// Fake bytes
// ---------------------------------------------------------------------------

function makePng32(): Uint8Array {
  // Hand-crafted 32-byte payload: a real PNG signature so the image probe
  // recognises it, padded with zeros to hit exactly 32 bytes. The probe
  // expects the IHDR width/height at offsets 16..24 BE — we set width=1,
  // height=1 so the dimensions assert below passes.
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR length (13) at 8..12, type at 12..16
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  // width (BE) at 16..20, height at 20..24 — both 1.
  bytes.set([0, 0, 0, 1], 16);
  bytes.set([0, 0, 0, 1], 20);
  return bytes;
}

function runReferenceWalkTests(): void {
  const pages: CanvasPage[] = [
    {
      id: 'page-assets',
      slug: 'assets',
      title: 'Assets',
      width: 1440,
      ogImageAssetId: 'og-image-id',
      sections: [
        {
          id: 'section-media',
          recipeId: 'hero-split',
          name: 'Media',
          height: 400,
          elements: [
            {
              id: 'hero-media',
              type: 'media',
              mediaKind: 'video',
              assetId: 'video-id',
              posterAssetId: 'poster-id',
              alt: 'Launch reel',
              fit: 'cover',
              box: { x: 0, y: 0, w: 640, h: 360, z: 1 },
            },
          ],
        },
      ],
    },
  ];
  const refs = collectReferencedAssets(pages);
  assert(
    refs.some((ref) => ref.assetId === 'og-image-id' && ref.expectedKind === 'image'),
    'expected collectReferencedAssets to include page ogImageAssetId as an image reference',
  );
  const ids = collectReferencedAssetIds(pages);
  assert(ids.has('og-image-id'), 'expected collectReferencedAssetIds to include ogImageAssetId');
  assert(ids.has('video-id'), 'expected collectReferencedAssetIds to keep media assetId');
  assert(ids.has('poster-id'), 'expected collectReferencedAssetIds to keep posterAssetId');

  const siteRoot: AssetReferenceRoot & { faviconAssetId: string } = {
    pages,
    faviconAssetId: 'favicon-id',
    header: {
      id: 'site-header',
      recipeId: 'custom',
      name: 'Header',
      height: 80,
      elements: [
        {
          id: 'header-logo',
          type: 'nav',
          box: { x: 0, y: 0, w: 400, h: 80, z: 1 },
          logoAssetId: 'logo-id',
          links: [],
          layout: 'left-center-right',
          sticky: false,
        },
      ],
    },
    footer: {
      id: 'site-footer',
      recipeId: 'custom',
      name: 'Footer',
      height: 120,
      backgroundVideoAssetId: 'footer-bg-video-id',
      elements: [
        {
          id: 'footer-carousel',
          type: 'carousel',
          box: { x: 0, y: 0, w: 400, h: 120, z: 1 },
          slides: [{ id: 'slide-1', assetId: 'slide-image-id' }],
          showArrows: true,
          showDots: true,
        },
      ],
    },
  };
  const siteIds = collectReferencedAssetIds(siteRoot);
  assert(siteIds.has('favicon-id'), 'expected site favicon asset to be reachable');
  assert(siteIds.has('logo-id'), 'expected header nav logo asset to be reachable');
  assert(
    siteIds.has('footer-bg-video-id'),
    'expected footer background video asset to be reachable',
  );
  assert(siteIds.has('slide-image-id'), 'expected footer carousel slide asset to be reachable');

  const designerInteractionState: EditableSite = {
    styleKit: 'charcoal',
    pages,
    overlaySections: [
      {
        id: 'overlay-gallery',
        recipeId: 'custom',
        name: 'Overlay Gallery',
        height: 360,
        elements: [
          {
            id: 'overlay-image',
            type: 'media',
            mediaKind: 'image',
            assetId: 'overlay-image-id',
            alt: '',
            fit: 'cover',
            box: { x: 0, y: 0, w: 320, h: 220, z: 1 },
          },
        ],
      },
    ],
    richMotionAssets: [
      {
        id: 'hero-lottie',
        ownerAssetId: 'lottie-json-id',
        family: 'vector-animation',
        source: { kind: 'lottie-json' },
        playback: {
          trigger: { type: 'load' },
          loop: false,
          speed: 1,
          reducedMotion: 'poster',
        },
        posterAssetId: 'lottie-poster-id',
      },
      {
        id: 'scrub-sequence',
        ownerAssetId: 'sequence-manifest-id',
        family: 'image-sequence',
        source: { kind: 'image-sequence', frameAssetIds: ['frame-1-id', 'frame-2-id'] },
        playback: {
          trigger: { type: 'scroll-progress', sectionId: 'section-media' },
          loop: false,
          speed: 1,
          reducedMotion: 'poster',
        },
      },
    ],
  };
  const designerIds = collectReferencedAssetIds(designerInteractionState);
  assert(designerIds.has('overlay-image-id'), 'expected overlay section media to be reachable');
  assert(designerIds.has('lottie-json-id'), 'expected rich-motion owner asset to be reachable');
  assert(designerIds.has('lottie-poster-id'), 'expected rich-motion poster asset to be reachable');
  assert(
    designerIds.has('frame-1-id'),
    'expected rich-motion image-sequence frame to be reachable',
  );
  const designerRefs = collectReferencedAssets(designerInteractionState);
  assert(
    designerRefs.some(
      (ref) =>
        ref.assetId === 'lottie-json-id' &&
        ref.role === 'rich-motion-owner' &&
        ref.expectedKind === 'lottie-json',
    ),
    'expected lottie rich-motion owner asset reference to require lottie-json owner asset kind',
  );

  const nestedPages: CanvasPage[] = [
    {
      id: 'page-nested-assets',
      slug: 'nested-assets',
      title: 'Nested assets',
      width: 1440,
      sections: [
        {
          id: 'section-nested',
          recipeId: 'custom',
          name: 'Nested',
          height: 600,
          elements: [
            {
              id: 'tabs-with-media',
              type: 'tabs',
              box: { x: 0, y: 0, w: 600, h: 400, z: 1 },
              activeTabId: 'media',
              tabs: [
                {
                  id: 'media',
                  label: [{ text: 'Media' }],
                  elements: [
                    {
                      id: 'nested-tab-media',
                      type: 'media',
                      mediaKind: 'image',
                      assetId: 'nested-tab-image-id',
                      alt: '',
                      fit: 'cover',
                      box: { x: 0, y: 0, w: 200, h: 120, z: 1 },
                    },
                  ],
                },
                { id: 'empty', label: [{ text: 'Empty' }], elements: [] },
              ],
            },
            {
              id: 'collection-with-assets',
              type: 'collection',
              box: { x: 0, y: 420, w: 600, h: 160, z: 2 },
              collectionSlug: 'blog',
              display: 'card',
              sort: 'date-desc',
              // ADR 0063 dec 6 — the materializer writes per-entry instances
              // into `entries`; this fixture pre-baked them so the walker has
              // something to traverse without invoking the materializer.
              entries: [
                [
                  {
                    id: 'collection-entry-slide',
                    type: 'carousel',
                    box: { x: 0, y: 0, w: 320, h: 120, z: 1 },
                    slides: [{ id: 'nested-slide', assetId: 'nested-entry-slide-id' }],
                    showArrows: true,
                    showDots: true,
                  },
                  {
                    id: 'collection-entry-card-media',
                    type: 'media',
                    mediaKind: 'image',
                    assetId: 'nested-card-image-id',
                    alt: '',
                    fit: 'cover',
                    box: { x: 0, y: 0, w: 200, h: 120, z: 1 },
                  },
                ],
              ],
            },
          ],
        },
      ],
    },
  ];
  const nestedIds = collectReferencedAssetIds(nestedPages);
  assert(nestedIds.has('nested-tab-image-id'), 'expected tab-panel image asset to be reachable');
  assert(
    nestedIds.has('nested-entry-slide-id'),
    'expected collection entry carousel slide asset to be reachable',
  );
  assert(
    nestedIds.has('nested-card-image-id'),
    'expected collection entry image asset to be reachable',
  );

  const nestedUnfilledPages = structuredClone(nestedPages);
  const unfilledElements = nestedUnfilledPages[0]!.sections[0]!.elements;
  const unfilledTabs = unfilledElements[0]!;
  if (unfilledTabs.type !== 'tabs') throw new Error('[assets:smoke] expected tabs first');
  const unfilledTabMedia = unfilledTabs.tabs[0]!.elements[0]!;
  if (unfilledTabMedia.type !== 'media') {
    throw new Error('[assets:smoke] expected tab media');
  }
  unfilledTabMedia.assetId = '__placeholder__';
  const unfilledCollection = unfilledElements[1]!;
  if (unfilledCollection.type !== 'collection') {
    throw new Error('[assets:smoke] expected collection second');
  }
  const unfilledEntry = unfilledCollection.entries?.[0]?.[1];
  if (unfilledEntry?.type !== 'media') {
    throw new Error('[assets:smoke] expected collection entry media');
  }
  unfilledEntry.assetId = '';
  const nestedUnfilled = collectUnfilledAssetReferences(nestedUnfilledPages);
  assert(
    nestedUnfilled.some(
      (ref) =>
        ref.mediaElementId === 'nested-tab-media' &&
        ref.path.includes('.tabs[0].elements[0].assetId'),
    ),
    'expected tab-panel unfilled media asset to be reported with nested path',
  );
  assert(
    nestedUnfilled.some(
      (ref) =>
        ref.mediaElementId === 'collection-entry-card-media' &&
        ref.path.includes('.entries[0][1].assetId'),
    ),
    'expected collection entry unfilled media asset to be reported with nested path',
  );

  // -------------------------------------------------------------------------
  // ADR 0065 D2 + codex review pass 1 — asset walkers must recurse into
  // `customTemplate` so fixed asset references inside an Owner-authored
  // custom card template participate in the publish guard's reference set
  // AND the unfilled-asset hint set.
  // -------------------------------------------------------------------------
  const templateAssetPages: CanvasPage[] = [
    {
      id: 'page-custom-template-assets',
      slug: 'custom-template-assets',
      title: 'Custom template assets',
      width: 1200,
      sections: [
        {
          id: 'section-custom-template',
          recipeId: 'custom',
          name: 'Custom template',
          height: 600,
          elements: [
            {
              id: 'collection-with-custom-template',
              type: 'collection',
              box: { x: 0, y: 0, w: 1200, h: 600, z: 1 },
              collectionSlug: 'blog',
              display: 'custom',
              sort: 'date-desc',
              customTemplate: [
                {
                  id: 'custom-tpl-root',
                  type: 'container',
                  box: { x: 0, y: 0, w: 320, h: 360, z: 1 },
                  variant: 'raised',
                  preset: 'card',
                },
                {
                  id: 'custom-tpl-brand-overlay',
                  type: 'media',
                  mediaKind: 'image',
                  // FIXED assetId — Owner pinned a brand logo to ALL cards.
                  // The publish-time materializer will clone this verbatim
                  // into entries[][], but in editor state the canonical
                  // location is here in customTemplate.
                  assetId: 'custom-tpl-brand-logo-asset-id',
                  alt: 'Brand',
                  fit: 'cover',
                  box: { x: 0, y: 0, w: 80, h: 32, z: 2 },
                },
                {
                  id: 'custom-tpl-unfilled-media',
                  type: 'media',
                  mediaKind: 'image',
                  // Unfilled slot — Owner dropped an Image but hasn't picked
                  // bytes yet. Should surface in collectUnfilledAssetReferences.
                  assetId: '',
                  alt: '',
                  fit: 'cover',
                  box: { x: 0, y: 40, w: 320, h: 180, z: 3 },
                },
              ],
            },
          ],
        },
      ],
    },
  ];
  const templateRefIds = collectReferencedAssetIds(templateAssetPages);
  assert(
    templateRefIds.has('custom-tpl-brand-logo-asset-id'),
    'expected fixed assetId inside customTemplate to be reachable from collectReferencedAssetIds',
  );
  const templateRefs = collectReferencedAssets(templateAssetPages);
  assert(
    templateRefs.some(
      (ref) =>
        ref.assetId === 'custom-tpl-brand-logo-asset-id' &&
        ref.path.includes('.customTemplate[1].assetId') &&
        ref.mediaElementId === 'custom-tpl-brand-overlay',
    ),
    'expected customTemplate asset reference path to carry .customTemplate[idx].assetId',
  );
  const templateUnfilled = collectUnfilledAssetReferences(templateAssetPages);
  assert(
    templateUnfilled.some(
      (ref) =>
        ref.mediaElementId === 'custom-tpl-unfilled-media' &&
        ref.path.includes('.customTemplate[2].assetId'),
    ),
    'expected unfilled Image inside customTemplate to surface via collectUnfilledAssetReferences',
  );

  // -------------------------------------------------------------------------
  // ADR 0065 D3 + codex review pass 2 finding 1 — a Collection whose
  // `customTemplate` is the literal `seedCustomTemplate()` payload carries
  // substitution tokens (e.g. `{{ogImageAssetId}}`) in its Image elements'
  // `assetId` slots. Those are pre-substitution placeholders the publish
  // materializer resolves per entry — NOT real asset references. The
  // walker must skip them or the publish guard rejects the state with
  // `missing asset {{ogImageAssetId}}`.
  // -------------------------------------------------------------------------
  const seededTemplate = seedCustomTemplate('test-coll-seed', 1200, 600);
  const seededTemplatePages: CanvasPage[] = [
    {
      id: 'page-seeded-template',
      slug: 'seeded-template',
      title: 'Seeded template',
      width: 1200,
      sections: [
        {
          id: 'section-seeded-template',
          recipeId: 'custom',
          name: 'Seeded template',
          height: 600,
          elements: [
            {
              id: 'test-coll-seed',
              type: 'collection',
              box: { x: 0, y: 0, w: 1200, h: 600, z: 1 },
              collectionSlug: 'blog',
              display: 'custom',
              sort: 'date-desc',
              customTemplate: seededTemplate,
            },
          ],
        },
      ],
    },
  ];
  const seededIds = collectReferencedAssetIds(seededTemplatePages);
  for (const id of seededIds) {
    assert(
      !/^\{\{[a-z0-9_]+\}\}$/i.test(id),
      `expected zero substitution-token entries in collectReferencedAssetIds, found ${id}`,
    );
  }
  const seededRefs = collectReferencedAssets(seededTemplatePages);
  for (const ref of seededRefs) {
    assert(
      !/^\{\{[a-z0-9_]+\}\}$/i.test(ref.assetId),
      `expected zero substitution-token entries in collectReferencedAssets, found ${ref.assetId}`,
    );
  }

  // -------------------------------------------------------------------------
  // Codex review pass 3 finding 4 — isAssetSubstitutionToken predicate is
  // case-SENSITIVE and limited to the materializer's asset-resolving
  // placeholder set (today: `{{ogImageAssetId}}` only).
  //
  // The previous pass 2 implementation used a loose case-insensitive regex
  // `/^\{\{[a-z0-9_]+\}\}$/i`. That regex matched typo'd tokens like
  // `{{ogImageAssetID}}` (uppercase ID) AND text placeholders like
  // `{{title}}` — both wrong. The typo'd case is the worst: the
  // materializer does NOT substitute `{{ogImageAssetID}}` (the substitution
  // pass uses an exact-case PLACEHOLDER_FIELDS lookup), so a permissive
  // suppression silently shipped a broken asset id into publish output.
  //
  // The tight predicate now FAILS LOUDLY on typos:
  //   * `{{ogImageAssetId}}` — true placeholder, skipped at the boundary.
  //   * `{{ogImageAssetID}}` — typo, NOT skipped, reaches the asset rows
  //     check as a fake id, publish guard rejects with a clear missing-
  //     asset error pinpointing the typo.
  //   * `{{title}}` — text placeholder, NOT skipped (it's never an asset
  //     id slot; the materializer substitutes it into TextElement.content).
  // -------------------------------------------------------------------------
  assert(
    isAssetSubstitutionToken('{{ogImageAssetId}}'),
    'isAssetSubstitutionToken must accept the exact asset placeholder {{ogImageAssetId}}',
  );
  assert(
    !isAssetSubstitutionToken('{{ogImageAssetID}}'),
    'isAssetSubstitutionToken must REJECT case-typo {{ogImageAssetID}} so a malformed id surfaces loudly',
  );
  assert(
    !isAssetSubstitutionToken('{{OGIMAGEASSETID}}'),
    'isAssetSubstitutionToken must REJECT uppercase {{OGIMAGEASSETID}}',
  );
  assert(
    !isAssetSubstitutionToken('{{title}}'),
    'isAssetSubstitutionToken must REJECT text placeholder {{title}} — never an asset id slot',
  );
  assert(
    !isAssetSubstitutionToken('{{slug}}'),
    'isAssetSubstitutionToken must REJECT text placeholder {{slug}}',
  );
  assert(
    !isAssetSubstitutionToken('{{author}}'),
    'isAssetSubstitutionToken must REJECT text placeholder {{author}}',
  );
  assert(
    !isAssetSubstitutionToken('seed-customer-x-blog-hero'),
    'isAssetSubstitutionToken must REJECT a real asset id',
  );
  assert(!isAssetSubstitutionToken(''), 'isAssetSubstitutionToken must REJECT the empty string');
  assert(
    !isAssetSubstitutionToken('{{ogImageAssetId'),
    'isAssetSubstitutionToken must REJECT truncated placeholder (open brace, no close)',
  );
  assert(
    !isAssetSubstitutionToken('prefix-{{ogImageAssetId}}-suffix'),
    'isAssetSubstitutionToken must REJECT a placeholder embedded in a larger string',
  );

  // -------------------------------------------------------------------------
  // Codex review pass 3 finding 1 — `prepareSeedAssetsForCustomer`'s rewrite
  // walk must preserve substitution tokens verbatim inside customTemplate.
  //
  // Pass 1 F4 added customTemplate recursion to the rewrite walk; pass 2 F1
  // filtered tokens out of `collectReferencedAssets` so `mappedIds` doesn't
  // contain `{{ogImageAssetId}}`. Without pass 3 F1's matching skip, the
  // rewrite walk reaches `materializeAssetId({{ogImageAssetId}})`, finds no
  // mapping, returns `{ missing: '{{ogImageAssetId}}' }`, and site creation
  // breaks with "template seed references invalid asset ids".
  //
  // Fixture: a single-page EditableSite with a Collection whose
  // customTemplate carries one media child with `assetId: '{{ogImageAssetId}}'`
  // (placeholder) and one media child with `assetId: 'seed-hero-poster-1'`
  // (a real registered seed). The placeholder must pass through unchanged;
  // the real seed id must be rewritten to the materialized customer-rooted id.
  // -------------------------------------------------------------------------
  {
    const placeholderMedia: CanvasElement = {
      id: 'tpl-media-placeholder',
      type: 'media',
      mediaKind: 'image',
      box: { x: 0, y: 0, w: 320, h: 200, z: 1 },
      assetId: '{{ogImageAssetId}}',
      alt: '{{title}}',
      fit: 'cover',
    };
    const fixedMedia: CanvasElement = {
      id: 'tpl-media-fixed',
      type: 'media',
      mediaKind: 'image',
      box: { x: 0, y: 200, w: 320, h: 60, z: 2 },
      assetId: 'seed-hero-poster-1',
      alt: 'Fixed brand mark',
      fit: 'cover',
    };
    const collection: CanvasElement = {
      id: 'tpl-collection',
      type: 'collection',
      box: { x: 0, y: 0, w: 1200, h: 300, z: 1 },
      collectionSlug: 'blog',
      display: 'custom',
      sort: 'date-desc',
      customTemplate: [placeholderMedia, fixedMedia],
    };
    const editableState: EditableSite = {
      styleKit: 'charcoal',
      pages: [
        {
          id: 'page-tpl-rewrite',
          slug: 'tpl-rewrite',
          title: 'Template rewrite',
          width: 1200,
          sections: [
            {
              id: 'section-tpl-rewrite',
              recipeId: 'custom',
              name: 'Template rewrite',
              height: 600,
              elements: [collection],
            },
          ],
        },
      ],
    };
    const prepared = prepareSeedAssetsForCustomer('cust-tpl-rewrite', editableState, new Map());
    assert(
      prepared.ok,
      `(pass3 F1) prepareSeedAssetsForCustomer must succeed when customTemplate carries ` +
        `{{ogImageAssetId}}; got ${prepared.ok ? 'ok' : JSON.stringify(prepared)}`,
    );
    if (prepared.ok) {
      const rewrittenCollection = prepared.editableState.pages[0]!.sections[0]!.elements[0];
      assert(
        rewrittenCollection !== undefined && rewrittenCollection.type === 'collection',
        '(pass3 F1) collection element must survive the rewrite walk',
      );
      if (rewrittenCollection?.type === 'collection') {
        const tpl = rewrittenCollection.customTemplate ?? [];
        const rewrittenPlaceholder = tpl[0];
        const rewrittenFixed = tpl[1];
        assert(
          rewrittenPlaceholder !== undefined &&
            rewrittenPlaceholder.type === 'media' &&
            rewrittenPlaceholder.assetId === '{{ogImageAssetId}}',
          `(pass3 F1) customTemplate[0].assetId must remain {{ogImageAssetId}} verbatim, got ` +
            `${rewrittenPlaceholder?.type === 'media' ? rewrittenPlaceholder.assetId : 'non-media'}`,
        );
        assert(
          rewrittenFixed !== undefined &&
            rewrittenFixed.type === 'media' &&
            rewrittenFixed.assetId === 'seed-cust-tpl-rewrite-seed-hero-poster-1',
          `(pass3 F1) customTemplate[1].assetId must be rewritten to the customer-rooted id, got ` +
            `${rewrittenFixed?.type === 'media' ? rewrittenFixed.assetId : 'non-media'}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Test 1 + 2 + 3 — upload happy-path + dedup behaviour
// ---------------------------------------------------------------------------
//
// We exercise the upload algorithm against an in-memory store rather than a
// real drizzle binding. The algorithm under test is documented exactly in
// `src/assets/upload.ts`; the simulation below mirrors the same steps so a
// future drift in the production handler shows up as a contract change
// rather than a different algorithm.

interface SimulatedAssetRow {
  id: string;
  customerId: string;
  contentHash: string;
  r2Key: string;
  mediaType: string;
  kind: OwnerAssetKind;
  alt: string;
  width: number | null;
  height: number | null;
  byteSize: number;
}

interface SimulatedUploadResult extends SimulatedAssetRow {
  inserted: boolean;
  r2Uploaded: boolean;
}

async function simulateUpload(
  store: SimulatedAssetRow[],
  r2: MockR2,
  customerId: string,
  bytes: Uint8Array,
  alt: string,
): Promise<SimulatedUploadResult> {
  const { contentHashToR2Key, extFromMediaType } = await import('./hash.js');
  const { probeImageDimensions } = await import('./image-probe.js');
  const hash = await sha256Hex(bytes);
  const key = contentHashToR2Key(hash, extFromMediaType('image/png'));
  const existing = store.find((r) => r.customerId === customerId && r.contentHash === hash);
  if (existing) {
    return { ...existing, inserted: false, r2Uploaded: false };
  }
  const dims = probeImageDimensions(bytes);
  const head = await r2.head(key);
  let r2Uploaded = false;
  if (head === null) {
    const putResult = await r2.put(key, bytes, {
      httpMetadata: { contentType: 'image/png' },
      onlyIf: { etagDoesNotMatch: '*' },
    });
    r2Uploaded = putResult !== null;
  }
  const id = crypto.randomUUID();
  const row: SimulatedAssetRow = {
    id,
    customerId,
    contentHash: hash,
    r2Key: key,
    mediaType: 'image/png',
    kind: 'image',
    alt,
    width: dims.width,
    height: dims.height,
    byteSize: bytes.byteLength,
  };
  store.push(row);
  return { ...row, inserted: true, r2Uploaded };
}

async function runUploadTests(png32: Uint8Array, expectedHash: string): Promise<void> {
  const store: SimulatedAssetRow[] = [];
  const r2 = new MockR2();

  const upA1 = await simulateUpload(store, r2, 'cust-A', png32, 'first');
  assert(upA1.inserted === true, 'expected first upload to insert a row');
  assert(upA1.r2Uploaded === true, 'expected first upload to write R2');
  assert(
    upA1.contentHash === expectedHash,
    `expected contentHash ${expectedHash}, got ${upA1.contentHash}`,
  );
  assert(upA1.byteSize === 32, `expected byteSize 32, got ${String(upA1.byteSize)}`);
  assert(upA1.width === 1, `expected width 1 from PNG IHDR, got ${String(upA1.width)}`);
  assert(upA1.height === 1, `expected height 1 from PNG IHDR, got ${String(upA1.height)}`);
  assert(
    upA1.r2Key === `assets/${expectedHash.slice(0, 32)}.png`,
    `expected r2Key with sha256[:32] prefix, got ${upA1.r2Key}`,
  );

  // Same Owner re-upload: dedup → same row, no new R2 put.
  const upA2 = await simulateUpload(store, r2, 'cust-A', png32, 'second');
  assert(upA2.inserted === false, 'expected dedup (same Owner) to return inserted=false');
  assert(upA2.id === upA1.id, `expected dedup to return same id, got ${upA2.id}`);
  assert(
    r2.putCount === 1,
    `expected only one R2 put after Owner-A re-upload, got ${String(r2.putCount)}`,
  );

  // Different Owner uploading same bytes: NEW row, NO new R2 put.
  const upB = await simulateUpload(store, r2, 'cust-B', png32, 'cross-owner');
  assert(upB.inserted === true, 'expected cross-owner upload to insert a row');
  assert(upB.id !== upA1.id, 'expected cross-owner upload to get a fresh id');
  assert(upB.contentHash === expectedHash, 'expected cross-owner upload to share contentHash');
  assert(
    upB.r2Uploaded === false,
    'expected cross-owner upload NOT to write R2 (object already exists)',
  );
  assert(
    r2.putCount === 1,
    `expected still one R2 put after cross-owner upload, got ${String(r2.putCount)}`,
  );
}

// ---------------------------------------------------------------------------
// Test 4 + 5 — read path: original bytes, then cf.image subrequest
// ---------------------------------------------------------------------------

async function runReadTests(png32: Uint8Array, expectedHash: string): Promise<void> {
  // The read path needs an R2 with the bytes already in place + a one-row
  // DB shim that yields the matching ownerAsset row.
  const r2 = new MockR2();
  await r2.put('assets/test.png', png32, {
    httpMetadata: { contentType: 'image/png' },
  });
  const r2Client = createR2Client(r2);

  const fakeRow = {
    id: 'asset-uuid-1',
    r2Key: 'assets/test.png',
    mediaType: 'image/png',
    kind: 'image' as const,
    contentHash: expectedHash,
  };
  const shimDb = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([fakeRow]) }),
      }),
    }),
  } as unknown as Db;

  // 4 — no transform params → R2-original path. Content-type comes from R2.
  const originalResponse = await readOwnerAsset(
    { db: shimDb, r2: r2Client, cfImageFetch: null, publicOrigin: 'https://opencanvas.test' },
    {
      addr: expectedHash,
      url: new URL(`https://opencanvas.test/assets/${expectedHash}`),
    },
  );
  assert(originalResponse !== null, 'expected original-bytes Response');
  assert(
    originalResponse.headers.get('content-type') === 'image/png',
    `expected content-type image/png, got ${originalResponse.headers.get('content-type') ?? ''}`,
  );
  const originalCacheControl = originalResponse.headers.get('cache-control') ?? '';
  assert(
    originalCacheControl.includes('max-age=31536000') && originalCacheControl.includes('immutable'),
    `expected immutable cache-control, got ${originalCacheControl}`,
  );

  // 5 — `?w=200` triggers cf.image subrequest with width=200, fit=cover,
  //     format=auto. The cfImageFetch stub records the call shape.
  const seenCalls: { url: string; opts: CfImageOptions }[] = [];
  const cfImageFetch: CfImageFetcher = (url, options) => {
    seenCalls.push({ url, opts: options.cf.image });
    return Promise.resolve(
      new Response(png32, {
        headers: { 'content-type': 'image/webp' },
      }),
    );
  };

  const transformedResponse = await readOwnerAsset(
    { db: shimDb, r2: r2Client, cfImageFetch, publicOrigin: 'https://opencanvas.test' },
    {
      addr: expectedHash,
      url: new URL(`https://opencanvas.test/assets/${expectedHash}?w=200&fit=cover`),
    },
  );
  assert(transformedResponse !== null, 'expected readOwnerAsset to resolve a Response');
  assert(seenCalls.length === 1, `expected one cf.image call, got ${String(seenCalls.length)}`);
  const recordedCall = seenCalls[0]!;
  assert(
    recordedCall.url === `https://opencanvas.test/assets/${expectedHash}`,
    `expected cf.image subrequest URL to be the content-hash address, got ${recordedCall.url}`,
  );
  assert(
    recordedCall.opts.width === 200,
    `expected cf.image opts.width=200, got ${String(recordedCall.opts.width)}`,
  );
  assert(
    recordedCall.opts.fit === 'cover',
    `expected cf.image opts.fit=cover, got ${String(recordedCall.opts.fit)}`,
  );
  assert(
    recordedCall.opts.format === 'auto',
    `expected cf.image opts.format=auto, got ${String(recordedCall.opts.format)}`,
  );
  const transformedCacheControl = transformedResponse.headers.get('cache-control') ?? '';
  assert(
    transformedCacheControl.includes('max-age=31536000') &&
      transformedCacheControl.includes('immutable'),
    `expected immutable cache-control on transformed response, got ${transformedCacheControl}`,
  );

  let invalidWidthThrew = false;
  try {
    await readOwnerAsset(
      { db: shimDb, r2: r2Client, cfImageFetch, publicOrigin: 'https://opencanvas.test' },
      {
        addr: expectedHash,
        url: new URL(`https://opencanvas.test/assets/${expectedHash}?w=12abc`),
      },
    );
  } catch (err) {
    invalidWidthThrew = err instanceof Error && err.message.includes('invalid w=12abc');
  }
  assert(invalidWidthThrew, 'transform width must reject partial numeric garbage');

  // Missing addr resolves to null (route layer maps to 404).
  const missDb = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }),
  } as unknown as Db;
  const missResponse = await readOwnerAsset(
    { db: missDb, r2: r2Client, cfImageFetch: null, publicOrigin: 'https://opencanvas.test' },
    {
      addr: expectedHash,
      url: new URL(`https://opencanvas.test/assets/${expectedHash}`),
    },
  );
  assert(missResponse === null, 'expected missing-addr lookup to return null');
}

function makeLottieJsonBytes(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      v: '5.12.2',
      fr: 60,
      ip: 0,
      op: 120,
      w: 480,
      h: 320,
      layers: [{ ind: 1, ty: 4, ks: {}, shapes: [] }],
    }),
  );
}

async function runLottieAssetTests(): Promise<void> {
  const lottieBytes = makeLottieJsonBytes();
  const hash = await sha256Hex(lottieBytes);
  const lottieDb = new UploadScopeDb(true);
  const lottieR2 = new MockR2();
  const uploaded = await uploadOwnerAsset(
    { db: lottieDb as unknown as Db, r2: createR2Client(lottieR2) },
    {
      customerId: 'cust-lottie',
      bytes: lottieBytes,
      mediaType: 'application/json; charset=utf-8',
      alt: 'hero motion',
    },
  );

  assert(uploaded.kind === 'lottie-json', `expected kind lottie-json, got ${uploaded.kind}`);
  assert(
    uploaded.mediaType === 'application/json',
    `expected normalised mediaType application/json, got ${uploaded.mediaType}`,
  );
  assert(
    uploaded.r2Key === `assets/${hash.slice(0, 32)}.json`,
    `expected Lottie R2 key to use .json extension, got ${uploaded.r2Key}`,
  );
  assert(
    uploaded.width === null && uploaded.height === null,
    'Lottie upload must not probe image dimensions',
  );
  assert(
    lottieDb.ownerAssets[0]?.kind === 'lottie-json',
    'inserted ownerAsset row must persist lottie-json kind',
  );
  assert(lottieR2.putCount === 1, 'Lottie upload must write one R2 object');

  let invalidRejected = false;
  const dbThatMustNotBeTouched = {
    select: () => {
      throw new Error('[assets:smoke] invalid Lottie guard reached the database');
    },
  } as unknown as Db;
  const invalidR2 = new MockR2();
  try {
    await uploadOwnerAsset(
      { db: dbThatMustNotBeTouched, r2: createR2Client(invalidR2) },
      {
        customerId: 'cust-lottie',
        bytes: new TextEncoder().encode('{"v":"5.12.2"}'),
        mediaType: 'application/json',
        alt: 'invalid',
      },
    );
  } catch (err) {
    invalidRejected =
      err instanceof UploadAssetError && err.message.includes('invalid lottie-json asset');
  }
  assert(invalidRejected, 'invalid Lottie JSON must fail before DB/R2 writes');
  assert(invalidR2.putCount === 0, 'invalid Lottie upload must not write to R2');

  const readR2 = new MockR2();
  await readR2.put('assets/lottie.json', lottieBytes, {
    httpMetadata: { contentType: 'application/json' },
  });
  const lottieRow = {
    id: 'lottie-asset',
    r2Key: 'assets/lottie.json',
    mediaType: 'application/json',
    kind: 'lottie-json' as const,
    contentHash: hash,
  };
  const readDb = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([lottieRow]) }),
      }),
    }),
  } as unknown as Db;
  let transformCalls = 0;
  const forbiddenCfImageFetch: CfImageFetcher = () => {
    transformCalls += 1;
    return Promise.resolve(new Response('should not run'));
  };
  const response = await readOwnerAsset(
    {
      db: readDb,
      r2: createR2Client(readR2),
      cfImageFetch: forbiddenCfImageFetch,
      publicOrigin: 'https://opencanvas.test',
    },
    {
      addr: 'lottie-asset',
      url: new URL('https://opencanvas.test/assets/lottie-asset?w=320'),
    },
  );
  assert(response !== null, 'expected Lottie read to resolve a Response');
  assert(
    transformCalls === 0,
    'Lottie read must bypass cf.image transforms even with transform params',
  );
  assert(
    response.headers.get('content-type') === 'application/json',
    `expected Lottie content-type application/json, got ${response.headers.get('content-type') ?? ''}`,
  );
}

// ---------------------------------------------------------------------------
// Slot-history scope: upload-side book-keeping must never write a site slot
// for a site outside the uploading Owner's account.
// ---------------------------------------------------------------------------

class UploadScopeDb {
  ownerAssets: Array<Record<string, unknown>> = [];
  slotRows: Array<Record<string, unknown>> = [];

  constructor(private readonly ownsSite: boolean) {}

  select(): { from: (table: unknown) => { where: () => { limit: () => Promise<unknown[]> } } } {
    return {
      from: (table: unknown) => ({
        where: () => ({
          limit: () => {
            if (table === ownerAsset) return Promise.resolve([]);
            if (table === site) {
              return Promise.resolve(this.ownsSite ? [{ id: 'site-owned' }] : []);
            }
            throw new Error('[assets:smoke] unexpected select table');
          },
        }),
      }),
    };
  }

  insert(table: unknown): {
    values: (
      row: Record<string, unknown>,
    ) => Promise<void> | { onConflictDoUpdate: () => Promise<void> };
  } {
    if (table === ownerAsset) {
      return {
        values: (row) => {
          this.ownerAssets.push(row);
          return Promise.resolve();
        },
      };
    }
    if (table === slotHistory) {
      return {
        values: (row) => ({
          onConflictDoUpdate: () => {
            this.slotRows.push(row);
            return Promise.resolve();
          },
        }),
      };
    }
    throw new Error('[assets:smoke] unexpected insert table');
  }
}

async function runSlotHistoryScopeTests(png32: Uint8Array): Promise<void> {
  const unownedDb = new UploadScopeDb(false);
  let unownedThrew = false;
  try {
    await uploadOwnerAsset(
      { db: unownedDb as unknown as Db, r2: createR2Client(new MockR2()) },
      {
        customerId: 'cust-A',
        bytes: png32,
        mediaType: 'image/png',
        alt: 'scoped',
        siteId: 'site-not-owned',
        elementId: 'hero-media',
      },
    );
  } catch (err) {
    unownedThrew =
      err instanceof UploadAssetError &&
      err.status === 403 &&
      err.message.includes('site not owned');
  }
  assert(unownedThrew, 'uploadOwnerAsset must reject slot history for unowned site');
  assert(unownedDb.slotRows.length === 0, 'unowned slot history must not be inserted');

  const partialDb = new UploadScopeDb(true);
  let partialThrew = false;
  try {
    await uploadOwnerAsset(
      { db: partialDb as unknown as Db, r2: createR2Client(new MockR2()) },
      {
        customerId: 'cust-A',
        bytes: png32,
        mediaType: 'image/png',
        alt: 'partial',
        siteId: 'site-owned',
      },
    );
  } catch (err) {
    partialThrew =
      err instanceof UploadAssetError &&
      err.message.includes('siteId and elementId must be provided together');
  }
  assert(partialThrew, 'slot history metadata must be all-or-nothing');
  assert(partialDb.slotRows.length === 0, 'partial slot history must not be inserted');
}

async function runUploadMediaTypeGuardTests(): Promise<void> {
  const svgBytes = new TextEncoder().encode('<svg><script>alert(1)</script></svg>');
  const dbThatMustNotBeTouched = {
    select: () => {
      throw new Error('[assets:smoke] SVG media-type guard reached the database');
    },
  } as unknown as Db;
  const r2 = new MockR2();

  let parameterisedSvgRejected = false;
  try {
    await uploadOwnerAsset(
      { db: dbThatMustNotBeTouched, r2: createR2Client(r2) },
      {
        customerId: 'cust-svg',
        bytes: svgBytes,
        mediaType: 'image/svg+xml; charset=utf-8',
        alt: 'svg xss probe',
      },
    );
  } catch (err) {
    parameterisedSvgRejected =
      err instanceof UploadAssetError && err.message.includes('SVG uploads are not permitted');
  }

  assert(
    parameterisedSvgRejected,
    'SVG media types with parameters must be rejected before DB/R2 writes',
  );
  assert(r2.putCount === 0, 'rejected SVG upload must not write to R2');
}

// ---------------------------------------------------------------------------
// Test 6 + 7 — delete: confirm-required report, then cascade delete with /
// without siblings
// ---------------------------------------------------------------------------

async function runDeleteTests(png32: Uint8Array, expectedHash: string): Promise<void> {
  const ownerAssetRow = {
    id: 'asset-uuid-2',
    contentHash: expectedHash,
    r2Key: 'assets/test.png',
  };
  const referencingSite = {
    id: 'site-1',
    name: 'My Site',
    subdomain: 'my-site',
    publishedVersion: 1,
    editableState: {
      faviconAssetId: 'asset-uuid-2',
      pages: [
        {
          slug: 'home',
          ogImageAssetId: 'asset-uuid-2',
          sections: [
            {
              elements: [
                {
                  id: 'el-1',
                  type: 'media',
                  assetId: 'asset-uuid-2',
                  mediaKind: 'image',
                  richMotionAssetId: 'motion-delete',
                },
              ],
            },
          ],
        },
      ],
      richMotionAssets: [
        {
          id: 'motion-delete',
          ownerAssetId: 'asset-uuid-2',
          family: 'vector-animation',
          source: { kind: 'lottie-json' },
          playback: {
            trigger: { type: 'load' },
            loop: false,
            speed: 1,
            reducedMotion: 'hide',
          },
        },
      ],
    },
    publishedSnapshot: {
      faviconAssetId: 'asset-uuid-2',
      pages: [
        {
          slug: 'home',
          ogImageAssetId: 'asset-uuid-2',
          sections: [
            {
              elements: [
                {
                  id: 'el-1',
                  type: 'media',
                  assetId: 'asset-uuid-2',
                  mediaKind: 'image',
                  richMotionAssetId: 'motion-delete',
                },
              ],
            },
          ],
        },
      ],
      richMotionAssets: [
        {
          id: 'motion-delete',
          ownerAssetId: 'asset-uuid-2',
          family: 'vector-animation',
          source: { kind: 'lottie-json' },
          playback: {
            trigger: { type: 'load' },
            loop: false,
            speed: 1,
            reducedMotion: 'hide',
          },
        },
      ],
    },
  };

  function makeDeleteShim(
    returnSibling: boolean,
    updateLog: Array<Record<string, unknown>> = [],
  ): Db {
    // The delete handler makes three sequential queries:
    //   1. ownerAsset row lookup (.limit(1))
    //   2. site list for the customer (no .limit)
    //   3. sibling-count probe on ownerAsset (.limit(1))
    // We dispatch by ordinal because mocking drizzle's symbol-keyed table
    // tags would couple the smoke to drizzle internals.
    let selectCount = 0;
    return {
      select: () => ({
        from: () => ({
          where: () => {
            selectCount += 1;
            if (selectCount === 1) {
              const result = Promise.resolve([ownerAssetRow]);
              return Object.assign(result, { limit: () => result });
            }
            if (selectCount === 2) {
              const result = Promise.resolve([referencingSite]);
              return Object.assign(result, { limit: () => result });
            }
            const result = Promise.resolve(returnSibling ? [{ id: 'asset-uuid-sibling' }] : []);
            return Object.assign(result, { limit: () => result });
          },
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            updateLog.push(values);
            return Promise.resolve();
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
    } as unknown as Db;
  }

  const reportR2 = new MockR2();
  await reportR2.put('assets/test.png', png32, { httpMetadata: { contentType: 'image/png' } });
  const reportClient = createR2Client(reportR2);

  // 6 — no confirm → confirm_required + reference report.
  const reportResult = await deleteOwnerAsset(
    { db: makeDeleteShim(false), r2: reportClient },
    { assetId: 'asset-uuid-2', customerId: 'cust-1', confirm: false },
  );
  assert(
    reportResult.status === 'confirm_required',
    `expected confirm_required, got ${reportResult.status}`,
  );
  if (reportResult.status === 'confirm_required') {
    assert(
      reportResult.references.length === 8,
      `expected editable + published favicon, OG, media, and rich-motion references, got ${String(reportResult.references.length)}`,
    );
    const editableRef = reportResult.references.find(
      (ref) => ref.source === 'editable' && ref.role === 'asset',
    );
    const publishedRef = reportResult.references.find(
      (ref) => ref.source === 'published' && ref.role === 'asset',
    );
    const editableFaviconRef = reportResult.references.find(
      (ref) => ref.source === 'editable' && ref.role === 'favicon',
    );
    const editableOgRef = reportResult.references.find(
      (ref) => ref.source === 'editable' && ref.role === 'og-image',
    );
    const editableMotionRef = reportResult.references.find(
      (ref) => ref.source === 'editable' && ref.role === 'rich-motion-owner',
    );
    assert(editableRef !== undefined, 'expected reference report to include editable source');
    assert(publishedRef !== undefined, 'expected reference report to include published source');
    assert(editableFaviconRef !== undefined, 'expected reference report to include favicon source');
    assert(editableOgRef !== undefined, 'expected reference report to include page OG source');
    assert(
      editableMotionRef !== undefined,
      'expected reference report to include editable rich-motion owner source',
    );
    assert(editableRef.siteId === 'site-1', `expected siteId site-1, got ${editableRef.siteId}`);
    assert(
      editableRef.elementId === 'el-1',
      `expected elementId el-1, got ${editableRef.elementId}`,
    );
    assert(editableRef.role === 'asset', `expected role asset, got ${editableRef.role}`);
    assert(
      editableMotionRef.elementId === 'motion-delete',
      `expected rich-motion reference elementId motion-delete, got ${editableMotionRef.elementId}`,
    );
    assert(
      publishedRef.publishedAddress === 'my-site',
      `expected published address my-site, got ${String(publishedRef.publishedAddress)}`,
    );
  }

  // 7a — confirm + no siblings → R2 object deleted alongside the row.
  const updateLog: Array<Record<string, unknown>> = [];
  const confirmResult = await deleteOwnerAsset(
    { db: makeDeleteShim(false, updateLog), r2: reportClient },
    { assetId: 'asset-uuid-2', customerId: 'cust-1', confirm: true },
  );
  assert(confirmResult.status === 'deleted', `expected deleted, got ${confirmResult.status}`);
  if (confirmResult.status === 'deleted') {
    assert(
      confirmResult.r2ObjectDeleted === true,
      'expected R2 object deletion when no siblings remain',
    );
  }
  assert(
    updateLog.length === 1,
    `expected one editable-state cleanup update, got ${updateLog.length}`,
  );
  const updatedState = updateLog[0]?.editableState;
  assert(
    typeof updatedState === 'object' && updatedState !== null,
    'expected delete cascade to write a cleared editableState',
  );
  const firstElement = (
    updatedState as {
      faviconAssetId?: string;
      pages: Array<{ ogImageAssetId?: string; sections: Array<{ elements: unknown[] }> }>;
      richMotionAssets?: unknown[];
    }
  ).pages[0]?.sections[0]?.elements[0] as
    | { assetId?: string; richMotionAssetId?: string }
    | undefined;
  const updatedRoot = updatedState as {
    faviconAssetId?: string;
    pages: Array<{ ogImageAssetId?: string }>;
    richMotionAssets?: unknown[];
  };
  assert(
    updatedRoot.faviconAssetId === undefined,
    `expected delete cascade to clear faviconAssetId, got ${String(updatedRoot.faviconAssetId)}`,
  );
  assert(
    updatedRoot.pages[0]?.ogImageAssetId === undefined,
    `expected delete cascade to clear ogImageAssetId, got ${String(updatedRoot.pages[0]?.ogImageAssetId)}`,
  );
  assert(
    firstElement?.assetId === '',
    `expected delete cascade to clear editable assetId, got ${String(firstElement?.assetId)}`,
  );
  assert(
    firstElement?.richMotionAssetId === undefined,
    `expected delete cascade to remove richMotionAssetId pin, got ${String(firstElement?.richMotionAssetId)}`,
  );
  assert(
    Array.isArray(updatedRoot.richMotionAssets) && updatedRoot.richMotionAssets.length === 0,
    `expected delete cascade to remove rich-motion asset, got ${JSON.stringify(updatedRoot.richMotionAssets)}`,
  );

  // 7b — confirm + sibling → R2 object preserved (other rows reference it).
  const siblingR2 = new MockR2();
  await siblingR2.put('assets/test.png', png32, {
    httpMetadata: { contentType: 'image/png' },
  });
  const siblingClient = createR2Client(siblingR2);
  const siblingResult = await deleteOwnerAsset(
    { db: makeDeleteShim(true), r2: siblingClient },
    { assetId: 'asset-uuid-2', customerId: 'cust-1', confirm: true },
  );
  assert(siblingResult.status === 'deleted', `expected deleted, got ${siblingResult.status}`);
  if (siblingResult.status === 'deleted') {
    assert(
      siblingResult.r2ObjectDeleted === false,
      'expected R2 object to be preserved when a sibling row still references it',
    );
  }

  // -------------------------------------------------------------------------
  // 7c — Codex review pass 5 finding 2 — delete cascade walks
  // `customTemplate`. The publish-guard walks in site-assets.ts recurse
  // customTemplate; the delete-endpoint walks here previously stopped at
  // the top level, so a customTemplate-only assetId reported 0 references
  // and survived the cascade as a stale id (next publish failed the
  // publish guard).
  //
  // Fixture: a Collection whose customTemplate carries a media child
  // bound to the asset under deletion. Confirm-required must list this
  // site as a reference; the cascade must rewrite the customTemplate
  // child's assetId to '' so the next publish succeeds.
  // -------------------------------------------------------------------------
  const templateSiteRow = {
    id: 'site-tpl',
    name: 'Custom Template Site',
    subdomain: 'tpl-site',
    publishedVersion: 0,
    editableState: {
      pages: [
        {
          slug: 'home',
          sections: [
            {
              elements: [
                {
                  id: 'coll-tpl',
                  type: 'collection',
                  customTemplate: [
                    { id: 'tpl-cover', type: 'media', mediaKind: 'image', assetId: 'asset-uuid-2' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    publishedSnapshot: null,
  };
  function makeTemplateShim(
    returnSibling: boolean,
    updateLog: Array<Record<string, unknown>> = [],
  ): Db {
    let selectCount = 0;
    return {
      select: () => ({
        from: () => ({
          where: () => {
            selectCount += 1;
            if (selectCount === 1) {
              const result = Promise.resolve([
                { id: 'asset-uuid-2', contentHash: expectedHash, r2Key: 'assets/test.png' },
              ]);
              return Object.assign(result, { limit: () => result });
            }
            if (selectCount === 2) {
              const result = Promise.resolve([templateSiteRow]);
              return Object.assign(result, { limit: () => result });
            }
            const result = Promise.resolve(returnSibling ? [{ id: 'asset-uuid-sibling' }] : []);
            return Object.assign(result, { limit: () => result });
          },
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            updateLog.push(values);
            return Promise.resolve();
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
    } as unknown as Db;
  }

  const templateReportR2 = new MockR2();
  await templateReportR2.put('assets/test.png', png32, {
    httpMetadata: { contentType: 'image/png' },
  });
  const templateReportClient = createR2Client(templateReportR2);
  const templateReportResult = await deleteOwnerAsset(
    { db: makeTemplateShim(false), r2: templateReportClient },
    { assetId: 'asset-uuid-2', customerId: 'cust-1', confirm: false },
  );
  assert(
    templateReportResult.status === 'confirm_required',
    `(7c) expected confirm_required for customTemplate-only reference, got ${templateReportResult.status}`,
  );
  if (templateReportResult.status === 'confirm_required') {
    const tplRef = templateReportResult.references.find(
      (ref) => ref.siteId === 'site-tpl' && ref.elementId === 'tpl-cover' && ref.role === 'asset',
    );
    assert(
      tplRef !== undefined,
      `(7c) delete-cascade collectFromPages must surface customTemplate assetId as a reference; ` +
        `got ${JSON.stringify(templateReportResult.references)}`,
    );
  }

  const templateUpdateLog: Array<Record<string, unknown>> = [];
  const templateConfirmResult = await deleteOwnerAsset(
    { db: makeTemplateShim(false, templateUpdateLog), r2: templateReportClient },
    { assetId: 'asset-uuid-2', customerId: 'cust-1', confirm: true },
  );
  assert(
    templateConfirmResult.status === 'deleted',
    `(7c) expected deleted for customTemplate-only reference, got ${templateConfirmResult.status}`,
  );
  assert(
    templateUpdateLog.length === 1,
    `(7c) expected one editable-state cleanup write for customTemplate cascade, got ${String(templateUpdateLog.length)}`,
  );
  const tplCleared = templateUpdateLog[0]?.editableState as
    | { pages: Array<{ sections: Array<{ elements: unknown[] }> }> }
    | undefined;
  const tplCollection = tplCleared?.pages[0]?.sections[0]?.elements[0] as
    | { customTemplate?: Array<{ assetId?: string }> }
    | undefined;
  const tplChild = tplCollection?.customTemplate?.[0];
  assert(
    tplChild?.assetId === '',
    `(7c) clearAssetReferences must clear customTemplate child assetId to ''; ` +
      `got ${String(tplChild?.assetId)}`,
  );

  // -------------------------------------------------------------------------
  // 7d — Codex review pass 6 finding 3 — delete walker parity with
  // site-assets.ts. The reference + clear walks must handle EVERY asset-
  // bearing element type / field the publish-guard walker reports, or
  // the cascade goes half-blind:
  //
  //   * `elementStyle.backgroundImageAssetId` on a Container (any element)
  //   * `nav.logoAssetId` on a Header Nav
  //   * `carousel.slides[].assetId` (incl. inside a Collection's
  //     customTemplate, the worst-case nesting)
  //
  // Each must surface as a reference at confirm time AND be cleared by
  // the cascade. Without these the next publish trips the guard on a
  // field the cascade failed to drain.
  // -------------------------------------------------------------------------
  const parityAssetId = 'asset-parity-1';
  const paritySiteRow = {
    id: 'site-parity',
    name: 'Parity Site',
    subdomain: 'parity-site',
    publishedVersion: 0,
    editableState: {
      pages: [
        {
          slug: 'parity',
          sections: [
            {
              elements: [
                // Container with elementStyle.backgroundImageAssetId — any
                // element type carries this field per BaseElement.
                {
                  id: 'container-with-bg',
                  type: 'container',
                  elementStyle: {
                    backgroundImageAssetId: parityAssetId,
                    backgroundColor: '#fff',
                  },
                },
                // Nav with logoAssetId — header surface in real fixtures
                // mounts this as a section element.
                {
                  id: 'nav-with-logo',
                  type: 'nav',
                  logoAssetId: parityAssetId,
                  links: [],
                },
                // Carousel with slide assetId — slides[] is the asset-
                // bearing field site-assets.ts walks.
                {
                  id: 'carousel-with-slide',
                  type: 'carousel',
                  slides: [
                    { id: 'slide-1', assetId: parityAssetId },
                    { id: 'slide-2', assetId: 'asset-other' },
                  ],
                },
                // Worst-case nesting: Carousel INSIDE a Collection's
                // customTemplate. Both recursion + slide walking must
                // fire to surface the reference.
                {
                  id: 'collection-with-nested-carousel',
                  type: 'collection',
                  customTemplate: [
                    {
                      id: 'tpl-carousel',
                      type: 'carousel',
                      slides: [{ id: 'tpl-slide-1', assetId: parityAssetId }],
                    },
                    // Container with elementStyle.backgroundImageAssetId
                    // INSIDE the customTemplate — exercises both the
                    // recursion AND the elementStyle clear.
                    {
                      id: 'tpl-bg-container',
                      type: 'container',
                      elementStyle: { backgroundImageAssetId: parityAssetId },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    publishedSnapshot: null,
  };

  function makeParityShim(
    returnSibling: boolean,
    updateLog: Array<Record<string, unknown>> = [],
  ): Db {
    let selectCount = 0;
    return {
      select: () => ({
        from: () => ({
          where: () => {
            selectCount += 1;
            if (selectCount === 1) {
              const result = Promise.resolve([
                { id: parityAssetId, contentHash: expectedHash, r2Key: 'assets/parity.png' },
              ]);
              return Object.assign(result, { limit: () => result });
            }
            if (selectCount === 2) {
              const result = Promise.resolve([paritySiteRow]);
              return Object.assign(result, { limit: () => result });
            }
            const result = Promise.resolve(returnSibling ? [{ id: 'asset-uuid-sibling' }] : []);
            return Object.assign(result, { limit: () => result });
          },
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            updateLog.push(values);
            return Promise.resolve();
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
    } as unknown as Db;
  }

  const parityReportResult = await deleteOwnerAsset(
    { db: makeParityShim(false), r2: reportClient },
    { assetId: parityAssetId, customerId: 'cust-1', confirm: false },
  );
  assert(
    parityReportResult.status === 'confirm_required',
    `(7d) expected confirm_required for parity asset, got ${parityReportResult.status}`,
  );
  if (parityReportResult.status === 'confirm_required') {
    const containerBgRef = parityReportResult.references.find(
      (ref) => ref.elementId === 'container-with-bg',
    );
    assert(
      containerBgRef !== undefined,
      `(7d) delete walker must surface elementStyle.backgroundImageAssetId on a Container; ` +
        `got ${JSON.stringify(parityReportResult.references)}`,
    );
    const navLogoRef = parityReportResult.references.find(
      (ref) => ref.elementId === 'nav-with-logo',
    );
    assert(
      navLogoRef !== undefined,
      `(7d) delete walker must surface nav.logoAssetId; ` +
        `got ${JSON.stringify(parityReportResult.references)}`,
    );
    const carouselSlideRef = parityReportResult.references.find(
      (ref) => ref.elementId === 'carousel-with-slide',
    );
    assert(
      carouselSlideRef !== undefined,
      `(7d) delete walker must surface carousel.slides[].assetId; ` +
        `got ${JSON.stringify(parityReportResult.references)}`,
    );
    const nestedCarouselRef = parityReportResult.references.find(
      (ref) => ref.elementId === 'tpl-carousel',
    );
    assert(
      nestedCarouselRef !== undefined,
      `(7d) delete walker must recurse into customTemplate then surface ` +
        `carousel.slides[].assetId nested inside; ` +
        `got ${JSON.stringify(parityReportResult.references)}`,
    );
    const nestedBgRef = parityReportResult.references.find(
      (ref) => ref.elementId === 'tpl-bg-container',
    );
    assert(
      nestedBgRef !== undefined,
      `(7d) delete walker must recurse into customTemplate then surface ` +
        `elementStyle.backgroundImageAssetId nested inside; ` +
        `got ${JSON.stringify(parityReportResult.references)}`,
    );
  }

  const parityUpdateLog: Array<Record<string, unknown>> = [];
  const parityConfirmResult = await deleteOwnerAsset(
    { db: makeParityShim(false, parityUpdateLog), r2: reportClient },
    { assetId: parityAssetId, customerId: 'cust-1', confirm: true },
  );
  assert(
    parityConfirmResult.status === 'deleted',
    `(7d) expected deleted for parity asset, got ${parityConfirmResult.status}`,
  );
  assert(
    parityUpdateLog.length === 1,
    `(7d) expected one editable-state cleanup write, got ${String(parityUpdateLog.length)}`,
  );
  const parityCleared = parityUpdateLog[0]?.editableState as
    | { pages: Array<{ sections: Array<{ elements: unknown[] }> }> }
    | undefined;
  const parityElements = parityCleared?.pages[0]?.sections[0]?.elements ?? [];

  const containerCleared = parityElements[0] as
    | { elementStyle?: { backgroundImageAssetId?: string; backgroundColor?: string } }
    | undefined;
  assert(
    containerCleared?.elementStyle?.backgroundImageAssetId === undefined,
    `(7d) clearAssetReferences must DELETE elementStyle.backgroundImageAssetId; ` +
      `got ${String(containerCleared?.elementStyle?.backgroundImageAssetId)}`,
  );
  assert(
    containerCleared?.elementStyle?.backgroundColor === '#fff',
    `(7d) clearAssetReferences must preserve other elementStyle fields; ` +
      `got ${String(containerCleared?.elementStyle?.backgroundColor)}`,
  );

  const navCleared = parityElements[1] as { logoAssetId?: string } | undefined;
  assert(
    navCleared?.logoAssetId === '',
    `(7d) clearAssetReferences must clear nav.logoAssetId to ''; ` +
      `got ${String(navCleared?.logoAssetId)}`,
  );

  const carouselCleared = parityElements[2] as
    | { slides?: Array<{ id?: string; assetId?: string }> }
    | undefined;
  assert(
    carouselCleared?.slides?.[0]?.assetId === '',
    `(7d) clearAssetReferences must clear carousel.slides[0].assetId to ''; ` +
      `got ${String(carouselCleared?.slides?.[0]?.assetId)}`,
  );
  assert(
    carouselCleared?.slides?.[1]?.assetId === 'asset-other',
    `(7d) clearAssetReferences must leave UNREFERENCED carousel slides untouched; ` +
      `got ${String(carouselCleared?.slides?.[1]?.assetId)}`,
  );

  const nestedCollection = parityElements[3] as
    | {
        customTemplate?: Array<
          | { type?: string; slides?: Array<{ assetId?: string }> }
          | { type?: string; elementStyle?: { backgroundImageAssetId?: string } }
        >;
      }
    | undefined;
  const nestedCarousel = nestedCollection?.customTemplate?.[0] as
    | { slides?: Array<{ assetId?: string }> }
    | undefined;
  assert(
    nestedCarousel?.slides?.[0]?.assetId === '',
    `(7d) clearAssetReferences must clear carousel slide assetId nested inside ` +
      `customTemplate; got ${String(nestedCarousel?.slides?.[0]?.assetId)}`,
  );
  const nestedBg = nestedCollection?.customTemplate?.[1] as
    | { elementStyle?: { backgroundImageAssetId?: string } }
    | undefined;
  assert(
    nestedBg?.elementStyle?.backgroundImageAssetId === undefined,
    `(7d) clearAssetReferences must DELETE elementStyle.backgroundImageAssetId ` +
      `nested inside customTemplate; got ${String(nestedBg?.elementStyle?.backgroundImageAssetId)}`,
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const png32 = makePng32();
assert(png32.byteLength === 32, `expected 32 bytes, got ${String(png32.byteLength)}`);
const expectedHash = await sha256Hex(png32);

runReferenceWalkTests();
await runUploadTests(png32, expectedHash);
await runReadTests(png32, expectedHash);
await runLottieAssetTests();
await runSlotHistoryScopeTests(png32);
await runUploadMediaTypeGuardTests();
await runDeleteTests(png32, expectedHash);

console.log('[assets:smoke] OK');
