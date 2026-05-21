# db

## Definition

Persistent store of customer-owned records. Owns the canonical schema for everything that must survive worker isolate eviction and the lifecycle of a single request — starting with the `customer` row that pairs a signed-in human with their email of record. Returns a typed query interface to other subsystems; never decides who is allowed to read or write, that contract belongs to the auth subsystem and the calling route.

## Inputs

- **route handlers** -> read/write intent against the schema, scoped to whatever row keys they hold
- **environment** -> connection string identifying the target Postgres database

## Outputs

- **route handlers** -> typed query builder bound to the request's environment, plus the row shapes exported from the schema
- **schema introspection tooling** -> declarative table definitions consumed by `drizzle-kit push` to converge the live database to the in-tree schema; migration files are deferred until the shape stabilises
