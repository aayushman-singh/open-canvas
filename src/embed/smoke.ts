// src/embed/smoke.ts
//
// `bun run embed:smoke` — wave-2 #8 smoke. Exercises the four assertions
// the plan demands:
//
//   1. YouTube URL `https://youtube.com/watch?v=abc123` resolves to
//      iframe `src="https://www.youtube.com/embed/abc123"`.
//   2. An unknown URL renders a generic iframe carrying the sandbox
//      attribute string.
//   3. `buildEmbedCsp` for a snapshot containing YouTube + Loom embeds
//      includes both `frame-src` origins.
//   4. The cache returns the same result on a second lookup without
//      re-resolving (we assert by observing the cache `match` count).
//
// All assertions are pure-CPU; no network, no DB, no Workers globals.

import { renderEmbed, EMBED_IFRAME_SANDBOX, type EmbedElement } from '../canvas/elements/embed.js';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { buildEmbedCsp, collectEmbedFrameSrcOrigins } from './csp.js';
import { resolveEmbedCached, type CacheLike } from './cache.js';
import { resolveEmbed } from './oembed-resolve.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[embed:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// (1) YouTube URL → expected iframe src.
// ---------------------------------------------------------------------------

const youTubeEl: EmbedElement = {
  id: 'embed-yt',
  type: 'embed',
  url: 'https://youtube.com/watch?v=abc123',
  box: { x: 0, y: 0, w: 640, h: 360, z: 1 },
};

const youTubeHtml = renderEmbed(youTubeEl, { styleKit: 'charcoal' });
assert(
  youTubeHtml.includes(`src="https://www.youtube.com/embed/abc123"`),
  `expected YouTube iframe src "https://www.youtube.com/embed/abc123"; got: ${youTubeHtml}`,
);
assert(
  youTubeHtml.includes(`data-rev01-embed-provider="youtube"`),
  `expected YouTube provider data-attr; got: ${youTubeHtml}`,
);
assert(
  youTubeHtml.includes(`sandbox="${EMBED_IFRAME_SANDBOX}"`),
  `expected sandbox attr on YouTube iframe; got: ${youTubeHtml}`,
);
assert(
  youTubeHtml.includes(`referrerpolicy="no-referrer"`),
  `expected referrerpolicy=no-referrer on YouTube iframe`,
);
assert(youTubeHtml.includes(`loading="lazy"`), `expected loading=lazy on YouTube iframe`);

// Cross-check the other "well-known shapes" while we're here. These extra
// assertions cost ~zero CPU and protect against silent regex drift.
const shapeCases: Array<{ url: string; expectedSrc: string; provider: string }> = [
  {
    url: 'https://youtu.be/xyz789ab',
    expectedSrc: 'https://www.youtube.com/embed/xyz789ab',
    provider: 'youtube',
  },
  {
    url: 'https://vimeo.com/123456789',
    expectedSrc: 'https://player.vimeo.com/video/123456789',
    provider: 'vimeo',
  },
  {
    url: 'https://www.loom.com/share/0123456789abcdef0123456789abcdef',
    expectedSrc: 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef',
    provider: 'loom',
  },
  {
    url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    expectedSrc: 'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT',
    provider: 'spotify',
  },
  {
    url: 'https://codepen.io/janedoe/pen/aBcDeFg',
    expectedSrc: 'https://codepen.io/janedoe/embed/aBcDeFg',
    provider: 'codepen',
  },
];
for (const tc of shapeCases) {
  const resolved = resolveEmbed(tc.url);
  assert(
    resolved.providerName === tc.provider,
    `[${tc.url}] expected provider ${tc.provider}, got ${resolved.providerName}`,
  );
  assert(
    resolved.embedUrl === tc.expectedSrc,
    `[${tc.url}] expected embedUrl ${tc.expectedSrc}, got ${resolved.embedUrl}`,
  );
}

