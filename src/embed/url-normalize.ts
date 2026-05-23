// src/embed/url-normalize.ts
//
// Tiny URL parser + canonicaliser used by the oEmbed resolver and the CSP
// builder. Both consumers need the same answers about a candidate Embed URL:
//
//   - Is it a syntactically valid http(s) URL? (oEmbed providers only speak
//     http(s); a `javascript:` or `data:` URL is a hard reject — the
//     embed element refuses to render.)
//   - What is its lower-cased host? (used for provider regex matching)
//   - What is its origin? (the `scheme://host` string the CSP `frame-src`
//     directive consumes verbatim)
//
// Pure functions, no I/O, no allocation beyond what URL parsing inherently
// does. Returns null for any URL we refuse to embed; callers treat null as
// "render an explicit failure placeholder and skip CSP allowlisting."
//
// We do NOT do any path stripping or query rewriting here. The provider
// resolver (oembed-resolve.ts) owns provider-specific path/query rewrites
// because those are *iframe URL* concerns, not *URL identity* concerns.

/**
 * The shape `oembed-resolve.ts` consumes. `origin` is exactly the string a
 * CSP `frame-src` token uses — no trailing slash, no path. `host` is the
 * lower-cased hostname; we keep it separate so provider regex tables stay
 * concise.
 */
export interface ParsedEmbedUrl {
  /** Original URL, untouched. */
  raw: string;
  /** Lower-cased hostname (`youtube.com`, `www.youtube.com`, ...). */
  host: string;
  /** `https://www.youtube.com` — for CSP. No path, no slash. */
  origin: string;
  /** Path portion including leading slash; `/` when empty. */
  pathname: string;
  /** Search portion including leading `?`; `''` when empty. */
  search: string;
}

/**
 * Parse a candidate Embed URL. Returns null when the URL is not a syntactically
 * valid absolute http(s) URL. We deliberately refuse anything else — relative
 * URLs (`/page`), other schemes (`javascript:`, `data:`, `chrome:`), and
 * malformed strings all yield null. The caller must treat null as a hard
 * "do not embed" signal.
 */
export function parseEmbedUrl(raw: string): ParsedEmbedUrl | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // An empty host is not possible for an http(s) URL parsed by the WHATWG
  // URL parser, but we guard defensively — a future change in browser
  // semantics shouldn't let through `http:///path`.
  if (url.hostname.length === 0) return null;
  const host = url.hostname.toLowerCase();
  const origin = `${url.protocol}//${host}`;
  return {
    raw,
    host,
    origin,
    pathname: url.pathname === '' ? '/' : url.pathname,
    search: url.search,
  };
}

/**
 * Extract the first capture group of `regex.exec(input)`, returning null when
 * the pattern does not match or the capture is empty. Helper used by the
 * provider regex table; kept here so the resolver file stays just patterns
 * and outputs.
 */
export function firstCapture(regex: RegExp, input: string): string | null {
  const match = regex.exec(input);
  if (!match) return null;
  const captured = match[1];
  if (typeof captured !== 'string' || captured.length === 0) return null;
  return captured;
}
