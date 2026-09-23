#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
INFRA_ENV="/opt/beepbite/config/infrastructure.env"
RUNTIME_ENV="/opt/beepbite/config/runtime.env"
RELEASE="${1:-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)}"
PUBLIC_ORIGIN="${2:?usage: deploy.sh [release] http://PUBLIC_IP}"

for command in aws docker jq; do
  command -v "$command" >/dev/null || {
    echo "missing required command: $command" >&2
    exit 1
  }
done

test -r "$INFRA_ENV" || {
  echo "missing $INFRA_ENV; wait for cloud-init to finish" >&2
  exit 1
}

# Infrastructure values are identifiers and URLs only. Runtime secrets come
# directly from Secrets Manager on the instance and never traverse CI or SSM.
set -a
# shellcheck disable=SC1090
source "$INFRA_ENV"
set +a

secret_json="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$RUNTIME_SECRET_ID" \
  --query SecretString \
  --output text)"

POSTGRES_PASSWORD="$(jq -er '.POSTGRES_PASSWORD' <<<"$secret_json")"
APP_DB_PASSWORD="$(jq -er '.APP_DB_PASSWORD' <<<"$secret_json")"
JWT_SECRET="$(jq -er '.JWT_SECRET' <<<"$secret_json")"
WHATSAPP_APP_SECRET="$(jq -er '.WHATSAPP_APP_SECRET' <<<"$secret_json")"
unset secret_json

umask 077
cat >"$RUNTIME_ENV" <<EOF
APP_ENV=dev
PORT=8080
DATABASE_URL=postgres://bb_app:${APP_DB_PASSWORD}@db:5432/beepbite?sslmode=disable
JWT_SECRET=${JWT_SECRET}
WHATSAPP_APP_SECRET=${WHATSAPP_APP_SECRET}
CORS_ORIGINS=${PUBLIC_ORIGIN}
AWS_REGION=${AWS_REGION}
S3_BUCKET=${UPLOADS_BUCKET}
S3_PUBLIC_BASE_URL=${UPLOADS_PUBLIC_BASE_URL}
EOF

# The frontend build is memory-heavy for a 2 GB host. A local encrypted EBS
# swapfile keeps the initial low-cost instance usable without changing size.
if ! swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile
    chmod 0600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

docker network inspect beepbite >/dev/null 2>&1 || docker network create beepbite >/dev/null
docker volume inspect beepbite-postgres >/dev/null 2>&1 || docker volume create beepbite-postgres >/dev/null

if ! docker container inspect beepbite-db >/dev/null 2>&1; then
  docker run -d \
    --name beepbite-db \
    --network beepbite \
    --network-alias db \
    --restart unless-stopped \
    --env POSTGRES_DB=beepbite \
    --env POSTGRES_USER=postgres \
    --env POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    --volume beepbite-postgres:/var/lib/postgresql/data \
    postgres:16-alpine >/dev/null
else
  docker start beepbite-db >/dev/null || true
fi

for _ in $(seq 1 60); do
  if docker exec beepbite-db pg_isready -U postgres -d beepbite >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker exec beepbite-db pg_isready -U postgres -d beepbite >/dev/null

docker build \
  --file "$ROOT_DIR/infra/aws/runtime/Dockerfile.api" \
  --tag "beepbite-api:${RELEASE}" \
  "$ROOT_DIR"

docker build \
  --file "$ROOT_DIR/infra/aws/runtime/Dockerfile.web" \
  --build-arg VITE_API_URL=/backend \
  --tag "beepbite-web:${RELEASE}" \
  "$ROOT_DIR"

admin_database_url="postgres://postgres:${POSTGRES_PASSWORD}@db:5432/beepbite?sslmode=disable"

docker run --rm \
  --network beepbite \
  --env APP_ENV=dev \
  --env DATABASE_URL="$admin_database_url" \
  --env JWT_SECRET="$JWT_SECRET" \
  "beepbite-api:${RELEASE}" \
  /app/bin/migrate --env=dev --up

docker run --rm \
  --network beepbite \
  --env DATABASE_URL="$admin_database_url" \
  --env APP_DB_ROLE=bb_app \
  --env APP_DB_PASSWORD="$APP_DB_PASSWORD" \
  "beepbite-api:${RELEASE}" \
  /app/bin/setupapprole

docker rm -f beepbite-web beepbite-api >/dev/null 2>&1 || true

docker run -d \
  --name beepbite-api \
  --network beepbite \
  --network-alias api \
  --restart unless-stopped \
  --env-file "$RUNTIME_ENV" \
  "beepbite-api:${RELEASE}" >/dev/null

docker run -d \
  --name beepbite-web \
  --network beepbite \
  --restart unless-stopped \
  --publish 80:80 \
  "beepbite-web:${RELEASE}" >/dev/null

for _ in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1/environment-health >/dev/null; then
    echo "BeepBite ${RELEASE} is healthy at ${PUBLIC_ORIGIN}"
    exit 0
  fi
  sleep 2
done

echo "deployment did not become healthy" >&2
docker logs --tail 100 beepbite-api >&2 || true
exit 1
