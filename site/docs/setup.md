# Setup and deployment

BeepBite runs on AWS using API Gateway, Go Lambda, DynamoDB, S3, CloudFront,
SQS and Secrets Manager. There is no PostgreSQL server, local migration step,
or standalone API binary to install.

## Use the development environment

The simplest way to evaluate BeepBite is to open the development URL provided
by the project. To work on the frontend locally:

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` at the repository root.
3. Run `npm ci` and `npm run dev` from `web/`.

The local web app connects to the shared development API. Treat its data as
shared: do not run destructive experiments against real store records.

## Deploy your own environment

You need an AWS account, Terraform 1.10+, Go 1.25+, Node.js 20+, AWS CLI access,
and a remote Terraform state bucket. The maintained deployment procedure,
variables and GitHub OIDC setup are documented in
[infra/aws/README.md](../infra/aws/README.md).

The deployment provisions the serverless API and its DynamoDB tables together
with the web hosting resources. Runtime secrets belong in AWS Secrets Manager;
do not put AWS credentials or production secrets in `.env`, Terraform source,
or GitHub repository files.

## Data and backups

Application data is stored in DynamoDB. The Terraform stack enables point-in-
time recovery on its tables and stores user uploads/exports in private S3
buckets. Review retention, recovery objectives and AWS costs for your own
environment before using it for production.

## Local validation

```bash
cd backend
go test ./cmd/serverless/... ./pkg/...
go vet ./cmd/serverless/... ./pkg/...
bash ../infra/aws/scripts/build-lambdas.sh

cd ../web
npm ci
npm run typecheck
npm run test:unit
npm run build
```

No database bootstrap, SQL seed, schema migration, or PostgreSQL connection is
needed for these checks.
