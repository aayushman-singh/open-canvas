/**
 * Mount with `app.route('/', landing)` in src/index.ts.
 * This module does not register itself; a sibling task owns the root index.
 */
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { Footer } from './components/Footer';
import { FeatureGrid } from './components/FeatureGrid';
import { Hero } from './components/Hero';
import { StatLine } from './components/StatLine';
import { StatusBar } from './components/StatusBar';
import { Tagline } from './components/Tagline';
import { LANDING_DEMO_SRC } from './demo-script';
import { styles } from './styles';
import { uiStyles } from '../ui';

const landing = new Hono();

function Page() {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0a0e1a" />
        <meta name="color-scheme" content="dark" />
        <title>rev01 — multiplayer site builder</title>
        <meta
          name="description"
          content="rev01 is a multiplayer, AI-native site builder. One document model, one CRDT, one Worker — and an agent that edits alongside you."
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
        />
        <style>{raw(uiStyles + '\n' + styles)}</style>
      </head>
      <body>
        <StatusBar />
        <main>
          <Hero />
          <Tagline />
          <FeatureGrid />
          <StatLine />
          <Footer />
        </main>
        <script>{raw(LANDING_DEMO_SRC)}</script>
      </body>
    </html>
  );
}

landing.get('/', (c) => c.html(<Page />));

// Brand favicon — served regardless of which landing path is hit. Kept here
// (next to the rest of the brand surface) rather than in src/index.ts so
// that asset and entry concerns don't entangle.
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0d1117"/><text x="4" y="24" font-family="monospace" font-size="22" font-weight="700" fill="#22d3ee">r1</text></svg>`;

landing.get('/favicon.ico', (c) =>
  c.body(FAVICON_SVG, 200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'public, max-age=86400',
  }),
);

export default landing;
