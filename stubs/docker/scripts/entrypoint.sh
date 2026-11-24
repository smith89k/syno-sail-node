#!/bin/sh
set -e

MAX_RETRIES=30
RETRY_INTERVAL=3

# Wait for MariaDB to accept connections before starting the app, but only
# when the database is turned on (COMPOSE_PROFILES in .env includes "db").
if echo ",${COMPOSE_PROFILES}," | grep -q ",db,"; then
    echo "Waiting for database at ${DB_HOST}:${DB_PORT:-3306}..."
    RETRY_COUNT=0
    until node -e '
const s = require("net").connect(Number(process.env.DB_PORT || 3306), process.env.DB_HOST);
s.on("connect", () => { s.end(); process.exit(0); });
s.on("error", () => process.exit(1));
setTimeout(() => process.exit(1), 2000);
' 2>/dev/null; do
        RETRY_COUNT=$((RETRY_COUNT+1))
        if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
            echo "Database not available after ${MAX_RETRIES} retries."
            exit 1
        fi
        echo "Database not ready (attempt ${RETRY_COUNT}/${MAX_RETRIES}), retrying in ${RETRY_INTERVAL}s..."
        sleep $RETRY_INTERVAL
    done
    echo "Database is ready."
fi

# Runs your "migrate" script if package.json has one (Prisma, Knex, ...).
npm run migrate --if-present

exec "$@"
