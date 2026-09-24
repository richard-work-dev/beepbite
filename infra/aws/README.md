# BeepBite serverless on AWS

This Terraform root deploys the BeepBite development environment in
`us-east-1` using consumption-based AWS services:

- API Gateway HTTP API and ARM64 Go Lambda;
- API Gateway WebSocket API with authenticated connection tracking;
- DynamoDB on-demand tables, streams, encryption, TTL and point-in-time recovery;
- SQS jobs queue and dead-letter queue;
- private S3 buckets and CloudFront for the web app and uploads;
- Route 53 and ACM for the `rikopollo.dpdns.org` development hostnames;
- Secrets Manager for runtime values and CloudWatch log retention.

The old EC2, VPC and local PostgreSQL runtime is removed by this configuration.
The ECR repository and archive bucket remain during the application migration.

## Prerequisites

- Terraform 1.10 or newer
- Go 1.25 or newer
- AWS CLI profile `beepbite-dev`
- credentials from the dedicated IAM user

## Build and validate

From this directory:

```powershell
.\scripts\build-lambdas.ps1
terraform init -backend-config=backend.hcl
terraform fmt -check -recursive
terraform validate
terraform plan -out=serverless.tfplan
```

The Lambda archives are local build artifacts and are ignored by Git. Build
them before every plan or apply that changes Go code.

## Deploy

```powershell
terraform apply serverless.tfplan
terraform output
```

The HTTP health check is available at `<api_url>/api/health`. WebSocket clients
connect to `<websocket_url>?token=<access-token>`; the connect handler validates
the existing BeepBite JWT and stores the connection in DynamoDB.

Terraform creates the Secrets Manager container but never stores secret values
in source, plans or state. The runtime secret must contain `JWT_SECRET` before
authenticated WebSocket connections are accepted.

The Lambda API now serves authentication plus the tenant-scoped generic data
surface at `/data/{table}` and `/api/v1/data/{table}` from DynamoDB. It supports
the select, filter, ordering and mutation operations used by the web client,
including organization onboarding and dual-indexed memberships. Specialized
routes backed by DynamoDB currently cover onboarding progress/status, user
workspace preferences, location updates, reservations, waitlist operations,
customer search, staff lookup, daily specials, category availability, POS order
creation/modification/charging/holding, KDS tickets and expo views, cash drawer
sessions and movements, and staff time-clock entries. Remaining business routes
are migrated domain by domain and return HTTP 404 until their replacement is
deployed.

## Automated development deployments

Feature and fix pull requests target `develop`; promotion pull requests go from
`develop` to `main`. Both targets build the Lambda archives and validate
Terraform without AWS credentials. Every merged push to `develop` assumes the scoped
`beepbite-github-development` role through GitHub OIDC, plans and applies the
development state, builds the frontend with the deployed API URL, synchronizes
it to S3, invalidates CloudFront and runs HTTP smoke checks.

The OIDC provider and deployment role live in the separate `bootstrap/` root so
the deployment role cannot change its own trust policy. GitHub stores only role,
region and state coordinates as environment variables; no AWS access keys are
stored in the repository.

## Development domain

Terraform owns the public Route 53 zone for `rikopollo.dpdns.org` and requests
an ACM wildcard certificate. Delegate the domain in DigitalPlat to all four
name servers printed by `terraform output domain_name_servers`.

The first deployment keeps `enable_custom_domains = false`, so the existing AWS
URLs continue working while DNS propagates. After delegation is visible, set the
variable to `true` to activate:

- `https://dev.rikopollo.dpdns.org`
- `https://api-dev.rikopollo.dpdns.org`
- `wss://ws-dev.rikopollo.dpdns.org`

ACM validation records live in Route 53, allowing AWS to renew the certificate
without manually sharing certificate files or private keys.
