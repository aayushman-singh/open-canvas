// src/embed/expand-short-link.ts
//
// Server-side expansion of URL shortener short links to their final
// destinations. Used by the editor's embed inspector so when the author
// pastes a Google Maps Share-sheet URL (`https://maps.app.goo.gl/...`) we
// resolve it to the canonical `https://www.google.com/maps/...` form
// before saving. The resolver in `./oembed-resolve.ts` then sees a
// fully-qualified URL and can rewrite it to the embeddable
// `?q=...&output=embed` shape so the iframe actually loads.
//
// Why a separate module from `resolveEmbed`?
//
//   - `resolveEmbed` is intentionally pure / sync — every caller can rely
//     on it without setting up I/O. Adding async fetch there would slow the
//     render path AND require every caller to await.
//   - Expansion is a save-time concern, not a render-time one. We expand
//     once when the URL is entered in the editor; the saved state stores
//     the expanded URL forever.
//   - The HEAD-fetch-with-manual-redirect is the only piece that needs the
//     Worker `fetch` binding; everything downstream is pure.
//
// Contract:
//
//   expandShortLink(url, fetchImpl?): Promise<ExpandResult>
//
//     `fetchImpl` defaults to the global `fetch`. The Cloudflare Workers
//     runtime injects its own `fetch` so the route handler can call this
//     function with no argument. Tests pass a mock for deterministic
//     behaviour.
//
//   Returns `{ ok: true, finalUrl, hops }` for a successful expansion or a
//   no-op (input not a known short link). `hops` is 0 when the input host
//   wasn't a short link so the caller can tell expansion happened without
//   re-comparing strings.
//
//   Returns `{ ok: false, error }` when the fetch fails, a redirect lacks
//   a `Location` header, the chain exceeds `MAX_REDIRECTS`, or the fetch
//   times out (`FETCH_TIMEOUT_MS`).

const SHORT_LINK_HOSTS: ReadonlySet<string> = new Set([
  // Google Maps share-sheet (modern + legacy).
  'maps.app.goo.gl',
  'goo.gl',
  // Future expansions: bit.ly, t.co, tinyurl.com, etc. should be added
  // here AND validated to be the kind of redirect-only host we expect.
  // Bare-domain expansions can leak destination URLs from any phishing
  // shortener, so we keep the allow-list explicit.
]);

const MAX_REDIRECTS = 6;
const FETCH_TIMEOUT_MS = 4000;

export type ExpandResult =
  | { ok: true; finalUrl: string; hops: number }
  | { ok: false; error: string };

/** True when the URL's host is one of the known short-link providers. */
export function isShortLinkUrl(url: string): boolean {
  try {
    return SHORT_LINK_HOSTS.has(new URL(url).host);
  } catch {
    return false;
  }
}

export async function expandShortLink(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExpandResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'invalid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: `unsupported protocol ${JSON.stringify(parsed.protocol)}` };
  }
  if (!SHORT_LINK_HOSTS.has(parsed.host)) {
    // Caller can pass any URL; non-short-link hosts are a no-op so the
    // editor can call this unconditionally.
    return { ok: true, finalUrl: url, hops: 0 };
  }

  let current = url;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(current, {
        method: 'HEAD',
        redirect: 'manual',
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `fetch failed at hop ${String(hop)}: ${message}` };
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) {
        return { ok: false, error: `redirect ${String(res.status)} at hop ${String(hop)} missing Location header` };
      }
      try {
        current = new URL(loc, current).toString();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `redirect target unparseable at hop ${String(hop)}: ${message}` };
      }
      continue;
    }

    // Non-redirect: this is the final URL.
    return { ok: true, finalUrl: current, hops: hop };
  }

  return { ok: false, error: `too many redirects (>${String(MAX_REDIRECTS)})` };
}
