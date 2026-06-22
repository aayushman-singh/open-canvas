# Deterministic Replica Package Design

## User-Visible Done State

An owner or template author gives Open Canvas a source website, URL, or GitHub
repository and gets a deterministic replica workflow instead of a long
agent-authored hand conversion. "Done" means the author can inspect one source
package, compile it to a built-in Template Seed, compile it to an import-ready
Editable Site payload, or require both outputs to pass from the same input.

The result is successful only when the generated template appears in the
dashboard template picker, its preview renders with real assets, creating a site
from it works, the import payload validates as an Editable Site, and every
source behaviour is recorded as native, explicitly unsupported, or intentionally
out of scope.

## Why This Exists

Open Canvas already has a deterministic final template model: Template Seeds
compose Section Library entries, `instantiateTemplate` resolves exact section
refs, and the current smokes validate dashboard preview and created-site
behaviour. The nondeterminism lives earlier. A replica still asks an agent to
hand-edit TypeScript registry objects, Section Library JSON, seed asset metadata,
fidelity ledgers, package scripts, and custom smoke files.

The product problem is not "make the agent better at guessing." The problem is:
give the agent a small source interface with explicit relations, then compile
that interface into the current Open Canvas shapes.

## Success Criteria

- A single Replica Source Package can compile to `seed`, `import`, or `both`.
- `both` requires both target adapters to pass. One passing target never masks a
  failing target.
- The agent writes package JSON and source assets, not ad hoc edits across the
  template registry, seed asset registry, and smoke files.
- Generated outputs use current Open Canvas concepts: Template Seed, Section
  Library, Section Instance, seed assets, Editable Site, and Published Snapshot.
- Every source behaviour has a fidelity ledger row and maps to a schema-owned
  primitive or an explicit unsupported finding.
- Generated tests cover registration, instantiation, validation, preview render,
  required copy/assets, forbidden source-runtime tokens, asset hashes, and
  unsupported findings.
- Existing production template source admin work remains untouched.

## Non-Goals

- No arbitrary source React, Vue, Svelte, CSS bundle, GSAP blob, or custom script
  becomes the replica answer.
- No owner-facing dashboard UI in the first slice.
- No replacement of the existing Site Import scraper in the first slice.
- No R2 upload automation beyond the existing `seed:assets --upload --remote`
  operator step.
- No changes to the production template source admin panel in the first slice.
- No new visibility tier between built-in Template Seeds and DB-backed custom
  templates.

## Hard Constraints

- Template Seeds remain compositions of Section Library entries per ADR 0061.
- Site-level header and footer remain the only pinned slots per ADR 0059.
- Seed asset bytes remain base64 text under `src/assets/seed-source/` per ADR
  0023.
- Unsupported source behaviour fails loudly through compile errors, validation
  errors, or explicit unsupported report rows.
- The compiler is deterministic: same package input produces the same output
  files, ids, and report.
- Target modes are explicit requested alternatives. They never silently replace a
  failing target.
- Existing files owned by the parallel production admin-panel work are outside
  the first slice: `src/templates/source-admin*.ts`,
  `src/routes/dashboard/admin-template-source.tsx`, and
  `scripts/template-source-admin.ts`.

## Conceptual System

Nodes:

- **Replica Source Package**: the source-authored input an agent can write.
- **Replica Compiler**: the pure deterministic transform from package facts to
  Open Canvas outputs.
- **Seed Target Adapter**: the compiler output path for built-in Template Seeds.
- **Import Target Adapter**: the compiler output path for import-ready Editable
  Site payloads.
- **Replica Verifier**: the generated check suite and report.
- **Fidelity Ledger**: the source-behaviour truth table.
- **Unsupported Finding**: a named reason a source behaviour cannot be expressed
  by current Open Canvas primitives.

Directed relations:

- Replica Source Package constrains Replica Compiler.
- Replica Compiler emits Seed Target Adapter output, Import Target Adapter output,
  or both.
- Seed Target Adapter writes Section Library entries, seed asset bytes, generated
  Template Seed definitions, and generated smokes.
- Import Target Adapter writes an Editable Site payload, asset manifest, and
  report files.
- Fidelity Ledger constrains Replica Verifier.
- Unsupported Finding stops a fidelity claim unless the finding is explicitly
  accepted as out of scope.

## Source Package Shape

First slice package layout:

```text
src/templates/replicas/<replica-id>/
  replica.json
  pages/*.json
  sections/*.json
  assets/*
  fidelity-ledger.json
  unsupported.json
```

`replica.json` owns template metadata, source URL or repository, page order,
style-kit choice, target policy, forbidden runtime tokens, and global behaviour
relations. `pages/*.json` owns page metadata and ordered section refs.
`sections/*.json` owns Section Library entry data or a constrained section
intent that can be compiled into entry data. `assets/*` owns source-approved raw
media bytes. `fidelity-ledger.json` owns source behaviours and their required
Open Canvas primitive. `unsupported.json` owns explicit gaps.

## Target Modes

CLI shape:

```bash
bun run replica compile --source src/templates/replicas/raydotsh --target seed
bun run replica compile --source src/templates/replicas/raydotsh --target import
bun run replica compile --source src/templates/replicas/raydotsh --target both
```

`seed` emits built-in Template Seed artifacts. `import` emits file-based import
payload artifacts. `both` runs both adapters and fails when either adapter or
verifier fails.

## Seed Target Output

Seed target emits:

```text
src/canvas/section-library/entries/<replica-section>.json
src/assets/seed-source/<asset>.b64
src/canvas/seed-assets.generated.ts
src/templates/generated/<replica-id>.ts
src/templates/generated/manifest.ts
src/templates/<replica-id>.replica.smoke.ts
```

`src/templates/registry.ts` should import generated template definitions through
a small generated manifest hook instead of receiving hand-written template
literals for every new replica.

The seed asset registry should gain a generated companion rather than requiring
large hand-written edits for hashes, byte sizes, dimensions, and R2 keys.

## Import Target Output

First slice import target stays file-based:

```text
tmp/replicas/<replica-id>/editable-site.json
tmp/replicas/<replica-id>/asset-manifest.json
tmp/replicas/<replica-id>/report.json
```

This proves the same package can produce a valid Editable Site without adding
database writes or owner-facing UI. A later slice can connect the output to a
DB-backed custom-template or Site Import path after the file-output contract is
stable.

## Verification

Generated verification must cover:

- `getTemplateSeed(id)` resolves for seed target.
- `instantiateTemplate(id)` validates through `validateEditableSite`.
- Published snapshot validation passes.
- Dashboard preview body renders.
- Required source copy and seed asset ids appear in HTML.
- Forbidden source runtime tokens are absent.
- Seed asset bytes exist, decode, and match generated hashes.
- Fidelity ledger row ids are unique and explicit.
- A row marked `native` has matching rendered primitive evidence.
- Unsupported findings appear in the generated report.
- `both` target fails if either adapter fails.

## Failure Behaviour

The compiler fails before writing outputs when ids collide, refs cannot resolve,
asset bytes are missing, an asset hash does not match, a section file is invalid,
or a source behaviour lacks a ledger row. The verifier fails when a generated
artifact validates poorly, a preview omits required evidence, or a native
fidelity claim lacks a real primitive.

Output writes should be atomic per generated file so a failed compile does not
leave half-written artifacts that look reviewable.

## Admin Panel Interaction

The existing production template source admin remains an edit-existing-template
adapter. This design does not change its routes, UI, or GitHub PR flow in the
first slice.

If this becomes useful in production admin later, it should appear as a separate
"create new replica" mode that consumes a Replica Source Package. It should not
be mixed into the existing section JSON editor.

## Implementation Slices

Slice 1: Add the package schema, compiler shell, generated-manifest hook,
file-output import target, and verifier using a tiny fixture replica.

Slice 2: Convert one existing built-in template, preferably `velocity-athlete`,
into a Replica Source Package and prove generated output is semantically equal
to the current hand-authored output.

Slice 3: Use the package for a new source URL or GitHub replica.

Slice 4: Consider dashboard/admin integration only after the compiler and
verifier have proven stable outside UI.

## Reduction Checks

- The Replica Source Package earns its place if deleting it would push complexity
  back into registry edits, section JSON edits, seed asset metadata edits, and
  per-template smoke authoring.
- The Seed Target Adapter and Import Target Adapter are real because two outputs
  vary behind the same package interface.
- A separate admin-panel mode is not part of slice 1 because existing admin work
  already owns edit-existing-template behaviour.
- Generated TypeScript is acceptable only as compiler output. The agent-facing
  interface stays package data.