// Figma's iframe URL embeds the original URL as a query param; assert the
// resolver passes through that shape with the correct host.
const figmaResolved = resolveEmbed('https://www.figma.com/file/aB12cD34/My-Design');
assert(figmaResolved.providerName === 'figma', 'figma: provider mismatch');
assert(
  figmaResolved.embedUrl.startsWith('https://www.figma.com/embed?'),
  `figma: embedUrl must start with https://www.figma.com/embed?; got ${figmaResolved.embedUrl}`,
);
assert(
  figmaResolved.embedUrl.includes('url=https%3A%2F%2Fwww.figma.com%2Ffile%2FaB12cD34%2FMy-Design'),
  `figma: embedUrl must encode original URL; got ${figmaResolved.embedUrl}`,
);

// Twitter / X status URLs.
const twitterResolved = resolveEmbed('https://x.com/jack/status/20000000000000');
assert(twitterResolved.providerName === 'twitter', 'twitter: provider mismatch');
assert(
  twitterResolved.frameSrcOrigin === 'https://platform.twitter.com',
  `twitter: frameSrcOrigin mismatch; got ${twitterResolved.frameSrcOrigin}`,
);

// ---------------------------------------------------------------------------
// (2) Unknown URL → generic iframe with sandbox attrs.
// ---------------------------------------------------------------------------

const unknownEl: EmbedElement = {
  id: 'embed-unknown',
  type: 'embed',
  url: 'https://example.com/some/page',
  box: { x: 0, y: 0, w: 640, h: 360, z: 1 },
};

const unknownHtml = renderEmbed(unknownEl, { styleKit: 'charcoal' });
assert(
  unknownHtml.includes(`data-rev01-embed-provider="generic"`),
  `expected generic provider data-attr; got: ${unknownHtml}`,
);
assert(
  unknownHtml.includes(`src="https://example.com/some/page"`),
  `expected generic iframe to carry raw src; got: ${unknownHtml}`,
);
assert(
  unknownHtml.includes(`sandbox="${EMBED_IFRAME_SANDBOX}"`),
  `expected sandbox attr on generic iframe; got: ${unknownHtml}`,
);
assert(
  unknownHtml.includes(`loading="lazy"`),
  `expected loading=lazy on generic iframe; got: ${unknownHtml}`,
);

// Invalid URL → no iframe.
const invalidEl: EmbedElement = {
  id: 'embed-invalid',
  type: 'embed',
  url: 'javascript:alert(1)',
  box: { x: 0, y: 0, w: 640, h: 360, z: 1 },
};
const invalidHtml = renderEmbed(invalidEl, { styleKit: 'charcoal' });
assert(
  invalidHtml.includes(`rev01-embed-invalid`),
  `expected rev01-embed-invalid placeholder for javascript: URL`,
);
assert(
  !invalidHtml.includes(`<iframe`),
  `expected NO iframe in invalid embed render; got: ${invalidHtml}`,
);

// ---------------------------------------------------------------------------
// (3) buildEmbedCsp for a snapshot with YouTube + Loom embeds.
// ---------------------------------------------------------------------------

const ytEmbed: EmbedElement = {
  id: 'embed-yt',
  type: 'embed',
  url: 'https://youtube.com/watch?v=abc123',
  box: { x: 0, y: 0, w: 640, h: 360, z: 1 },
};
const loomEmbed: EmbedElement = {
  id: 'embed-loom',
  type: 'embed',
  url: 'https://www.loom.com/share/0123456789abcdef0123456789abcdef',
  box: { x: 0, y: 400, w: 640, h: 360, z: 1 },
};

const snapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-23T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'section-embeds',
          recipeId: 'hero-split',
          name: 'Embeds',
          height: 800,
          elements: [ytEmbed, loomEmbed],
        },
      ],
    },
  ],
};

