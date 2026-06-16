import lottie from 'lottie-web/build/player/lottie_light';

declare global {
  // Bundled into the visitor runtime by scripts/sync-interactive-vendors.ts.
  // Rich Motion Asset playback reads this stable Open Canvas adapter shape
  // rather than coupling saved asset state to lottie-web symbols.
  var __opencanvasLottie: {
    loadAnimation: typeof lottie.loadAnimation;
  };
}

globalThis.__opencanvasLottie = { loadAnimation: lottie.loadAnimation.bind(lottie) };
