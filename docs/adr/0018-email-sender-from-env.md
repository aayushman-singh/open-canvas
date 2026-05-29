# ADR 0018 — Email sender address is environment-driven

**Status:** Accepted
**Date:** 2026-05-29
**Author:** Aayushman Singh
**Drives:** OSS-fork rebranding for outbound email. Follows the same shape as [ADR 0013](0013-host-config-from-environment.md); flagged as a follow-up in 0013's out-of-scope.
**Accepted-context:** Accepted alongside ADR 0013 in the rev01 → opencanvas apex move (2026-05-29). The sender domain has to move with the apex; deferring this ADR would have left the email-sender hardcode as the lone fork-blocker after the host migration.

## Context

Every email rev01 sends — invite emails, password resets, transactional notifications — carries an outbound `From:` header. Today the from-address is the literal `hello@rev01.aayushman.dev` (or similar) hardcoded inside `src/email/send.ts` and the per-template builders under `src/email/templates/`. An OSS fork deploying under its own brand cannot send email under that address — Resend (the existing provider per `RESEND_API_KEY` in `wrangler.toml:85`) enforces per-account verified-sender rules, and the fork's account has not verified `rev01.aayushman.dev`.

Today the fork's options are (a) hand-edit every `From:` literal, or (b) ship broken email until they do. The pattern this ADR proposes is mechanically identical to [ADR 0013](0013-host-config-from-environment.md)'s host config and [ADR 0017](0017-cookie-name-prefix-from-env.md)'s cookie prefix: env var + helper + boot validation.

## Decisions

1. **The outbound email sender is one runtime env var, `EMAIL_FROM`, consumed through one helper. Every email-sending call site reads from it; no template builder hardcodes a `From:` literal.** The helper exposes a single `emailFrom()` accessor returning the validated value.

   **Why:** the OSS-fork promise extends to email branding for the same reason it extended to cookies — a verified-sender check at the provider boundary makes the from-address operationally load-bearing, not just cosmetic. Centralising in one helper means the verified-sender story is one configuration knob; today it is many file edits.

2. **Boot fails loud if `EMAIL_FROM` is unset, empty, or fails RFC 5322 syntactic validation** (must parse as `local@domain` with a non-empty domain that itself parses as a hostname).

   **Why:** same logic as [ADR 0013](0013-host-config-from-environment.md) decision 2 and [ADR 0017](0017-cookie-name-prefix-from-env.md) decision 2. A misconfigured sender doesn't fail in a way the operator sees in `wrangler tail` — it fails when an end user expects an email and never receives it (Resend returns a 4xx the Worker may or may not surface). Boot-time validation closes that gap.

   The syntactic check does *not* attempt to validate that the address is verified at Resend; that's an out-of-band concern between the operator and the provider. Syntactic validity is what the Worker can check.

## Out of scope

- Email *body* content (template wording, branding within email bodies). Templates may still reference the canonical brand in prose; this ADR is about the `From:` header only.
- Reply-to addresses, BCC lists, DKIM/SPF/DMARC configuration — those are operator concerns at the provider, not Worker config.
- Provider choice. Resend is the current provider; switching to SES / Postmark / Mailgun is a different decision.
- The `RESEND_API_KEY` itself — already env-driven via Wrangler secrets.

## Consequences

**Positive:**
- A fork sets `EMAIL_FROM=hello@mysite.io` (after verifying the address at Resend) and every email respects it. No source edits.
- Centralisation makes "where does our outbound `From:` live?" a one-helper answer.
- Boot-time syntactic validation catches typos before the first send attempt.

**Negative:**
- One more env var to set. Canonical value ships in `.dev.vars.example`.
- Boot-time validation cannot catch the "address is syntactically valid but not verified at the provider" case. That failure surfaces at first send. Acceptable — checking provider-side verification at boot would require a Resend API call on cold start, which is not worth the round-trip cost.

## Follow-ups

- Ship `emailFrom()` in the same helper module as [ADR 0013](0013-host-config-from-environment.md) and [ADR 0017](0017-cookie-name-prefix-from-env.md) (`src/host.ts` or wherever).
- Add `EMAIL_FROM=hello@rev01.aayushman.dev` to `.dev.vars.example`.
- Migrate `src/email/send.ts` and every file under `src/email/templates/` to read from the helper. Audit list per [ADR 0013](0013-host-config-from-environment.md)'s grep follow-up.
- Add a smoke that asserts no hardcoded `@rev01.aayushman.dev` literal remains in `src/email/` after migration.
