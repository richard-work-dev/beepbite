# API overview

The supported API is the Go Lambda application behind AWS API Gateway. It uses
DynamoDB for application records; it does not expose a SQL connection, a
PostgreSQL RPC layer, or a migration-managed schema.

## Authentication

The web client signs in through the API and sends its short-lived access token
as a bearer token. The API resolves the user's membership and organization;
tenant identifiers supplied by the browser are not trusted as authorization.
Refresh tokens are opaque values and only their hashes are stored.

## Data API

The serverless API provides a constrained `/data/{table}` surface for tables
that are explicitly allowlisted in
[`data_tables.go`](../backend/cmd/serverless/api/data_tables.go). The web
client's Supabase-shaped helper is a compatibility interface only; it sends
ordinary HTTP requests to the Lambda API and does not connect to Supabase.

Use dedicated routes for workflows with business rules, sensitive data,
payment/tender operations, inventory adjustments or multi-record changes. Such
routes can validate capabilities and use DynamoDB conditional or transactional
writes. Do not add generic write access for a table simply to bypass a missing
domain route.

## Privacy operations

Organization owners can request an inline export of tenant-scoped records with
`POST /settings/data-export`. The archive includes the organization profile and
the allowlisted DynamoDB data tables; requests larger than 4 MB return `413`
until asynchronous S3 exports are implemented. `POST
/customers/{customer_id}/forget` redacts customer contact fields and order
address/contact snapshots while retaining financial history. Only the owner
may request erasure. Whole-account deletion is deliberately disabled until a
worker can purge all tenant records and derived copies; the API responds with
`501` rather than claiming that a deletion was scheduled.

## Adding or changing an endpoint

1. Implement the route and tenant/capability checks in `backend/cmd/serverless/api`.
2. Keep DynamoDB keys and indexes consistent with `infra/aws/storage.tf` and
   the storage helpers in the API package.
3. Add unit tests for valid access, invalid transitions and cross-tenant
   denial.
4. Run `go test ./cmd/serverless/... ./pkg/...` and build the Lambda archives.
5. Deploy through the `develop` workflow and verify the route in the target
   environment.

Never introduce PostgreSQL, SQL migrations, or a second HTTP server for an API
feature.
