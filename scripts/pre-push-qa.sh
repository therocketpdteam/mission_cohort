#!/usr/bin/env bash
set -euo pipefail

echo "== Git whitespace check =="
git diff --check

export COREPACK_HOME="${COREPACK_HOME:-/tmp/corepack}"

if ! command -v pnpm >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
  latest_node_bin="$(find "$HOME/.nvm/versions/node" -maxdepth 2 -type d -name bin | sort -V | tail -n 1)"
  if [ -n "$latest_node_bin" ]; then
    export PATH="$latest_node_bin:$PATH"
  fi
fi

echo "== Admin-only route scan =="
if rg -n "LaunchPad|student dashboard|learner course catalog|/student|/learners|/launchpad" src; then
  echo "Unexpected learner-facing or LaunchPad reference found."
  exit 1
fi

echo "== Replaced-tool integration scan =="
if rg -n "Asana|Google Sheets|GoogleSheets|asana|google sheets|sheets" src prisma scripts --glob '!scripts/pre-push-qa.sh'; then
  echo "Unexpected Asana or Google Sheets integration reference found outside documentation."
  exit 1
fi

echo "== TypeScript/build checks =="
if command -v pnpm >/dev/null 2>&1; then
  pnpm prisma:generate
  pnpm typecheck
  pnpm build
elif command -v npm >/dev/null 2>&1; then
  npm run prisma:generate
  npm run typecheck
  npm run build
else
  echo "Node package manager not found; install Node/pnpm before pushing."
  exit 1
fi

echo "Pre-push QA completed."
