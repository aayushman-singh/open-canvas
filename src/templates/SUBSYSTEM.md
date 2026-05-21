# templates

## Definition

The seed-document catalog. Holds the hand-built starting points a customer
picks from when creating a new site; exposes them as a typed, in-process
list and as rows in the catalog store. Site creation copies a seed's pages
and tokens — once copied, the seed and the site evolve independently.

## Inputs

- **catalog store** -> existing template rows, keyed by template id, so the
  seed script can upsert without losing rows
- **environment** -> database connection string used by the seed script

## Outputs

- **catalog store** -> upserts of every shipped seed (id, name, tagline,
  category, thumbnail ref, design language, theme tokens, pages array)
- **site-creation flow** -> typed descriptors and a `getTemplate(id)` lookup
  so a new site can be materialised from a chosen seed
