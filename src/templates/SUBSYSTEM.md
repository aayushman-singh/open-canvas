# templates

## Definition

The canvas Template Seed catalog. It exposes the canonical in-process starting
point used by site creation: seed metadata plus a validated `EditableSite`
whose media ids are materialised from `src/canvas/seed-assets.ts`.

## Inputs

- **template author** -> checked-in canvas fixture and metadata.
- **site creation API** -> requested template id.

## Outputs

- **site creation API** -> a `TemplateSeed` whose state can be cloned into
  `site.editableState`.
- **seed validator** -> media ids that must exist in the seed asset registry
  and match each media element's expected kind.
