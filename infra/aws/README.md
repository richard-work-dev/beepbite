# BeepBite on AWS

This directory contains the Terraform foundation for a low-cost single-node
deployment in `us-east-1`.

It provisions:

- one ARM64 EC2 instance for the Go API and PostgreSQL;
- an encrypted gp3 root volume and Elastic IP;
- Systems Manager access, with no public SSH port;
- a private ECR repository;
- a private uploads bucket served through CloudFront;
- a private PostgreSQL backup bucket with retention;
- a Secrets Manager container whose value is populated outside Terraform.

The database shares the application host to keep the initial monthly cost
small. This is suitable for development and an early production rollout. A
managed RDS database and multiple application instances should replace it when
availability requirements justify the additional fixed cost.

## Prerequisites

- Terraform 1.10 or newer
- AWS CLI profile `beepbite-dev`
- credentials must belong to the dedicated IAM user, never the root account

## Validate without creating resources

```powershell
cd infra/aws
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform plan -refresh=false
```

Copy `terraform.tfvars.example` to `terraform.tfvars` before planning. The real
file is ignored by Git. Planning and validation do not create AWS resources.

## Apply later

`terraform apply` creates billable resources and is intentionally not part of
the local validation workflow. Before applying:

1. configure a remote state backend;
2. replace `upload_cors_origins` with the real frontend hostname;
3. review the complete plan;
4. populate the created Secrets Manager entry with runtime values such as
   `DATABASE_URL`, `JWT_SECRET`, and `WHATSAPP_APP_SECRET` without passing them
   through Terraform.

Terraform creates only the secret container. Secret values therefore do not
appear in source control, plans, or Terraform state.
