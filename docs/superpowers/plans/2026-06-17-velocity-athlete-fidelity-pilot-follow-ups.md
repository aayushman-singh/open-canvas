# Velocity Athlete Fidelity Pilot Follow-ups

The pilot branch is implementation-complete, but these items remain outside the shipped slice.

## Pending Items

- Fix the pre-existing `review:smoke` dashboard assertion: `expected dashboard to model all owned sites as SiteCard[] rows, not only one editor link`.
- Add live production visual verification after configuring `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`; standalone desktop/mobile Playwright visual verification now covers the pre-rendered built-in Velocity Athlete template preview via `bun run velocity-athlete:visual-e2e`.
- Upload the new Velocity seed assets to production R2 with the seed asset upload flow before relying on the template in live public pages.
- Remove temporary Velocity task worktrees after the feature branch is merged and no further comparison is needed.

## Notes

- `template-preview:smoke`, `velocity-athlete:smoke`, `typecheck`, and `ci:smoke` passed on the integrated pilot branch.
- `review:smoke` fails the same dashboard `SiteCard[]` assertion on the base pilot branch, so that failure predates the Velocity work.
