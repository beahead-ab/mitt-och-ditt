#!/bin/sh
# Nattlig säkerhetskopia av databasen. Läggs i crontab på servern:
#   0 3 * * * /srv/mitt-och-ditt/deploy/backup.sh >> /var/log/mittochditt-backup.log 2>&1
set -eu

# Cron kör inte i projektets katalog, och docker compose hittar då ingen
# konfiguration. Utan detta hade kopieringen misslyckats varje natt - tyst,
# om ingen läser loggen.
cd "$(dirname "$0")/.."

DIR="${BACKUP_DIR:-/srv/backups/mitt-och-ditt}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$DIR"
docker compose exec -T db pg_dump -U mittochditt mittochditt | gzip > "$DIR/db-$STAMP.sql.gz"
# Bilagorna hämtas genom appcontainern i stället för från volymens sökväg på
# värden. Sökvägen beror på projektnamnet och kräver root; det här gör inget
# av delarna.
docker compose exec -T app tar -czf - -C /data/uploads . > "$DIR/uploads-$STAMP.tar.gz"

# En tom dump är värre än ingen, för den ser ut som en kopia. Kontrollera att
# båda filerna har innehåll innan de gamla rensas.
for f in "$DIR/db-$STAMP.sql.gz" "$DIR/uploads-$STAMP.tar.gz"; do
  if [ ! -s "$f" ]; then
    echo "AVBRYTER: $f är tom. Gamla kopior lämnas orörda." >&2
    exit 1
  fi
done

# Rensa gamla kopior.
find "$DIR" -name "db-*.sql.gz" -mtime "+$KEEP_DAYS" -delete
find "$DIR" -name "uploads-*.tar.gz" -mtime "+$KEEP_DAYS" -delete

echo "$(date -u +%FT%TZ) säkerhetskopia klar: $STAMP"
