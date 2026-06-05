/**
 * Mount with `app.route('/', landing)` in src/index.ts.
 * This module does not register itself; a sibling task owns the root index.
 *
 * Composition order:
 *   StatusBar  → sticky translucent `.nav`
 *   Hero       → centred `.hero` with `.marker` headline + dual CTA
 *   HeroPanel  → live multiplayer `.demo-wrap` (browser-framed mini editor)
 *   Tagline    → social-proof `.proof` row
 *   FeatureGrid → three `.feat` cards (drag, assistant, publish)
 *   StatLine   → four `.tpl` template thumbnails
 *   Footer     → dark `.cta-card` + column-link `footer.site`
 *
 * `themeBootScript` is injected in <head> so the data-theme attribute is
 * stamped on <html> before first paint (avoids the light/dark flash).
 * `themeToggleScript` wires the `#themeToggle` button rendered by StatusBar.
 * Both live in src/ui/theme.ts (see MIGRATION.md §6).
 */
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { Footer } from './components/Footer';
import { FeatureGrid } from './components/FeatureGrid';
import { Hero } from './components/Hero';
import { HeroPanel } from './components/HeroPanel';
import { StatLine } from './components/StatLine';
import { StatusBar } from './components/StatusBar';
import { Tagline } from './components/Tagline';
import { LANDING_DEMO_SRC } from './demo-script';
import { styles } from './styles';
import {
  themeCss,
  componentsCss,
  themeFontHeadHtml,
  themeBootScript,
  themeToggleScript,
  uiStyles,
  readThemeCookie,
} from '../ui';
import type { Theme } from '../ui';
import { appOrigin, type HostConfigEnv } from '../host-config';
import { resolveClerkKeys, type ClerkKeyEnv } from '../auth/middleware';
import { clerkFrontendApiHost } from '../auth/require-auth';
import { APEX_OG_DESCRIPTION, APEX_OG_HEADLINE, APEX_OG_SITE_NAME } from '../seo/apex';
// @ts-expect-error Wrangler bundles .wasm as WebAssembly.Module via [[rules]] type=CompiledWasm
import resvgWasmModule from '@resvg/resvg-wasm/index_bg.wasm';

// The marketing page reads APP_DOMAIN to compose canonical / og:url. Typing
// the binding here lets `c.env.APP_DOMAIN` flow into `appOrigin()` without a
// cast at every call site; the parent app's `PublicEnv` is a strict superset.
// Clerk keys are needed so the page can boot clerk-js client-side and swap
// header / CTA chrome between the signed-out and signed-in variants.
type LandingEnv = {
  Bindings: HostConfigEnv & ClerkKeyEnv & { CLERK_FRONTEND_API_URL?: string };
};

const landing = new Hono<LandingEnv>();

// The marketing page's social-share title + description. The OG headline /
// description live in `src/seo/apex.ts` so the OG card text and the
// marketing meta agree byte-for-byte.
const PAGE_TITLE = `${APEX_OG_SITE_NAME} — ${APEX_OG_HEADLINE.toLowerCase()}`;
const PAGE_DESCRIPTION = APEX_OG_DESCRIPTION;

// OG image is 1200x630 — matches `OG_WIDTH` / `OG_HEIGHT` in
// `src/og-image/render.tsx`. Crawlers want explicit dimensions so they don't
// have to fetch + decode the PNG before deciding whether to render the card.
const OG_IMAGE_PATH = '/og-card.png';
const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;
const OG_IMAGE_ALT = `${APEX_OG_SITE_NAME} — ${APEX_OG_HEADLINE}`;

interface PageProps {
  theme?: Theme | undefined;
  origin: string;
  clerkPublishableKey: string;
  clerkFrontendApiHost: string;
}

