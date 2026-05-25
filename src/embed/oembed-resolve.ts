// src/embed/oembed-resolve.ts
//
// URL → embeddable-iframe-URL resolver. The contract is:
//
//   resolveEmbed(url): ResolvedEmbed
//
// ResolvedEmbed always has an `embedUrl` and a `frameSrcOrigin`. The
// `providerName` field carries either a known provider id or the literal
// 'generic' for arbitrary URLs that fall through to the sandboxed-iframe
// fallback. The function NEVER throws and NEVER returns null — a malformed
// URL produces a "broken" record whose `embedUrl` is empty and whose CSP
// origin is the special `'none'` token, signalling the renderer to emit a
// failure placeholder.
//
// Provider list (9 named providers):
//
//   1. YouTube         — youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID
//   2. Vimeo           — vimeo.com/ID
//   3. Loom            — loom.com/share/ID
//   4. Figma           — figma.com/file/ID/..., figma.com/proto/ID/...
//   5. Spotify         — open.spotify.com/{track|album|episode|playlist}/ID
//   6. SoundCloud      — soundcloud.com/{user}/{track}
//   7. CodePen         — codepen.io/{user}/pen/ID
//   8. Twitter / X     — twitter.com/{user}/status/ID, x.com/{user}/status/ID
//   9. Google Maps     — google.com/maps/..., maps.google.com/..., goo.gl/maps/...
//
// For known providers the iframe URL is derived purely from the pattern —
// NO external HTTP fetch is required. SoundCloud, Twitter, and CodePen are
// the trickiest because their iframe URLs embed the raw URL as a query
// parameter; we encode the URL verbatim.
//
// Why no HTTP fetch path? The plan's "oEmbed lookup for things like
// Twitter" reads as future work — for the POC the deterministic regex
// table covers every provider on the list. The cache module
// (`./cache.ts`) provides a read-through layer for callers that later
// want to query a real oEmbed endpoint; it lives in its own module so
// adding that path is a one-import diff.

import { firstCapture, parseEmbedUrl, type ParsedEmbedUrl } from './url-normalize.js';

/** Stable provider ids the CSP builder + render fn switch on. */
export const EMBED_PROVIDERS = [
  'youtube',
  'vimeo',
  'loom',
  'figma',
  'spotify',
  'soundcloud',
  'codepen',
  'twitter',
  'google-maps',
  'generic',
  'invalid',
] as const;
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

export interface ResolvedEmbed {
  /** The URL to drop into `<iframe src>`. Empty string when provider === 'invalid'. */
  embedUrl: string;
  /**
   * The CSP `frame-src` origin (`https://www.youtube.com`). Set to `'none'`
   * for invalid URLs so the CSP builder knows to skip them — the renderer
   * will not emit an iframe at all in that case.
   */
  frameSrcOrigin: string;
  /** Which provider matched (or 'generic' / 'invalid'). */
  providerName: EmbedProvider;
}

// ---------------------------------------------------------------------------
// Per-provider matchers. Each one inspects a ParsedEmbedUrl and either
// returns a ResolvedEmbed or null to indicate "I don't match — try the
// next provider." Order in `PROVIDER_MATCHERS` is the priority order; the
// first non-null answer wins.
// ---------------------------------------------------------------------------

type ProviderMatcher = (parsed: ParsedEmbedUrl) => ResolvedEmbed | null;

const YOUTUBE_FULL = /^\/watch$/;
const YOUTUBE_SHORTS = /^\/shorts\/([A-Za-z0-9_-]{6,})$/;
const YOUTUBE_EMBED = /^\/embed\/([A-Za-z0-9_-]{6,})$/;
const YOUTUBE_SHORT = /^\/([A-Za-z0-9_-]{6,})$/; // youtu.be

