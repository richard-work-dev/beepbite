# BeepBite — roadmap

BeepBite is a serverless restaurant operations platform. The supported runtime
is AWS Lambda (Go), API Gateway, DynamoDB, SQS, S3 and CloudFront. The web app
is a React/TypeScript static bundle. PostgreSQL, SQL migrations, a standalone
HTTP server and container-based application deployment are retired and must
not be reintroduced as runtime options.

## Current direction

1. **Complete the DynamoDB product surface.** The generic tenant-scoped data
   API and specialized routes currently cover core POS, kitchen, onboarding,
   staff and cash workflows. Migrate remaining business domains before
   advertising them as available; unsupported routes must continue to fail
   clearly rather than silently return empty data.
2. **Make operational data trustworthy.** Validate reporting, sales and
   inventory end to end against the same DynamoDB records used by the POS.
   Include editing, auditability and downloadable reports where the UI offers
   those actions.
3. **Keep order flows consistent.** Treat fulfillment and payment as separate
   state dimensions, keep dine-in / takeaway choices explicit, and ensure the
   public order link and staff POS produce the same order lifecycle.
4. **Ship safely.** CI builds, vets and tests every Lambda package, validates
   the frontend and checks Terraform. Development deploys use GitHub OIDC and
   do not require long-lived AWS keys in repository secrets.

## Data and deployment rules

- DynamoDB is the only supported application database.
- Use the established tenant partitioning, conditional writes and indexes;
  document any access-pattern or table change with its migration/compatibility
  plan.
- Keep secrets in AWS Secrets Manager and deployment state in the configured
  remote Terraform backend.
- Do not add SQL drivers, migration runners, PostgreSQL containers, legacy
  server binaries or deployment paths for the retired runtime.
- Preserve historical release notes as history; current setup and deployment
  instructions must describe only the serverless architecture.

## Near-term validation

- Exercise reports and inventory with representative seeded DynamoDB data.
- Verify order creation, kitchen transitions, payment completion and customer
  tracking through the deployed API.
- Monitor Lambda errors, queue dead letters and DynamoDB throttling after each
  development deployment.
