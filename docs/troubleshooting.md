# Troubleshooting

## The web app cannot reach the API

- Check `VITE_API_URL` in the root `.env`; it should match the API URL from
  `terraform output api_url`.
- Restart Vite after changing `.env`.
- For local Vite development, confirm the development API allows the local
  origin (`http://localhost:5173`). Local web changes use shared development
  data.
- Check the API health endpoint at `<api_url>/api/health` and inspect the
  Lambda's CloudWatch logs.

## Sign-in or token refresh fails

- Verify the API Lambda can read the runtime secret configured by
  `RUNTIME_SECRET_ID` in AWS Secrets Manager.
- Check the `JWT_SECRET` value and the API Lambda logs. Keep runtime secrets in
  Secrets Manager, not in the frontend `.env` file.
- Clear the browser's BeepBite auth storage and sign in again if a stale token
  remains after a development deployment.

## A Lambda cannot access DynamoDB or S3

- Confirm the function has the expected Terraform IAM policy and that the
  table/bucket environment variables match the deployed resources.
- Check CloudWatch logs for `AccessDenied`, missing table names, throttling or
  conditional-write errors.
- Do not work around a permission error by widening tenant data access; fix
  the function's least-privilege policy and add a test for the affected route.

## Development deployment failed

- Review the GitHub Actions `Deploy development` run and identify whether the
  failure occurred during Lambda build, Terraform plan/apply, frontend publish,
  or smoke checks.
- Terraform state, AWS region and OIDC role variables are configured in the
  GitHub `development` environment. No static AWS access key should be needed.
- Validate the infrastructure locally from `infra/aws/` with `terraform
  fmt -check -recursive` and `terraform validate`.

## The app shows stale assets after deploy

The workflow invalidates CloudFront after publishing. Hard-refresh the page and
check the deployment summary for the completed invalidation and frontend URL.
The service worker and `index.html` are published with no-cache headers; hashed
assets are immutable.

## Run local checks

```bash
cd backend
go test ./cmd/serverless/... ./pkg/...

cd ../web
npm run typecheck
npm run test:unit
```

The project no longer has a PostgreSQL service, SQL migrations, or a local Go
HTTP server. Database setup instructions from older versions no longer apply.
