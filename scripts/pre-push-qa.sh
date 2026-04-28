#!/usr/bin/env bash
set -euo pipefail

echo "== Git whitespace check =="
git diff --check

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
  pnpm typecheck
  pnpm build
elif command -v npm >/dev/null 2>&1; then
  npm run typecheck
  npm run build
else
  echo "Node package manager not found; run typecheck/build in CI or Vercel."
fi

echo "Pre-push QA completed."
