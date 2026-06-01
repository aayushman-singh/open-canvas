# Security Policy

## Supported versions

Only the current `main` branch of Open Canvas is supported. There are no LTS
branches, no backports, and no patched older releases. If you are running a
fork or a pinned commit, upgrade to latest `main` before reporting.

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security problems.

Use either channel:

1. GitHub's private vulnerability reporting:
   <https://github.com/aayushman-singh/opencanvas/security/advisories/new>
2. Email: kremzylo@gmail.com (subject line starting with `[security]`)

Include: affected URL or commit SHA, reproduction steps, observed impact, and
any proof-of-concept payload. Encrypted email is welcome but not required.

## Response expectations

- Acknowledgement within **72 hours** of receipt.
- A first triage assessment (accepted / needs-info / out-of-scope) within 7 days.
- Fix timeline communicated once severity is confirmed. Credit in release notes
  on request.

## Out of scope

- Denial-of-service that requires unreasonable traffic volume.
- Social engineering of the maintainer or contributors.
- Reports from automated scanners with no demonstrated exploit path.
- Missing security headers without a concrete attack scenario.
- Issues only reproducible on unsupported forks or stale commits.
