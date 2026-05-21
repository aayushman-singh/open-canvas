# api

## Definition

Programmatic surface for the dashboard and the agent. Receives mutation
requests from signed-in callers, validates them against the document and
catalog vocabulary, and applies them transactionally to the persistence
layer. Returns either a structured response (for JSON callers) or a redirect
back into the dashboard (for plain HTML form callers). Anonymous callers
are bounced to the identity gate before any handler runs.

## Inputs

- **dashboard caller** -> request to create a new site from a chosen
  template, carrying the template id and a user-supplied site name
- **request context** -> the resolved Clerk user, supplied by the identity
  gate, used to resolve the owning customer row
- **catalog store** -> existing template row, looked up by id to confirm
  the chosen template still exists before materialising a site
- **environment** -> database connection string

## Outputs

- **site store** -> a new site row owned by the resolved customer, plus one
  page row per template page (copied document, copied position), all inside
  one transaction so partial failure rolls back
- **caller** -> JSON site id (when the caller asked for JSON) or a redirect
  back to the dashboard (otherwise); 4xx with a JSON error body for missing
  or invalid input
