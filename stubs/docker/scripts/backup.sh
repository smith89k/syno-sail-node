#!/bin/sh
set -e

DEPLOY_PATH="${DEPLOY_PATH:-$(pwd)}"

# Load the stack's .env file
if [ -f "${DEPLOY_PATH}/.env" ]; then
    set -a
    . "${DEPLOY_PATH}/.env"
    set +a
fi

CONTAINER_NAME="${CONTAINER_NAME:-node-app}"
DB_DATABASE="${DB_DATABASE:-app}"

PROJECT_NAME="$(basename "$DEPLOY_PATH")"
BACKUP_DIR="${BACKUP_DIR:-/volume1/docker/backups/${PROJECT_NAME}}"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

mkdir -p "$BACKUP_DIR"

# Redirect all output to the backup log
exec >> "$BACKUP_DIR/backup.log" 2>&1

echo "Backing up database..."
if [ -n "${DB_PASSWORD}" ]; then
  docker exec -e MYSQL_PWD="${DB_PASSWORD}" ${CONTAINER_NAME}-db sh -c "mariadb-dump -u root ${DB_DATABASE}" \
    > "$BACKUP_DIR/db_${DATE}.sql"
else
  docker exec ${CONTAINER_NAME}-db sh -c "mariadb-dump -u root ${DB_DATABASE}" \
    > "$BACKUP_DIR/db_${DATE}.sql"
fi

echo "Backing up app data..."
tar -czf "$BACKUP_DIR/data_${DATE}.tar.gz" -C "${DEPLOY_PATH}/data" app

echo "Removing backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "db_*.sql" -mtime +${RETENTION_DAYS} -delete
find "$BACKUP_DIR" -name "data_*.tar.gz" -mtime +${RETENTION_DAYS} -delete

echo "Backup complete:"
ls -lh "$BACKUP_DIR/db_${DATE}.sql" "$BACKUP_DIR/data_${DATE}.tar.gz"
