# Features and current limits

BeepBite is a restaurant operations web app backed by AWS Lambda and DynamoDB.
The exact routes available are the ones deployed in the current environment;
the list below describes product areas, not a guarantee that every optional
workflow is enabled for every store.

## Restaurant operations

- Point of sale, orders, table sessions and floor plan.
- Kitchen display, station tickets and expo workflow.
- Inventory, recipes, stock counts and purchasing tools.
- Cash drawer, tender recording and sales reports.
- Staff permissions, customer records and order history.

## Customer ordering

- Public storefront, cart, checkout and private order tracking link.
- Delivery, collection and dine-in fulfilment where enabled by the store.
- WhatsApp entry points and notifications are optional and require the
  restaurant's own WhatsApp Business credentials. No message is sent until the
  customer initiates or the workflow explicitly opens WhatsApp on their device.
- BeepBite does not process card payments; staff record the tender received.

## Hosting and data

- The supported runtime is AWS serverless: API Gateway, Go Lambdas, DynamoDB,
  S3, CloudFront, SQS and Secrets Manager.
- Application records are tenant-scoped in DynamoDB. PostgreSQL, SQL
  migrations and a self-hosted API server are not part of the current product
  deployment.
- AWS costs depend on traffic, storage, logs and region. Review the estimate
  and configure retention before production use.
- Backups and recovery are configured through DynamoDB point-in-time recovery
  and S3 policies in the Terraform stack; verify them against your recovery
  requirements.

## Current limits

- The project is pre-1.0 and actively changing.
- Some web screens may depend on routes still being migrated or completed in
  the serverless API. A screen being present does not prove that its data path
  is complete; validate each workflow in the target environment.
- WhatsApp and payment integrations have separate external costs and
  credentials. BeepBite's own order and tender records do not imply that a
  third-party payment was processed.

See the [user guide](user-guide.md) for operating workflows and the
[AWS guide](../infra/aws/README.md) for the deployed architecture.
