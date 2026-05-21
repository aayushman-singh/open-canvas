# api

## Definition

Programmatic surface for the dashboard, the editor, and the agent. Receives
mutation requests and live-collaboration upgrade requests from signed-in
callers, validates them against the document and catalog vocabulary,
verifies ownership of the targeted resource, and either applies the change
transactionally or hands the connection off to the live-collaboration owner.
Returns either a structured response (for JSON callers), a redirect back
into the dashboard (for plain HTML form callers), or a protocol-upgraded
WebSocket. Anonymous callers are bounced to the identity gate before any
handler runs.

## Inputs

- **dashboard caller** -> request to create a new site from a chosen
  template, carrying the template id and a user-supplied site name
- **editor caller** -> request to upgrade the connection to a live
  collaboration session for a specific page, carrying the page identity
- **request context** -> the resolved Clerk user, supplied by the identity
  gate, used to resolve the owning customer row and to verify page ownership
- **catalog store** -> existing template row, looked up by id to confirm
  the chosen template still exists before materialising a site
- **page store** -> page-and-site ownership chain used to gate
  live-collaboration upgrades
- **environment** -> database connection string and the live-collaboration
  binding

## Outputs

- **site store** -> a new site row owned by the resolved customer, plus one
  page row per template page (copied document, copied position), all inside
  one transaction so partial failure rolls back
- **live-collaboration owner (one per page)** -> a forwarded WebSocket
  upgrade for the targeted page, keyed by page identity, after the ownership
  check passes
- **caller** -> JSON site id (when the caller asked for JSON), a redirect
  back to the dashboard (otherwise), a 101 protocol-upgrade response (for
  live-collaboration callers), or a 4xx with an error body for missing,
  invalid, or unauthorised input
