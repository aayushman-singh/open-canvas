import { waapi } from 'animejs';

declare global {
  // Bundled into the visitor runtime by scripts/sync-interactive-vendors.ts.
  // The public runtime reads this stable Open Canvas adapter shape rather than
  // coupling saved site state to Anime.js symbols.
  var __opencanvasAnime: { waapi: typeof waapi };
}

globalThis.__opencanvasAnime = { waapi };
