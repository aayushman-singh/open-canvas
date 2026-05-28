# SUBSYSTEM.md template

Every subsystem under `src/<name>/` carries a `SUBSYSTEM.md` next to its code. This is the canonical template, derived from [ADR 0001 §14](../architecture/0001-architecture.md).

The file has **four fields**. Nothing else. No file lists, no API tables, no implementation notes — the code is the source of truth for those. This document anchors the conceptual model so a reviewer understands what the subsystem is _for_ in under two minutes.

---

## Fields

### Name

The subsystem's name — exactly as it appears in `src/<name>/`. Conceptual, not technological (`site-room`, not `DurableObjectSyncService`).

### Definition

The **why**. The behaviour this subsystem owns — its contract with the rest of the system. One paragraph. No mechanism, no library names, no file paths. If the behaviour can be described without naming a technology, name it without one.

### Inputs

The **inbound semantic relations**: what information flows _into_ this subsystem, from whom, and what it means. One bullet per relation. Label the source by its conceptual role, not by file path or class name.

### Outputs

The **outbound semantic relations**: what information flows _out_, to whom, and what it means. Same rules as Inputs.

---

## Template

Copy this into every new `src/<name>/SUBSYSTEM.md`:

```markdown
# <subsystem-name>

## Definition

<one paragraph — the behaviour this subsystem owns, in terms of its contract with the environment>

## Inputs

- **<source role>** → <what information, what it means>

## Outputs

- **<target role>** → <what information, what it means>
```

---

## Why this template exists

A subsystem is itself a system: it has nodes (its parts) and relations (its parts' interactions), and its external behaviour is the set of inbound and outbound relations it exposes. If you cannot describe a subsystem in these four fields, the subsystem boundary is wrong — either it's doing too much (split it) or its purpose is incidental (absorb it).

Skip this file if the subsystem is a single file with one exported function. Add it the moment the subsystem grows a second module.
