# Commit conventions

rev01 uses [Conventional Commits](https://www.conventionalcommits.org/). Enforcement is by review — no git hooks, no commitlint, no Husky. Adding tooling to gate commits adds an install step to every local clone; review catches deviations without that tax.

---

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **Subject line** — `type(scope): subject`, total length ≤ **50 characters**.
- **Body** — optional. Wrapped at **72 columns**. Explains _why_, not _what_ (the diff already shows the what).
- **Footer** — optional. Issue refs (`Closes #12`), breaking-change notes (`BREAKING CHANGE: <description>`).
- No co-author trailers. One author per commit.

---

## Allowed types

| Type       | Use for                                                              |
| ---------- | -------------------------------------------------------------------- |
| `feat`     | A new user-visible feature                                           |
| `fix`      | A bug fix                                                            |
| `refactor` | Code restructuring that changes neither behaviour nor public surface |
| `test`     | Adding or changing tests; no production-code change                  |
| `docs`     | Documentation only                                                   |
| `chore`    | Tooling, dependencies, build config — no production-code change      |
| `ci`       | Continuous-integration config changes                                |
| `perf`     | A change motivated by performance                                    |
| `style`    | Formatting, whitespace, lint-only changes                            |

If a commit doesn't fit one of these, the commit is doing too much — split it.

---

## Scope

Optional. When present, names the subsystem touched (folder name under `src/`, or a top-level concept like `wrangler`, `eslint`, `adr`).

Examples:

- `feat(agent): stream tool calls as yjs ops`
- `chore(wrangler): bump compatibility_date`
- `docs(adr): add 0002 document schema`

---

## Subject rules

- **Imperative mood** — `add`, not `added` or `adds`.
- **No trailing period.**
- **Lowercase first letter** after the colon (proper nouns excepted).
- **Concrete.** `fix: editor crash on empty doc` beats `fix: bug`.

---

## Atomicity

One logical change per commit. If a commit message needs an "and," it should probably be two commits. Mixing a refactor with a feature change makes review harder and bisect noisier.

---

## Examples

Good:

```
feat: add /health endpoint
chore: scaffold package.json + tsconfig
fix(renderer): handle empty doc without throwing
docs(adr): add 0003 multiplayer transport
refactor(document): inline single-use helper
```

Bad:

```
update stuff                              # no type, vague
feat: Added the new feature.              # past tense, period, capitalised
chore: bump deps and fix lint and add ci  # not atomic
```
