# FAQ

## Where does BeepBite run?

The supported deployment uses AWS serverless services. The web app is served
through CloudFront/S3; the API runs on Lambda and stores tenant data in
DynamoDB. See [AWS deployment](../infra/aws/README.md).

## Do I need to install PostgreSQL?

No. PostgreSQL, SQL migrations and the old standalone server are not part of
the supported runtime. The current backend is Lambda + DynamoDB.

## Is it free?

BeepBite does not charge a per-order platform fee, but AWS usage can incur
charges for Lambda, DynamoDB, API Gateway, S3, CloudFront, logs and related
services. WhatsApp, maps and other third-party integrations can have their own
costs. Check current provider pricing and set budgets before production use.

## Does BeepBite process card payments?

No. It records a tender such as cash or card machine; the restaurant processes
the transaction through its own payment provider or terminal.

## Can customers order through WhatsApp?

The restaurant can share its storefront link in a WhatsApp conversation and
customers can place the order on the web page. Automatic WhatsApp messages
require a configured WhatsApp Business integration and are subject to Meta's
rules and pricing. Without that integration, staff can share links manually.

## Where are my records and backups?

Records live in the DynamoDB tables of the AWS environment hosting the app.
The Terraform stack enables point-in-time recovery for tables and uses private
S3 buckets for files and exports. Operators should confirm retention, region,
recovery procedures and AWS costs for their environment.

## Is the app production-ready?

BeepBite is pre-1.0 and under active development. Validate reports, inventory,
payments and order-state workflows in your deployed environment before relying
on them for live operations.
