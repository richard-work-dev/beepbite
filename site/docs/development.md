# Development guide

## Stack

| Layer | Technology |
|---|---|
| Web | React 19, Vite, TypeScript, Tailwind |
| API | Go 1.25 Lambda functions behind API Gateway |
| Primary data store | DynamoDB, tenant-partitioned records |
| Files and exports | Private S3 buckets |
| Background work | SQS and Lambda |
| Realtime | API Gateway WebSocket and a DynamoDB connection registry |
| Infrastructure | Terraform under `infra/aws/` |

The supported application runtime is serverless. Do not add a PostgreSQL
connection, migration, SQL seed, or local HTTP server as a dependency.

## Repository layout

```text
backend/
  cmd/serverless/api/       HTTP API and DynamoDB-backed application routes
  cmd/serverless/realtime/  WebSocket connection handler
  cmd/serverless/stream/    DynamoDB stream handler
  cmd/serverless/worker/    queued background jobs
  pkg/tokens/               stateless JWT helpers shared by Lambdas
infra/aws/                  Terraform and Lambda packaging scripts
web/                        React application
docs/                       Product and developer documentation
```

## Local development

The browser app points at the shared AWS development API by default. Copy
`.env.example` to `.env`, then start Vite:

```bash
cd web
npm ci
npm run dev
```

Changes to backend code are validated locally and deployed through the
`develop` workflow. The browser app will use shared development data, so use a
dedicated stack for destructive or isolated testing.

## Validate backend changes

```bash
cd backend
go test ./cmd/serverless/... ./pkg/...
go vet ./cmd/serverless/... ./pkg/...
bash ../infra/aws/scripts/build-lambdas.sh
```

The package tests use in-memory/fake AWS clients where needed; they do not
require a database or live AWS credentials. Terraform validation and the
automated deployment flow are described in [infra/aws/README.md](../infra/aws/README.md).

## Validate frontend changes

```bash
cd web
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

## Data access and tenant isolation

The Lambda API authenticates requests, resolves the caller's organization on
the server, and scopes DynamoDB operations to that tenant's partition. A
client-supplied organization ID is not an authorization boundary. Add access
checks in the serverless handler before reading or mutating tenant records, and
cover cross-tenant access in the handler's tests.

Generic table access is allowlisted in
[`backend/cmd/serverless/api/data_tables.go`](../backend/cmd/serverless/api/data_tables.go).
Sensitive workflows should use dedicated routes and transactional writes where
multiple records must stay consistent. DynamoDB key design and indexes live in
the Terraform/storage model and the serverless API helpers; there is no SQL
schema or migration workflow.

## CI and deployment

`.github/workflows/test.yml` builds, vets and tests the Lambda packages and
runs the frontend checks. `.github/workflows/deploy-development.yml` publishes
the `develop` branch to AWS using GitHub OIDC and Terraform. It builds the
frontend against the deployed API URL, syncs it to S3, invalidates CloudFront
and performs API/frontend smoke checks.
