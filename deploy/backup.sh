#!/bin/sh
# Nattlig säkerhetskopia av databasen. Läggs i crontab på servern:
#   0 3 * * * /srv/mitt-och-ditt/deploy/backup.sh >> /var/log/mittochditt-backup.log 2>&1
set -eu

DIR="${BACKUP_DIR:-/srv/backups/mitt-och-ditt}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$DIR"
docker compose exec -T db pg_dump -U mittochditt mittochditt | gzip > "$DIR/db-$STAMP.sql.gz"
tar -czf "$DIR/uploads-$STAMP.tar.gz" -C /var/lib/docker/volumes/mitt-och-ditt_uploads/_data .

# Rensa gamla kopior.
find "$DIR" -name "db-*.sql.gz" -mtime "+$KEEP_DAYS" -delete
find "$DIR" -name "uploads-*.tar.gz" -mtime "+$KEEP_DAYS" -delete

echo "$(date -u +%FT%TZ) säkerhetskopia klar: $STAMP"
