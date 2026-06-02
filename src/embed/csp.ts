// src/embed/csp.ts
//
// Snapshot-aware Content-Security-Policy header builder.
//
// Contract:
//
//   buildEmbedCsp(snapshot): string
//
//     Returns the full CSP header value. The main thread's public route
//     handler (`src/routes/public.ts`) adds it to the snapshot response via
//     `c.header('Content-Security-Policy', buildEmbedCsp(snapshot))`.
//
// What the CSP says, exactly:
//
//   default-src 'self';
//   img-src 'self' data: blob:;          ← canvas styles use data: backgrounds
//   style-src 'self' 'unsafe-inline';    ← <style> block is inlined
//   script-src 'self' 'unsafe-inline'
//     https://static.cloudflareinsights.com
//     https://challenges.cloudflare.com; ← Turnstile widget loader
//   frame-src 'self' https://challenges.cloudflare.com <origins…>;
//                                         ← Turnstile challenge iframe + embeds
//   font-src 'self' data:;
//   connect-src 'self' wss: ws:
//     https://challenges.cloudflare.com;  ← Turnstile siteverify XHR
//
// The non-frame-src directives are a static baseline — they mirror what the
// public renderer already implicitly relies on (inline <style> blocks, an
// inline <script> module for the live-reload, etc). The frame-src list is
// the only piece that varies per snapshot, and it is the *whole point* of
// this builder: an Owner who publishes a YouTube embed should get `https://
// www.youtube.com` allow-listed; an Owner who never embedded anything
// shouldn't have any third-party origins in their header.
//
// Why a static CSP baseline if the goal is "just frame-src"? Because the
// caller adds ONE header. If we returned only `frame-src ...` then the
// browser would NOT apply the default-src guard at all (no header = no CSP).
// The whole header has to be present.
//
// Deduplication: the same origin appearing in multiple embeds collapses to
// a single token. `'self'` is always emitted first; third-party origins
// follow in stable sorted order so the header value is deterministic for
// any given snapshot — the smoke depends on this.

import type { PublishedSnapshot } from '../canvas/schema.js';
import { resolveEmbed } from './oembed-resolve.js';

/**
 * Walk a snapshot and return the deduplicated, sorted list of third-party
 * iframe origins required for its embed elements. `'none'` placeholders
 * (returned by the resolver for invalid URLs) are filtered out so they
 * never leak into the header.
 */
export function collectEmbedFrameSrcOrigins(snapshot: PublishedSnapshot): string[] {
  const origins = new Set<string>();
  for (const page of snapshot.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.type !== 'embed') continue;
        const resolved = resolveEmbed(element.url);
        if (resolved.providerName === 'invalid') continue;
        for (const origin of resolved.frameSrcOrigins) {
          if (origin === '' || origin === 'none') continue;
          origins.add(origin);
        }
      }
    }
  }
  return Array.from(origins).sort();
}

/**
 * True when any inline run inside a TextElement carries a `math` field.
 * The public renderer ships KaTeX HTML for those runs and the page links
 * `cdn.jsdelivr.net`'s KaTeX stylesheet to make it look right; CSP
 * `style-src` has to include that origin or the stylesheet is blocked and
 * the equation renders as raw boxes.
 */
function snapshotHasMathRun(snapshot: PublishedSnapshot): boolean {
  for (const page of snapshot.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.type !== 'text') continue;
        for (const run of element.content) {
          if (run.math) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Construct the full Content-Security-Policy header value for `snapshot`.
 *
 * Pure, deterministic. The same snapshot always produces the same header
 * (modulo embed element insertion order, which the sort step neutralises).
 */
export function buildEmbedCsp(snapshot: PublishedSnapshot): string {
  const frameOrigins = collectEmbedFrameSrcOrigins(snapshot);
  // 'self' is always permitted as a frame-src so the editor's `/__live`
  // iframe and any future first-party embeds keep working. Turnstile renders
  // its challenge in an iframe at `https://challenges.cloudflare.com`, so
  // every published page with a Form element must allow that origin. We
  // include it unconditionally — forms are common enough that varying the
  // CSP by element presence adds inspection cost for no payoff. We do not
  // allow 'none' because that would mask `'self'` per CSP semantics.
  const frameSrc = ["'self'", 'https://challenges.cloudflare.com', ...frameOrigins].join(' ');

  // KaTeX stylesheet + (font fallback) load from jsDelivr only when the
  // snapshot actually has a math run. Always-on would broaden style-src
  // unconditionally; gating on presence keeps the surface tight per snapshot.
  const hasMath = snapshotHasMathRun(snapshot);
  const styleExtras = hasMath ? ' https://cdn.jsdelivr.net' : '';
  const fontExtras = hasMath ? ' https://cdn.jsdelivr.net' : '';

  return [
    `default-src 'self'`,
    `img-src 'self' data: blob:`,
    `style-src 'self' 'unsafe-inline'${styleExtras}`,
    // Turnstile widget loader is the only third-party script the public
    // renderer emits. Cloudflare Insights is allowed for Workers analytics.
    `script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://challenges.cloudflare.com`,
    `font-src 'self' data:${fontExtras}`,
    // Turnstile's challenge JS posts back to challenges.cloudflare.com.
    `connect-src 'self' wss: ws: https://challenges.cloudflare.com`,
    `frame-src ${frameSrc}`,
  ].join('; ');
}
