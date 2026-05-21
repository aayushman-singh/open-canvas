/**
 * Mount with `app.route('/', landing)` in src/index.ts.
 * This module does not register itself; a sibling task owns the root index.
 */
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { Footer } from './components/Footer';
import { FeatureGrid } from './components/FeatureGrid';
import { Hero } from './components/Hero';
import { LiveScript } from './components/LiveScript';
import { StatLine } from './components/StatLine';
import { StatusBar } from './components/StatusBar';
import { Tagline } from './components/Tagline';
import { styles } from './styles';

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
        <style>{raw(styles)}</style>
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
        <LiveScript />
      </body>
    </html>
  );
}

landing.get('/', (c) => c.html(<Page />));

export default landing;
