#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! docker info >/dev/null 2>&1; then
  if command -v colima >/dev/null 2>&1 && [ "$(docker context show 2>/dev/null)" = "colima" ]; then
    printf 'Docker is unavailable, starting Colima...\n'
    colima start
  else
    printf 'Docker is not available. Start your Docker daemon and try again.\n' >&2
    exit 1
  fi
fi

mkdir -p .homeassistant custom_components
docker compose up -d

printf 'Home Assistant is starting on http://localhost:%s\n' "${HOME_ASSISTANT_PORT:-8123}"