// Boots clerk-js on the public landing page so the header CTA pair + hero
// "Start building" can swap to a single "Open dashboard" link when a session
// is present. The page itself stays publicly cacheable: we render the
// signed-out variant server-side and let this script flip
// html[data-signed-in] after Clerk.load() resolves. No customer upsert, no
// per-request server-side Clerk handshake.
function buildAuthDetectScript(publishableKey: string, frontendApiHost: string): string {
  return (
    `(function(){` +
    `var pk=${JSON.stringify(publishableKey)};` +
    `var s=document.createElement("script");` +
    `s.src="https://"+${JSON.stringify(frontendApiHost)}+"/npm/@clerk/clerk-js@latest/dist/clerk.browser.js";` +
    `s.crossOrigin="anonymous";s.async=true;` +
    `s.setAttribute("data-clerk-publishable-key",pk);` +
    `s.onload=function(){` +
    `if(!window.Clerk)return;` +
    `window.Clerk.load().then(function(){` +
    `if(window.Clerk.user){` +
    `document.documentElement.setAttribute("data-signed-in","");` +
    // Pre-warm /dashboard so click→paint feels instant. Same-origin
    // prefetch sends the session cookie, so the response is reusable for
    // the upcoming navigation.
    `var pf=document.createElement("link");` +
    `pf.rel="prefetch";pf.href="/dashboard";pf.as="document";` +
    `document.head.appendChild(pf);` +
    // Belt-and-braces: hover-fire a credentialed fetch so the Worker
    // isolate + Neon connection stay hot through the click.
    `var ctas=document.querySelectorAll('.auth-signed-in a[href="/dashboard"]');` +
    `for(var i=0;i<ctas.length;i++){` +
    `ctas[i].addEventListener("mouseenter",function(){` +
    `fetch("/dashboard",{credentials:"same-origin"}).catch(function(){});` +
    `},{once:true});` +
    `}` +
    `}` +
    `}).catch(function(err){` +
    `console.error("[landing] Clerk.load failed",err);` +
    `});` +
    `};` +
    `document.head.appendChild(s);` +
    `})();`
  );
}

