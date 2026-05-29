# ADR 0017 — Cookie name prefix is environment-driven

**Status:** Proposed
**Date:** 2026-05-29
**Author:** Aayushman Singh
**Drives:** OSS-fork rebranding for cookie names. Follows the same shape as [ADR 0013](0013-host-config-from-environment.md); flagged as a follow-up in 0013's out-of-scope.

## Context

The cookies rev01 sets carry a `__rev01_` prefix in every name: `__rev01_edit`, `__rev01_unlock`, and the Clerk-issued cookies under the same scheme. An OSS fork deploying under its own brand (`mysite.io`) sees `__rev01_edit` in its visitors' DevTools — the prefix is not a security boundary, but it is a brand leak. The fork either accepts the leak or hand-edits every cookie-naming call site.

The pattern this ADR proposes is identical in shape to [ADR 0013](0013-host-config-from-environment.md)'s `APP_DOMAIN` decision: one env var, one helper module, every consumer reads from the helper, boot fails loud on missing/invalid value.

## Decisions

1. **The cookie name prefix is one runtime env var, `COOKIE_NAME_PREFIX`, consumed through one helper. Every `set-cookie`-issuing call site reads from it.** The helper exposes derived names — `cookieName.edit()`, `cookieName.unlock()`, etc. — rather than the raw prefix, so consumers cannot accidentally concatenate the prefix with a stray suffix.

   **Why:** the OSS-fork promise (set one env, deploy) extends naturally to cookie naming. The pattern is the same as the apex-host decision; deviating from it would split the host-config story into two non-parallel modules for no benefit. Helper-exposed derived names — rather than raw `${PREFIX}edit` interpolation — guard against the drift where one consumer says `${PREFIX}edit` and another says `${PREFIX}_edit` and the prefix change quietly disagrees with itself.

2. **Boot fails loud if `COOKIE_NAME_PREFIX` is unset, empty, or contains characters invalid for a cookie name** (per RFC 6265: no whitespace, no `=`, no control characters, etc.).

   **Why:** consistent with [ADR 0013](0013-host-config-from-environment.md) decision 2 and the no-fallback rule. A default would silently produce cookies named `_edit` or `__edit` and the operator would only notice when a user reports "I can't sign in" — exactly the failure class env-driven config exists to eliminate.

## Out of scope

- The cookie *values* — those are computed elsewhere (signed tokens, opaque strings) and not affected by this ADR.
- The cookie *domain* — that derives from `APP_DOMAIN` per [ADR 0013](0013-host-config-from-environment.md) decision 5.
- Clerk's own cookie names — Clerk's SDK controls those; this ADR cannot change them.
- Whether a fork should rebrand cookies at all — that's the fork's call. This ADR makes it possible; it does not require it.

## Consequences

**Positive:**
- A fork sets `COOKIE_NAME_PREFIX=__mysite_` and every cookie the Worker emits respects it. No source edits.
- Cookie-naming concentrates in one helper; "where do we set the unlock cookie's name?" has one answer.
- Boot-time validation surfaces misconfig immediately.

**Negative:**
- One more env var operators must set. The canonical value (`__rev01_`) ships in `.dev.vars.example` per [ADR 0013](0013-host-config-from-environment.md)'s follow-up; the friction is initial setup, not ongoing.
- Existing cookies on visitors' browsers (`__rev01_edit` etc.) become orphans on a fork that picks a different prefix. Orphans are harmless (browsers eventually expire them) but worth noting for forks that migrate from a canonical-rev01 deploy.

## Follow-ups

- Ship `cookieName` helpers in the same module as the host helpers from [ADR 0013](0013-host-config-from-environment.md) (`src/host.ts` or wherever 0013 lands). Same env-resolution lifecycle.
- Add `COOKIE_NAME_PREFIX=__rev01_` to `.dev.vars.example` and the README's local-dev section.
- Migrate `src/auth/edit-token.ts`, `src/auth/sign-out-route.ts`, `src/password/cookie.ts`, `src/password/unlock-route.ts`, and any other cookie-issuing site to the helper.
- Add a smoke that greps the production source for `__rev01_` literals (excluding smokes/fixtures/comments per [ADR 0013](0013-host-config-from-environment.md) decision 8) and fails on regressions.
