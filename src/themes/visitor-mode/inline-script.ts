// src/themes/visitor-mode/inline-script.ts
//
// The early `<script>` injected at the top of `<head>` on every Published
// Site that has `darkModeEnabled === true`. Its job is to stamp
// `data-mode="light"` or `data-mode="dark"` on `<html>` BEFORE first paint
// so the visitor never sees a Flash Of Unstyled Content (FOUC) when the
// system colour scheme disagrees with the server-rendered default.
//
// Resolution order (mirrored by the toggle script in `toggle-element.ts`):
//
//   1. Cookie named `cookieName.colorScheme(env)` (ADR 0017) — explicit
//      visitor choice from a previous toggle. Highest priority because it
//      is the visitor's most recent action.
//   2. `prefers-color-scheme: dark` media query — system default. Honoured
//      when no cookie has been set.
//   3. Otherwise, `light` — the implicit default for a fresh visitor on a
//      system with no preference (or on a browser that does not report one).
//
// Constraints:
//   - Tight one-liner targeted at ≤220 characters; the script lives inline
//     in `<head>` and runs synchronously, so size matters. The budget
//     absorbs the cookie name variability under ADR 0017 (a fork can pick
//     a longer prefix; the smoke pins the contract against a test prefix).
//   - No semicolons inside string literals (they would break the size budget
//     by adding minifier noise — we keep the script hand-tuned).
//   - Pure side effect on `document.documentElement` — no globals, no IIFE
//     leak, no listeners (the toggle script registers those).
//
// Cookie shape: `${cookieName.colorScheme(env)}=light|dark; path=/;
// max-age=31536000; SameSite=Lax`. We do NOT set `Secure` so local
// development over http works without special-casing. The cookie is read
// by JS (so `HttpOnly` is not present).

import { cookieName, type HostConfigEnv } from '../../host-config.js';

/**
 * Get the inline mode-setter script as a string for the given env. Drop
 * this into a `<script>...</script>` tag at the very top of `<head>`
 * (before the `<style>` block) so the attribute lands on `<html>` before
 * the visitor's paint engine reads token values.
 *
 * The string is deterministic for a given env (the cookie name is the
 * only env-derived input). The cookie name is validated upstream
 * (`cookieNamePrefix` regex `[A-Za-z0-9_-]+`) and contains no regex
 * metacharacters, so it is safe to interpolate into the regex literal
 * below without escaping.
 */
export function getModeSetterScript(env: HostConfigEnv): string {
  const name = cookieName.colorScheme(env);
  return `(function(d){var c=d.cookie.match(/${name}=(light|dark)/),m=c?c[1]:matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';d.documentElement.setAttribute('data-mode',m)})(document)`;
}
