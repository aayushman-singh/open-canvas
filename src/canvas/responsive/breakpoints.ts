// src/canvas/responsive/breakpoints.ts
//
// Single source of truth for the responsive subsystem's viewport breakpoints.
// Read by `responsive/css.ts` for the snapshot-level `<style>` block and by
// per-element-type collapse helpers (e.g. `elements/table-responsive.ts`) so
// every layer fires together at the same viewport widths. Changing the
// breakpoint in one place must move every layer or visitors see staggered
// reflows.

export const TABLET_MAX_PX = 1023;
export const PHONE_MAX_PX = 767;
