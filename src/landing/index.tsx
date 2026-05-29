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

const landing = new Hono();

function Page({ theme }: { theme?: Theme | undefined }) {
  return (
    <html lang="en" data-theme={theme === 'dark' ? 'dark' : undefined}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#FBFAF8" />
        <meta name="color-scheme" content="light dark" />
        <title>Open Canvas — build your site, together</title>
        <meta
          name="description"
          content="Drag things where you want them. Ask the built-in assistant for a hand. Hit publish and it's live — no code, no plugins, no headaches."
        />
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
      </body>
    </html>
  );
}

landing.get('/', (c) => c.html(<Page theme={readThemeCookie(c)} />));

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

export default landing;
