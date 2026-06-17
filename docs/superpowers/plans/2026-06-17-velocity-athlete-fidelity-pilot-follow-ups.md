# Velocity Athlete Fidelity Pilot Follow-ups

The pilot branch is implementation-complete, but these items remain outside the shipped slice.

## Pending Items

- Fix the pre-existing `review:smoke` dashboard assertion: `expected dashboard to model all owned sites as SiteCard[] rows, not only one editor link`.
- Run live visual verification after configuring `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`, then capture desktop and mobile screenshots for the template picker preview, created site, and published site.
- Upload the new Velocity seed assets to production R2 with the seed asset upload flow before relying on the template in live public pages.
- Remove temporary Velocity task worktrees after the feature branch is merged and no further comparison is needed.

## Notes

- `template-preview:smoke`, `velocity-athlete:smoke`, `typecheck`, and `ci:smoke` passed on the integrated pilot branch.
- `review:smoke` fails the same dashboard `SiteCard[]` assertion on the base pilot branch, so that failure predates the Velocity work.