function matchYouTube(parsed: ParsedEmbedUrl): ResolvedEmbed | null {
  const isMain =
    parsed.host === 'youtube.com' ||
    parsed.host === 'www.youtube.com' ||
    parsed.host === 'm.youtube.com';
  const isShort = parsed.host === 'youtu.be';
  if (!isMain && !isShort) return null;

  let videoId: string | null = null;

  if (isMain && YOUTUBE_FULL.test(parsed.pathname)) {
    // Pull `v=ID` from the search string. URLSearchParams handles encoding.
    const search = new URLSearchParams(parsed.search);
    const v = search.get('v');
    if (v && /^[A-Za-z0-9_-]{6,}$/.test(v)) {
      videoId = v;
    }
  } else if (isMain) {
    const shortsCapture = firstCapture(YOUTUBE_SHORTS, parsed.pathname);
    if (shortsCapture) {
      videoId = shortsCapture;
    } else {
      const embedCapture = firstCapture(YOUTUBE_EMBED, parsed.pathname);
      if (embedCapture) videoId = embedCapture;
    }
  } else if (isShort) {
    const capture = firstCapture(YOUTUBE_SHORT, parsed.pathname);
    if (capture) videoId = capture;
  }

  if (videoId === null) return null;
  return {
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    frameSrcOrigin: 'https://www.youtube.com',
    providerName: 'youtube',
  };
}

const VIMEO_PATH = /^\/(\d{4,})$/;

function matchVimeo(parsed: ParsedEmbedUrl): ResolvedEmbed | null {
  if (parsed.host !== 'vimeo.com' && parsed.host !== 'www.vimeo.com') return null;
  const videoId = firstCapture(VIMEO_PATH, parsed.pathname);
  if (videoId === null) return null;
  return {
    embedUrl: `https://player.vimeo.com/video/${videoId}`,
    frameSrcOrigin: 'https://player.vimeo.com',
    providerName: 'vimeo',
  };
}

const LOOM_SHARE = /^\/share\/([0-9a-f]{16,})$/;
const LOOM_EMBED = /^\/embed\/([0-9a-f]{16,})$/;

function matchLoom(parsed: ParsedEmbedUrl): ResolvedEmbed | null {
  if (parsed.host !== 'loom.com' && parsed.host !== 'www.loom.com') return null;
  const id =
    firstCapture(LOOM_SHARE, parsed.pathname) ?? firstCapture(LOOM_EMBED, parsed.pathname);
  if (id === null) return null;
  return {
    embedUrl: `https://www.loom.com/embed/${id}`,
    frameSrcOrigin: 'https://www.loom.com',
    providerName: 'loom',
  };
}

function matchFigma(parsed: ParsedEmbedUrl): ResolvedEmbed | null {
  if (parsed.host !== 'figma.com' && parsed.host !== 'www.figma.com') return null;
  // Figma's documented embed format takes the original URL as a `url=` query
  // parameter on https://www.figma.com/embed. We accept any path that starts
  // with /file/, /proto/, /design/, or /board/.
  if (!/^\/(file|proto|design|board)\//.test(parsed.pathname)) return null;
  return {
    embedUrl: `https://www.figma.com/embed?embed_host=rev01&url=${encodeURIComponent(parsed.raw)}`,
    frameSrcOrigin: 'https://www.figma.com',
    providerName: 'figma',
  };
}

const SPOTIFY_PATH = /^\/(track|album|episode|playlist|show|artist)\/([A-Za-z0-9]{16,})$/;

function matchSpotify(parsed: ParsedEmbedUrl): ResolvedEmbed | null {
  if (parsed.host !== 'open.spotify.com') return null;
  const match = SPOTIFY_PATH.exec(parsed.pathname);
  if (!match) return null;
  const kind = match[1];
  const id = match[2];
  if (typeof kind !== 'string' || typeof id !== 'string') return null;
  return {
    embedUrl: `https://open.spotify.com/embed/${kind}/${id}`,
    frameSrcOrigin: 'https://open.spotify.com',
    providerName: 'spotify',
  };
}

function matchSoundCloud(parsed: ParsedEmbedUrl): ResolvedEmbed | null {
  if (parsed.host !== 'soundcloud.com' && parsed.host !== 'www.soundcloud.com') return null;
  // SoundCloud iframe player wraps the raw URL via `?url=`. Accept any path
  // shape; SoundCloud's own player decides what's valid and responds with a
  // visual error iframe-side if it isn't a real track.
  if (parsed.pathname === '/' || parsed.pathname === '') return null;
  return {
    embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(parsed.raw)}`,
    frameSrcOrigin: 'https://w.soundcloud.com',
    providerName: 'soundcloud',
  };
}

const CODEPEN_PATH = /^\/([A-Za-z0-9_-]+)\/pen\/([A-Za-z0-9]{4,})\/?$/;

function matchCodePen(parsed: ParsedEmbedUrl): ResolvedEmbed | null {
  if (parsed.host !== 'codepen.io' && parsed.host !== 'www.codepen.io') return null;
  const match = CODEPEN_PATH.exec(parsed.pathname);
  if (!match) return null;
  const user = match[1];
  const penId = match[2];
  if (typeof user !== 'string' || typeof penId !== 'string') return null;
  return {
    embedUrl: `https://codepen.io/${user}/embed/${penId}`,
    frameSrcOrigin: 'https://codepen.io',
    providerName: 'codepen',
  };
}

