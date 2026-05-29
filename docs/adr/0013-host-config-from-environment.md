# ADR 0013 — The apex host is environment-driven; production code reads it through one helper

**Status:** Accepted
**Date:** 2026-05-29
**Author:** Aayushman Singh
**Drives:** Theme D of the rev01 OSS code review (handoff-rev01-batch-27 §"Theme D"); promoted in urgency by the 2026-05-28 verification pass (`C:/Users/Aayushman/AppData/Local/Temp/claude/verification-pass-2026-05-28.md` §4) which found 36 files / 98 occurrences of the hardcoded apex, not the 10+ originally claimed.
**Accepted-context:** Implemented in the same pass as the rev01 → opencanvas apex move (2026-05-29). Acceptance came alongside the move because the move would otherwise have required 36 file-edits per the failure mode this ADR names.

## Context

rev01 is OSS. A developer who forks the repository and wants to deploy it under their own domain — say `mysite.io` — expects to set their domain in one place, run `wrangler deploy`, and have the result work. They do not expect to grep the source tree for `rev01.aayushman.dev` and hand-edit ~25 production TypeScript files (plus comments, plus dashboards, plus emails, plus smokes) to make the fork serve under their own brand.

Today, the literal `rev01.aayushman.dev` is embedded in **36 files / 98 occurrences** across the codebase. Roughly three behaviour classes consume it:

1. **Auth allowlist.** `AUTHORIZED_PARTIES` in `src/auth/middleware.ts:46` lists every origin Clerk should treat as "us." It includes `https://rev01.aayushman.dev` alongside the localhost dev ports.
2. **Cookie scope.** `REV01_COOKIE_DOMAIN = 'rev01.aayushman.dev'` (`src/auth/edit-token.ts:62`), `SHARED_AUTH_COOKIE_DOMAIN = 'rev01.aayushman.dev'` (`src/auth/sign-out-route.ts:43`), and `__rev01_unlock` cookies in `src/password/cookie.ts` all assume cross-subdomain readability under the apex.
3. **Public-host subdomain detection.** `PUBLIC_HOST_SUFFIX = '.rev01.aayushman.dev'` appears in five files (`src/auth/middleware.ts:53`, `src/routes/public.ts:91`, `src/password/unlock-route.ts:65`, `src/search/route.ts:64`, plus `src/seo/sitemap/route.ts` documentation) as the way to recognise "this request hit a published-site subdomain, not the app." Five independent declarations of the same constant.

Plus single-purpose uses: `src/auth/invite-redirect-route.ts:50` interpolates the apex into invite redirect URLs; `src/email/send.ts` and `src/email/templates/invite.ts` reference it in outbound email; `src/fonts/face-emit.ts` includes it in `@font-face` `src:` URLs; dashboards (`src/routes/dashboard/index.tsx`, `domains.tsx`, `templates.tsx`, `site-settings.tsx`, `page-settings.tsx`) show it as a published-URL preview.

The existing `DEV_PUBLIC_HOST` env var (resolved by `resolveDevPublicOrigin` in `src/auth/middleware.ts:102`) is the precedent: dev overrides for the local public origin are already env-driven, and that pattern fails loud (`throw` on invalid origin) rather than silently substituting. The production apex never followed suit.

The Owner-facing failure mode the current state produces is not "rev01 is broken on rev01.aayushman.dev." It is "a contributor forks rev01, edits the few obvious files, deploys, and watches half the auth flow silently still expect rev01.aayushman.dev." Cookies don't set on the right domain; Clerk rejects requests because the origin isn't in `AUTHORIZED_PARTIES`; published-site subdomain detection returns null for every host; the editor's published-URL preview shows the wrong domain. Each of these is a separate file the contributor has to find.

## Decisions

1. **The apex host is one runtime environment variable, `APP_DOMAIN`. Every production consumer reads it through a single helper module.**

   **Why:** the OSS-fork promise is "set your domain in one place and deploy." That promise is only true if there is, in fact, one place. A scattered hardcode is the failure mode this ADR is named for. A single env var anchors the value; a single helper anchors the *consumption* — so consumers cannot re-derive partial versions and drift. The helper exposes both the bare domain (`mysite.io`) and the origin (`https://mysite.io`) since cookie scope wants the former and CORS/allowlists want the latter; both come from the same source.

   This would be wrong if forks legitimately wanted to compile-bake the host (for a marginally smaller bundle or a single-tenant SaaS deployment that never moves). They do not — bundle size is not the constraint here, and the SaaS-only case can pin `APP_DOMAIN` in `wrangler.toml`'s `[vars]` block and get the same result as compile-baking, without the source-edit cost.

2. **Boot fails loud if `APP_DOMAIN` is unset, empty, or not a parseable host.**

   **Why:** CLAUDE.md's no-fallback rule. A worker that boots with a missing host and silently substitutes `'localhost'` or `''` produces exactly the failure mode this ADR exists to prevent — auth flows that *partly* work because some consumers got the fallback and others didn't. The helper validates at first read; the first request that needs the helper throws if env is bad; the operator sees a clear failure in `wrangler tail` instead of an Owner reporting "I can't sign in." The existing `DEV_PUBLIC_HOST` validator (`resolveDevPublicOrigin`) is the precedent — same shape, same boot-time strictness.

