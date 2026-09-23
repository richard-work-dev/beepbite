# AWS deployment bootstrap

This root owns the GitHub Actions OIDC provider and the development deployment
role. It is deliberately separate from the application state because a CI role
must not modify its own trust relationship.

The trust policy uses GitHub's immutable owner and repository IDs and accepts
only jobs running in the `development` environment. The role has an explicit
policy for the development state and `beepbite-dev-*` resources plus narrowly
scoped IAM access to the Lambda runtime role. It has no account-wide managed
policy.

Bootstrap changes are applied locally with privileged AWS credentials. The
regular development workflow cannot apply this root.
