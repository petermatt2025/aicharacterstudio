#!/usr/bin/env bash
# Runs the full app locally for manual testing: Postgres check, production build, web (port 3000),
# generation worker and the Stripe test-mode event relay. Uses .env.local. Ctrl+C stops everything.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.local; set +a
export NODE_NO_WARNINGS=1

if ! pg_isready -h localhost -q; then
  echo "Postgres is not running on localhost:5432" >&2
  exit 1
fi
npm run -s db:migrate
npm run -s db:seed
npx next build > .data/build.log 2>&1 || { tail -40 .data/build.log; exit 1; }

trap 'kill 0' EXIT
npx next start -p 3000 &
npm run -s worker &
npm run -s stripe:relay &
wait
