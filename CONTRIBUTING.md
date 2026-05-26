# Contributing to rev01

Thanks for your interest in contributing! This project is actively developed and we welcome pull requests.

## Getting started

```bash
bun install
bun run dev          # starts wrangler dev on http://localhost:8787
```

## Before submitting a PR

1. **Type-check**: `bun run typecheck`
2. **Lint**: `bun run lint`
3. **Smoke tests**: run the relevant `bun run <module>:smoke` script for your change
4. **Build**: `bun run build` (dry-run deploy)

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code restructuring with no behaviour change
- `test:` — adding or updating tests
- `docs:` — documentation only
- `chore:` — tooling, CI, dependencies

Keep commits atomic — one logical change per commit.

## Code style

- Prettier and ESLint are configured. Run `bun run format` and `bun run lint:fix` before committing.
- No TODO comments — open an issue instead.

## Questions?

Open an issue and we'll get back to you.