const origins = collectEmbedFrameSrcOrigins(snapshot);
assert(
  origins.includes('https://www.youtube.com'),
  `expected origins to include YouTube; got ${JSON.stringify(origins)}`,
);
assert(
  origins.includes('https://www.loom.com'),
  `expected origins to include Loom; got ${JSON.stringify(origins)}`,
);

const csp = buildEmbedCsp(snapshot);
assert(csp.startsWith(`default-src 'self'`), `CSP must start with default-src 'self'; got: ${csp}`);
assert(
  csp.includes(`frame-src 'self' https://www.loom.com https://www.youtube.com`),
  `CSP frame-src must include 'self' + both provider origins in sorted order; got: ${csp}`,
);

// A snapshot with NO embeds at all must still produce a valid CSP header
// whose frame-src is exactly `'self'` — never empty (an empty `frame-src`
// directive matches NO origins, which would silently block first-party
// iframes).
const noEmbedSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-23T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-bare',
      slug: 'bare',
      title: 'Bare',
      width: 1440,
      sections: [],
    },
  ],
};
const bareCsp = buildEmbedCsp(noEmbedSnapshot);
assert(
  bareCsp.includes(`frame-src 'self'`),
  `bare snapshot CSP must include frame-src 'self'; got: ${bareCsp}`,
);

// ---------------------------------------------------------------------------
// (4) Cache returns same result on second lookup without re-resolving.
//
// We use an in-memory CacheLike that tracks how many times each key was
// queried. The first `resolveEmbedCached` call must miss + write; the
// second must hit + return byte-identical bytes.
// ---------------------------------------------------------------------------

class MemoryCache implements CacheLike {
  store = new Map<string, { body: string; init: ResponseInit }>();
  matchCount = 0;
  putCount = 0;

  match(request: Request): Promise<Response | undefined> {
    this.matchCount += 1;
    const entry = this.store.get(request.url);
    if (!entry) return Promise.resolve(undefined);
    return Promise.resolve(new Response(entry.body, entry.init));
  }

  put(request: Request, response: Response): Promise<void> {
    this.putCount += 1;
    // We don't preserve all headers — the cache test only inspects the
    // body and the count of match/put calls. Reading the body consumes
    // the response stream; that's fine because the production cache
    // does the same on its side.
    return response.text().then((body) => {
      this.store.set(request.url, {
        body,
        init: { headers: { 'content-type': 'application/json' } },
      });
    });
  }
}

const cache = new MemoryCache();
const TEST_URL = 'https://vimeo.com/424242424';

const first = await resolveEmbedCached(TEST_URL, { cache });
assert(first.providerName === 'vimeo', `first lookup must resolve to vimeo; got ${first.providerName}`);
assert(cache.putCount === 1, `first lookup must put once; got ${cache.putCount}`);

const second = await resolveEmbedCached(TEST_URL, { cache });
assert(second.embedUrl === first.embedUrl, `second lookup must return same embedUrl`);
assert(
  second.frameSrcOrigin === first.frameSrcOrigin,
  `second lookup must return same frameSrcOrigin`,
);
assert(second.providerName === first.providerName, `second lookup must return same providerName`);
// The critical assertion: no second put. The cache served the second
// lookup without re-running the regex resolver.
assert(
  cache.putCount === 1,
  `second lookup must NOT put again (cache hit expected); got putCount=${cache.putCount}`,
);
assert(cache.matchCount === 2, `cache must have been matched twice; got ${cache.matchCount}`);

// Invalid URLs must NOT be cached — the resolver returns 'invalid' and the
// wrapper deliberately skips the put.
const beforeInvalid = cache.putCount;
const invalid = await resolveEmbedCached('not-a-url', { cache });
assert(invalid.providerName === 'invalid', 'invalid URL must resolve to provider=invalid');
assert(
  cache.putCount === beforeInvalid,
  `invalid URLs must not be written to cache; put count moved`,
);

// ---------------------------------------------------------------------------
// All assertions passed.
// ---------------------------------------------------------------------------

console.log('[embed:smoke] OK — 4/4 assertions passed');