const TWITTER_STATUS = /^\/[A-Za-z0-9_]+\/status\/(\d{8,})$/;

function matchTwitter(parsed: ParsedEmbedUrl): ResolvedEmbed | null {
  if (
    parsed.host !== 'twitter.com' &&
    parsed.host !== 'www.twitter.com' &&
    parsed.host !== 'x.com' &&
    parsed.host !== 'www.x.com'
  ) {
    return null;
  }
  if (!TWITTER_STATUS.test(parsed.pathname)) return null;
  // The platform.twitter.com tweet embed widget renders a single tweet given
  // its full URL in the iframe src — no oEmbed round-trip needed for a known
  // status URL. This is what `publish.twitter.com/oembed` returns under the
  // hood; we encode the same shape statically.
  return {
    embedUrl: `https://platform.twitter.com/embed/Tweet.html?url=${encodeURIComponent(parsed.raw)}`,
    frameSrcOrigin: 'https://platform.twitter.com',
    providerName: 'twitter',
  };
}

const GOOGLE_MAPS_PLACE = /^\/maps\/place\/([^/]+)/;
const GOOGLE_MAPS_AT = /^\/maps\/@(-?[\d.]+),(-?[\d.]+)/;

function matchGoogleMaps(parsed: ParsedEmbedUrl): ResolvedEmbed | null {
  const isGoogleMaps =
    parsed.host === 'maps.google.com' ||
    parsed.host === 'www.maps.google.com' ||
    ((parsed.host === 'google.com' || parsed.host === 'www.google.com') &&
      parsed.pathname.startsWith('/maps'));
  const isGooGl = parsed.host === 'goo.gl' && parsed.pathname.startsWith('/maps');

  if (!isGoogleMaps && !isGooGl) return null;

  // Extract query from various URL formats.
  let query: string | null = null;

  // /maps/place/PLACE_NAME/...
  const placeMatch = GOOGLE_MAPS_PLACE.exec(parsed.pathname);
  if (placeMatch && placeMatch[1]) {
    query = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
  }

  // /maps/@LAT,LNG,...
  if (!query) {
    const atMatch = GOOGLE_MAPS_AT.exec(parsed.pathname);
    if (atMatch && atMatch[1] && atMatch[2]) {
      query = `${atMatch[1]},${atMatch[2]}`;
    }
  }

  // ?q=QUERY in search params
  if (!query) {
    const params = new URLSearchParams(parsed.search);
    const q = params.get('q');
    if (q) query = q;
  }

  // For goo.gl short links or unrecognized formats, use the raw URL.
  if (!query) {
    query = parsed.raw;
  }

  return {
    embedUrl: `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`,
    frameSrcOrigin: 'https://maps.google.com',
    providerName: 'google-maps',
  };
}

const PROVIDER_MATCHERS: ProviderMatcher[] = [
  matchYouTube,
  matchVimeo,
  matchLoom,
  matchFigma,
  matchSpotify,
  matchSoundCloud,
  matchCodePen,
  matchTwitter,
  matchGoogleMaps,
];

/**
 * Resolve a URL to an embeddable iframe spec. Pure, synchronous, total.
 *
 * Behaviour:
 *   - Malformed / non-http(s) URL → `{ providerName: 'invalid' }`.
 *   - Matches one of the 8 named providers → that provider's iframe URL.
 *   - Otherwise → `{ providerName: 'generic' }` with the raw URL passed
 *     through as the iframe src, and `frameSrcOrigin` set to the URL's own
 *     origin so the CSP builder can allow exactly that origin.
 */
export function resolveEmbed(url: string): ResolvedEmbed {
  const parsed = parseEmbedUrl(url);
  if (parsed === null) {
    return { embedUrl: '', frameSrcOrigin: 'none', providerName: 'invalid' };
  }
  for (const matcher of PROVIDER_MATCHERS) {
    const result = matcher(parsed);
    if (result !== null) return result;
  }
  return {
    embedUrl: parsed.raw,
    frameSrcOrigin: parsed.origin,
    providerName: 'generic',
  };
}