3. **`AUTHORIZED_PARTIES` is fully env-driven as a CSV (`AUTHORIZED_PARTIES`). Every fork sets every accepted origin explicitly; the helper parses the CSV at boot.**

   **Why:** consistency with decision 1's "single source of truth = env" principle. A hardcoded local-dev set looks reasonable when every fork uses wrangler defaults, but the moment a fork runs `wrangler dev` on a non-default port, behind a proxy, or under a custom local DNS (`rev01.local:3000`), the hidden hardcoded set silently rejects the fork's own dev requests — a surprise the operator has to trace through middleware code to find. Forcing every fork to enumerate its accepted origins makes the dev story visible at config time, not at debug time. The canonical rev01 dev value (`http://localhost:8787,http://localhost:8788,http://127.0.0.1:8787,http://127.0.0.1:8788,https://rev01.aayushman.dev`) ships in `.dev.vars.example` and is the immediate copy-paste for any fork that has not customized its dev environment.

   This would be wrong only if forks routinely fail to set the env var and would prefer a silent default to a loud failure — but decision 2 already commits to loud failure, and the same logic applies here.

4. **`PUBLIC_HOST_SUFFIX` is derived from `APP_DOMAIN` as `.${APP_DOMAIN}`, exported once by the helper, imported by the five current consumers.**

   **Why:** rev01's published-site subdomain pattern is "every site gets a subdomain under the apex." That coupling is structural — if the apex moves, the suffix moves with it. The five independent declarations today are the same value spelled five times; the moment one of them drifts (a fork remembers to update four, forgets the fifth) some published-site requests silently miss subdomain detection and fall through to a different route. One derivation, five imports, zero drift surface.

5. **Cookie-domain values (`REV01_COOKIE_DOMAIN`, `SHARED_AUTH_COOKIE_DOMAIN`, `__rev01_unlock` scope) are derived from `APP_DOMAIN` by the same helper.**

   **Why:** cookie scope under the apex is what makes the cross-subdomain edit-token + sign-out story work. Splitting cookie config from public-host config would invite the failure mode "fork updates one, forgets the other, edit cookies don't reach published-site subdomains." Same source, same helper, same import.

6. **`wrangler.toml` route patterns stay hardcoded. The fork-edit cost there is acknowledged and documented, not eliminated.**

   **Why:** wrangler reads its config at deploy time, not at runtime; it does not consume the worker's `env`. Substituting `wrangler.toml` from a template at build time is possible but introduces a build-time templating tool that does not exist today, and the fork-edit cost in `wrangler.toml` is two lines (one apex pattern, one wildcard pattern) — substantial reduction from today's 25-file source-edit cost without it. Adding the build templater is a follow-up if the two-line edit ever becomes painful; this ADR does not preemptively introduce the tool.

7. **Smokes parameterize host expectations through the same helper. A smoke sets `env.APP_DOMAIN` to a test value and asserts the helper resolves to that value; it does not assert against the literal `rev01.aayushman.dev`.**

   **Why:** the literal in smokes today is ground truth — the smoke checks the *deployment*, not the *logic*. After this ADR, the literal is one possible binding among many; tests that pin it are testing nothing useful (any other binding would fail them while behaving correctly). Smokes that test "the cookie scope matches the public host suffix's parent" are testing the contract, not the brand. The rewrite is mechanical: replace literal expectations with `expect(host).toBe(testEnv.APP_DOMAIN)`.

8. **Comments referencing the apex sweep to abstract phrasing ("the apex host", "the configured apex", "the published-site subdomain parent"), not the literal `rev01.aayushman.dev`.**

   **Why:** a contributor working on a `mysite.io` fork who reads `// scoped to .rev01.aayushman.dev so subdomains can read it` will pause and wonder if there is a fork-specific bug — the comment looks like it documents a behaviour their deployment is *not* exhibiting. Abstract phrasing stays accurate across forks without that pause. The sweep is mechanical, once-only, and preserves the semantic content of the comment. The alternative — `// scoped to .${APP_DOMAIN}` — mixes code syntax into prose and reads worse than either pure prose or pure code. Abstract noun phrases are the cleanest of the three.

   This would be wrong only if a comment legitimately needs to call out the canonical rev01 deployment (e.g. a security note about a specific incident on `rev01.aayushman.dev`); such comments stay literal and the author flags them explicitly as canonical-deployment-specific.

## Out of scope

