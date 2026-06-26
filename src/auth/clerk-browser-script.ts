// src/auth/clerk-browser-script.ts
//
// Shared clerk-js (clerk.browser.js) loader for dashboard HTML pages.
//
// Clerk's `__session` cookie is a short-lived JWT (~60s). It is refreshed two
// ways: (1) clerk-js running in the page heartbeats and rotates the cookie,
// and (2) a server-side handshake on GET navigations. Pages with mutating
// form POSTs (e.g. the create-site form on /dashboard/templates) cannot rely
// on the GET-only handshake: if the token expires while the Owner fills the
// form, the POST arrives with a stale token and `authenticateRequest` returns
// isAuthenticated:false → requireAuth answers 401 `unauthorized`.
//
// The dashboard root app injects clerk-js via its own `use('*')` middleware,
// but the separately-mounted dashboard sub-apps (templates, settings, forms,
// domains, …) bypass that middleware and shipped no clerk-js — so their forms
// silently 401 once the token aged out. This module centralises the injection
// so a single root-level middleware covers every dashboard HTML response.
//
// Idempotent: pages that already self-inject clerk-js (dashboard index,
// editor) are left untouched (the middleware detects the existing bundle URL
// and skips), so this never double-loads Clerk.

import { createMiddleware } from 'hono/factory';
import { resolveClerkKeys, type ClerkKeyEnv } from './middleware';
import { clerkFrontendApiHost } from './require-auth';

type ClerkScriptEnv = ClerkKeyEnv & { CLERK_FRONTEND_API_URL?: string };

// Marker substring used both to write the bundle URL and to detect a page
// that already loads clerk-js (so we never inject twice).
const CLERK_BUNDLE_MARKER = 'clerk.browser.js';

/** Paths that must bypass this middleware entirely (no body read/rebuild). */
export function shouldSkipClerkBrowserScriptInjection(path: string): boolean {
  if (path.endsWith('/preview')) return true;
  // Editor routes ship strict CSP + nonce'd inline boot/clerk scripts. They
  // self-inject clerk-js and must never be buffered/rebuilt here — doing so
  // (especially when this middleware is accidentally registered twice) can
  // strip or corrupt response headers and leave the canvas client dead.
  if (/^\/dashboard\/sites\/[^/]+\/edit$/.test(path)) return true;
  if (/^\/dashboard\/admin\/templates\/[^/]+\/edit$/.test(path)) return true;
  return false;
}

function rebuildHtmlResponse(body: string, source: Response): Response {
  const headers = new Headers(source.headers);
  // Body was decoded via Response.text(); drop encoding/length from the
  // source so the rebuilt response is not mislabeled as gzip/etc.
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(body, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

/**
 * Build the inline bootstrap `<script>` that loads clerk.browser.js from the
 * server-resolved Clerk frontend host and calls `Clerk.load()`. The host is
 * resolved server-side (not from the publishable key's encoded host) so the
 * bundle URL survives a Clerk domain rebrand without re-issuing keys.
 */
export function buildClerkBrowserScriptTag(env: ClerkScriptEnv): string {
  const { publishableKey } = resolveClerkKeys(env);
  const clerkHost = clerkFrontendApiHost(publishableKey, env.CLERK_FRONTEND_API_URL);
  return (
    `<script>(function(){` +
    `if(window.__ocClerkBootstrapped)return;window.__ocClerkBootstrapped=true;` +
    `var pk="${publishableKey}";` +
    `var s=document.createElement("script");` +
    `s.src="https://${clerkHost}/npm/@clerk/clerk-js@latest/dist/${CLERK_BUNDLE_MARKER}";` +
    `s.crossOrigin="anonymous";s.async=true;` +
    `s.setAttribute("data-clerk-publishable-key",pk);` +
    `s.onload=function(){if(window.Clerk)window.Clerk.load();};` +
    `document.head.appendChild(s);` +
    `})()</script>`
  );
}

/**
 * Root-level middleware: ensures every dashboard HTML response loads clerk-js
 * so the session cookie stays fresh and form POSTs don't 401. Skips non-HTML
 * responses, `/preview` surfaces (template/site preview iframes must stay
 * chrome-free), and pages that already embed clerk-js.
 */
export function injectClerkBrowserScript() {
  return createMiddleware<{ Bindings: ClerkScriptEnv }>(async (c, next) => {
    if (shouldSkipClerkBrowserScriptInjection(c.req.path)) {
      return next();
    }
    await next();
    const contentType = c.res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return;
    if (c.req.path.endsWith('/preview')) return;

    // Reading the body consumes the stream, so every branch must rebuild the
    // response from the captured text — even when we skip injection.
    const body = await c.res.text();
    if (body.includes(CLERK_BUNDLE_MARKER) || !body.includes('</head>')) {
      c.res = rebuildHtmlResponse(body, c.res);
      return;
    }
    const tag = buildClerkBrowserScriptTag(c.env);
    c.res = rebuildHtmlResponse(body.replace('</head>', tag + '</head>'), c.res);
  });
}