function buildJsonLd(origin: string): string {
  // Two schema.org types in one @graph so a single <script> covers both the
  // product (SoftwareApplication) and the site identity (WebSite).
  // - WebSite supplies the site name Google uses in the sitelinks search box.
  // - SoftwareApplication tells Google this is a tool (not an article / blog)
  //   so the rich result eligibility flags are set correctly.
  const graph = [
    {
      '@type': 'WebSite',
      '@id': `${origin}/#website`,
      url: `${origin}/`,
      name: APEX_OG_SITE_NAME,
      description: PAGE_DESCRIPTION,
      inLanguage: 'en',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${origin}/#app`,
      name: APEX_OG_SITE_NAME,
      url: `${origin}/`,
      description: PAGE_DESCRIPTION,
      applicationCategory: 'WebApplication',
      operatingSystem: 'Any',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
    },
  ];
  const payload = {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
  // Escape `<` as `<` so any `</script>` substring inside a future
  // field value cannot break out of the JSON body.
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

function Page({ theme, origin, clerkPublishableKey, clerkFrontendApiHost }: PageProps) {
  const canonical = `${origin}/`;
  const ogImageUrl = `${origin}${OG_IMAGE_PATH}`;
  const authDetectScript = buildAuthDetectScript(clerkPublishableKey, clerkFrontendApiHost);
  return (
    <html lang="en" data-theme={theme === 'dark' ? 'dark' : undefined}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#FBFAF8" />
        <meta name="color-scheme" content="light dark" />
        <title>{PAGE_TITLE}</title>
        <meta name="description" content={PAGE_DESCRIPTION} />
        <link rel="canonical" href={canonical} />
        <link rel="icon" href="/favicon.ico" type="image/svg+xml" />
        {/* Open Graph — Facebook / LinkedIn / Slack / Discord unfurl. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={APEX_OG_SITE_NAME} />
        <meta property="og:locale" content="en_US" />
        <meta property="og:title" content={PAGE_TITLE} />
        <meta property="og:description" content={PAGE_DESCRIPTION} />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={ogImageUrl} />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
        <meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />
        <meta property="og:image:alt" content={OG_IMAGE_ALT} />
        {/* Twitter Card — also consumed by Mastodon, Bluesky's tcard fallback. */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={PAGE_TITLE} />
        <meta name="twitter:description" content={PAGE_DESCRIPTION} />
        <meta name="twitter:image" content={ogImageUrl} />
        <meta name="twitter:image:alt" content={OG_IMAGE_ALT} />
        <script type="application/ld+json">{raw(buildJsonLd(origin))}</script>
        <script>{raw(themeBootScript)}</script>
        {raw(themeFontHeadHtml)}
        <style>{raw(themeCss + '\n' + componentsCss + '\n' + uiStyles + '\n' + styles)}</style>
      </head>
      <body>
        <StatusBar />
        <main>
          <Hero />
          <HeroPanel />
          <Tagline />
          <FeatureGrid />
          <StatLine />
          <Footer />
        </main>
        <script>{raw(themeToggleScript)}</script>
        <script>{raw(LANDING_DEMO_SRC)}</script>
        <script>{raw(authDetectScript)}</script>
      </body>
    </html>
  );
}

landing.get('/', (c) => {
  const { publishableKey } = resolveClerkKeys(c.env);
  const frontendApiHost = clerkFrontendApiHost(publishableKey, c.env.CLERK_FRONTEND_API_URL);
  return c.html(
    <Page
      theme={readThemeCookie(c)}
      origin={appOrigin(c.env)}
      clerkPublishableKey={publishableKey}
      clerkFrontendApiHost={frontendApiHost}
    />,
  );
});

// Brand favicon — served regardless of which landing path is hit. Kept here
// (next to the rest of the brand surface) rather than in src/index.ts so
// that asset and entry concerns don't entangle. The mark mirrors the
// `oc-logo` SVG: open canvas frame + ring + red marker bars.
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#FBFAF8"/><rect x="14" y="9" width="40" height="46" stroke="#1A1917" stroke-width="2.8" fill="none"/><circle cx="34" cy="32" r="11" stroke="#1A1917" stroke-width="7" fill="none"/><rect x="40" y="19" width="21" height="3.6" rx="1.8" fill="#E84D4A"/><rect x="6" y="43" width="21" height="3.6" rx="1.8" fill="#E84D4A"/></svg>`;

landing.get('/favicon.ico', (c) =>
  c.body(FAVICON_SVG, 200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'public, max-age=86400',
  }),
);

// Brand mark PNG endpoint for transactional emails. The shared brandShell
// (src/email/templates/shell.ts) references this absolute URL via <img> tag
// so Outlook / older Gmail clients that strip inline SVG still render the
// logo. PNG is rasterised once per isolate via resvg-wasm and cached
// aggressively. The source SVG omits the rounded-rect background so the
// mark sits flush on the email card's paper background.
const BRAND_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 64 64"><rect x="14" y="9" width="40" height="46" stroke="#1A1917" stroke-width="2.8" fill="none"/><circle cx="34" cy="32" r="11" stroke="#1A1917" stroke-width="7" fill="none"/><rect x="40" y="19" width="21" height="3.6" rx="1.8" fill="#E84D4A"/><rect x="6" y="43" width="21" height="3.6" rx="1.8" fill="#E84D4A"/></svg>`;
let brandMarkPngBytes: Uint8Array | null = null;
let brandMarkPromise: Promise<Uint8Array> | null = null;

landing.get('/brand-mark.png', async () => {
  if (brandMarkPngBytes === null) {
    if (brandMarkPromise === null) {
      const { rasteriseSvgToPng } = await import('../og-image/rasterise.js');
      brandMarkPromise = rasteriseSvgToPng(BRAND_MARK_SVG, {
        wasmModule: resvgWasmModule as WebAssembly.Module,
      }).then((r) => r.bytes);
    }
    brandMarkPngBytes = await brandMarkPromise;
  }
  return new Response(brandMarkPngBytes, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
});

// BIMI logo (RFC 9419 SVG Tiny 1.2 Portable/Secure profile). Referenced by
// the `default._bimi.opencanvas.aayushman.dev` TXT record so Apple Mail /
// Fastmail / (with VMC) Gmail render this as the sender avatar in recipient
// inboxes. See docs/email-sender-icon.md for the DNS + VMC steps.
//
// Constraints baked in (validate at https://bimigroup.org/bimi-svg-validator/):
//   - Root has `version="1.2"` and `baseProfile="tiny-ps"`
//   - `<title>` is the first child of <svg>
//   - Square viewBox (1:1 aspect ratio)
//   - No xmlns:xlink, no <script>/<style>/<image>/<a>/<foreignObject>, no
//     animations, no external references, no embedded fonts
//   - All meaningful marks fit inside a centred safe-zone radius so Gmail's
//     circular crop does not clip the brand
const BIMI_SVG = `<?xml version="1.0" encoding="UTF-8"?><svg version="1.2" baseProfile="tiny-ps" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>Open Canvas</title><rect width="64" height="64" fill="#FBFAF8"/><rect x="16" y="14" width="32" height="36" stroke="#1A1917" stroke-width="2.6" fill="none"/><circle cx="32" cy="32" r="9" stroke="#1A1917" stroke-width="5.5" fill="none"/><rect x="38" y="20" width="16" height="3" rx="1.5" fill="#E84D4A"/><rect x="10" y="41" width="16" height="3" rx="1.5" fill="#E84D4A"/></svg>`;

landing.get('/brand/bimi.svg', (c) =>
  c.body(BIMI_SVG, 200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'public, max-age=86400',
  }),
);

export default landing;