- `wrangler.toml` route patterns (decision 6 acknowledges and defers).
- Custom-domain support — already owned by ADR-0005.
- Email "from" addresses (`hello@rev01.aayushman.dev`-type literals in `src/email/`) — same problem class but the change-shape is different (every provider has its own validated-sender rules) and the fork story is different (forks need their own Resend account anyway).
- Cookie name prefixes (`__rev01_edit`, `__rev01_unlock`, etc.). Forks that rebrand the cookies need a separate ADR; the prefix is currently a brand string, not a configuration knob. Mechanically similar but conceptually a different decision.
- `SUBDOMAIN_RE` consolidation (`src/routes/api/sites.ts:24` and the related `SITE_ID_RE` five-place drift surfaced in the verification pass §5). That is about the *shape* of valid subdomains, not the apex; separate cleanup.
- Brand strings in dashboard UI (logo, footer text, marketing copy). Visual rebranding is a different concern with different stakeholders.
- Fixtures and seed data (`src/canvas/fixtures/home.json`, `apogee-showcase.json`) that reference the apex inside JSON content. Those are data, not behaviour; a fork that imports them gets the canonical content as a starting point and edits it.
- Build-time `wrangler.toml` templating — flagged as a follow-up if the two-line edit becomes painful.

## Consequences

**Positive:**

- An OSS fork sets `APP_DOMAIN`, edits two lines in `wrangler.toml`, and deploys. The ~25-file source-edit cost goes to zero.
- The question "where does the apex appear in production code?" has one answer (the helper). Audit, refactor, and rebrand all collapse to a single location.
- Boot-time validation surfaces misconfiguration immediately rather than at a Clerk-rejected request three hours later.
- The five `PUBLIC_HOST_SUFFIX` redundant declarations collapse to one source + five imports; the same pattern catches future copies.
- The helper becomes the natural home for related boot-time host resolution (origin parsing, validation, dev-vs-prod selection — `DEV_PUBLIC_HOST` already fits this shape and would migrate into the same module).

**Negative:**

- `wrangler dev` requires `APP_DOMAIN` set in `.dev.vars` or the local environment, or the worker won't boot. Today it just works because the value is baked in. New contributors hit this on first run; the README and `.dev.vars.example` have to call it out.
- ~25 production files get touched in the migration. The change is mechanical but spans auth, routes, dashboards, email, fonts, search, seo, password, custom-domain, templates, and index.ts. Coordination with the parallel-agent flow matters — running this as one PR rather than per-file avoids partial states where some consumers have migrated and others have not (which would reproduce the exact failure mode this ADR prevents).
- Smokes that pin the literal need rewriting. Roughly six smoke files reference the apex; each becomes a small env-setup + assertion-against-helper rewrite.
- `wrangler.toml` still requires fork-time edits. The OSS-fork promise becomes "set one env var, edit two lines in wrangler.toml" rather than "set one env var, done." The reduction is large but not total.
- The helper becomes a load-bearing boot dependency. A bug in it disables every request that consults `APP_DOMAIN` — which after migration is most of the auth surface. The validation in decision 2 catches misconfig; bugs in the helper itself need a focused smoke.

## Follow-ups

- Ship the helper module (`src/host.ts` or `src/config/host.ts`) with: `appDomain()`, `appOrigin()`, `publicHostSuffix()`, `cookieDomain()`, `authorizedParties()`, plus boot-time validation. Pull `resolveDevPublicOrigin` into the same module so all host-shaped env-resolution lives together.
- Migrate the ~25 production files in one coordinated PR (or one tight series, coordinated with active parallel agents per the `feedback_handoffs_acted_on_between_batches` memory). Order: helper first, then auth/, then routes/, then dashboards, then email/fonts/search/seo/password/custom-domain/templates.
- Rewrite the six smokes that pin the literal (`src/auth/clerk-dev-rebuild.smoke.ts`, `src/auth/sign-out-route.smoke.ts`, `src/auth/on-site-edit-security.smoke.ts`, `src/canvas/smoke.ts`, `src/custom-domain/smoke.ts`, `src/password/smoke.ts`, `src/review-smoke.ts`). Each gets a test-env `APP_DOMAIN` and asserts against the helper.
- Add `APP_DOMAIN` and `AUTHORIZED_PARTIES` to `.dev.vars.example` (creating the file if it does not exist) and document the requirement in the README's "Local development" section. Ship the canonical rev01 dev values (`APP_DOMAIN=rev01.aayushman.dev`, `AUTHORIZED_PARTIES=http://localhost:8787,http://localhost:8788,http://127.0.0.1:8787,http://127.0.0.1:8788,https://rev01.aayushman.dev`) as the immediate copy-paste; forks edit from there.
- Sweep apex-literal comments across the codebase to abstract phrasing per decision 8. The sweep is its own small PR — mechanical, parallel-agent-friendly, no behavioural change.
- Add a smoke that asserts `Grep('rev01\.aayushman\.dev', src/, exclude:**/*.smoke.ts, exclude:**/fixtures/**)` returns zero matches outside designated comment locations. The smoke catches regressions where a contributor reintroduces the literal in production code.
- Open a separate ADR if the two-line `wrangler.toml` edit becomes a meaningful fork-friction signal — build-time templating is a real option, just not one this ADR pays for upfront.
- Open a separate ADR for cookie name prefixes if forks want to rebrand `__rev01_*` cookies. Same problem class, different decision shape.
- Open a separate ADR for email-sender configuration if the `src/email/` literals become a fork-blocker.
