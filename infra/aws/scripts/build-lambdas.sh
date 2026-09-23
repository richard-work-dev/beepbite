#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
backend_dir="$(cd -- "${script_dir}/../../../backend" && pwd)"
artifacts_dir="${script_dir}/../artifacts"

if (($# == 0)); then
  functions=(api realtime stream worker)
else
  functions=("$@")
fi

mkdir -p "${artifacts_dir}"
cd "${backend_dir}"

for name in "${functions[@]}"; do
  case "${name}" in
    api|realtime|stream|worker) ;;
    *) echo "unknown Lambda: ${name}" >&2; exit 2 ;;
  esac

  staging="${artifacts_dir}/${name}"
  rm -rf -- "${staging}"
  mkdir -p "${staging}"
  GOOS=linux GOARCH=arm64 CGO_ENABLED=0 \
    go build -tags lambda.norpc -trimpath -ldflags '-s -w' \
    -o "${staging}/bootstrap" "./cmd/serverless/${name}"
  chmod 0755 "${staging}/bootstrap"
  (cd "${staging}" && zip -q -X "${artifacts_dir}/${name}.zip" bootstrap)
  rm -rf -- "${staging}"
done
