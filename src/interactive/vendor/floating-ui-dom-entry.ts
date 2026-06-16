import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';

declare global {
  // Bundled into the visitor runtime by scripts/sync-interactive-vendors.ts.
  // Overlay placement reads this stable Open Canvas adapter shape rather than
  // coupling saved overlay state to Floating UI symbols.
  var __opencanvasFloating: {
    autoUpdate: typeof autoUpdate;
    computePosition: typeof computePosition;
    flip: typeof flip;
    offset: typeof offset;
    shift: typeof shift;
  };
}

globalThis.__opencanvasFloating = { autoUpdate, computePosition, flip, offset, shift };
