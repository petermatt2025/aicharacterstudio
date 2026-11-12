#!/bin/sh
# Container entrypoint (Railway/Docker). APP_ROLE=web (default) runs migrations + seed, then the web server.
# APP_ROLE=worker runs the generation worker. Migrations take an advisory lock, so concurrent starts are safe.
set -e
case "${APP_ROLE:-web}" in
  worker) exec npm run -s worker ;;
  web)
    npm run -s db:migrate
    npm run -s db:seed
    exec npx next start -H 0.0.0.0 -p "${PORT:-3000}" ;;
  *) echo "Unknown APP_ROLE=$APP_ROLE (use web or worker)" >&2; exit 1 ;;
esac
