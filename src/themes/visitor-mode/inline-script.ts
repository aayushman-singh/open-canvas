// src/themes/visitor-mode/inline-script.ts
//
// Wave 3 #20 — The early `<script>` injected at the top of `<head>` on every
// Published Site that has `darkModeEnabled === true`. Its job is to stamp
// `data-mode="light"` or `data-mode="dark"` on `<html>` BEFORE first paint
// so the visitor never sees a Flash Of Unstyled Content (FOUC) when the
// system colour scheme disagrees with the server-rendered default.
//
// Resolution order (mirrored by the toggle script in `toggle-element.ts`):
//
//   1. Cookie `__rev01_cs` — explicit visitor choice from a previous toggle.
//      Highest priority because it is the visitor's most recent action.
//   2. `prefers-color-scheme: dark` media query — system default. Honoured
//      when no cookie has been set.
//   3. Otherwise, `light` — the implicit default for a fresh visitor on a
//      system with no preference (or on a browser that does not report one).
//
// Constraints (per plan):
//   - ≤200 characters total — the script lives inline in `<head>` and runs
//     synchronously, so size matters.
//   - No semicolons inside string literals (they would break the size budget
//     by adding minifier noise — we keep the script hand-tuned).
//   - Pure side effect on `document.documentElement` — no globals, no IIFE
//     leak, no listeners (the toggle script registers those).
//
// Cookie shape: `__rev01_cs=light|dark; path=/; max-age=31536000; SameSite=Lax`.
// We do NOT set `Secure` so local development over http works without
// special-casing. The cookie is read by JS (so `HttpOnly` is not present).

/**
 * Get the inline mode-setter script as a string. Drop this into a
 * `<script>...</script>` tag at the very top of `<head>` (before the
 * `<style>` block) so the attribute lands on `<html>` before the visitor's
 * paint engine reads token values.
 *
 * The string is deterministic (no template variables today) — callers may
 * cache it once at module load. Returned without surrounding `<script>` tags
 * so the caller can choose `type="module"` / `nomodule` policy if desired.
 */
export function getModeSetterScript(): string {
  // Tight one-liner. Reads the cookie via a regex (avoids the JSON-cost of
  // split-and-find), falls back to `matchMedia`, and stamps `data-mode` on
  // `<html>`. The IIFE keeps the temp vars out of the global scope. ≤200
  // chars as the plan requires.
  return MODE_SETTER_SCRIPT;
}

// Tracked as a module-level constant so the smoke can size-check it without
// having to call the function (and so a future caller that wants the literal
// can `import { MODE_SETTER_SCRIPT } from ...`).
export const MODE_SETTER_SCRIPT: string =
  `(function(d){var c=d.cookie.match(/__rev01_cs=(light|dark)/),m=c?c[1]:matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';d.documentElement.setAttribute('data-mode',m)})(document)`;
