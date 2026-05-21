# dashboard

## Definition

Landing surface for a signed-in human. Materialises the visitor as a persistent customer record on first arrival, refreshes the email of record on each subsequent visit, and renders a server-rendered acknowledgement that the session is live. Anonymous callers are bounced to the identity gate before this route runs.

## Inputs

- **request context** -> the resolved Clerk user, supplied by the identity gate
- **environment** -> database connection string used to materialise the customer row, plus the publishable key used to construct the sign-out link to the hosted Account Portal

## Outputs

- **customer store** -> upsert keyed on the Clerk user id, with the current primary email and a refreshed updated-at timestamp
- **caller** -> server-rendered HTML page that names the signed-in email and exposes a link back out through the hosted sign-out flow
