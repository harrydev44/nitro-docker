#!/bin/bash
set -e

# Generate config.ini from environment variables
cat > /app/config.ini <<EOF
db.hostname=${DB_HOST:-mysql}
db.port=${DB_PORT:-3306}
db.database=${DB_NAME:-arcturus}
db.username=${DB_USER:-arcturus_user}
db.password=${DB_PASSWORD:-arcturus_pw}
db.params=
db.pool.minsize=25
db.pool.maxsize=100

game.host=0.0.0.0
game.port=3000

rcon.host=0.0.0.0
rcon.port=3001
rcon.allowed=0.0.0.0

enc.enabled=false
enc.e=3
enc.n=86851dd364d5c5cece3c883171cc6ddc5760779b992482bd1e20dd296888df91b33b936a7b93f06d29e8870f703a216257dec7c81de0058fea4cc5116f75e6efc4e9113513e45357dc3fd43d4efab5963ef178b78bd61e81a14c603b24c8bcce0a12230b320045498edc29282ff0603bc7b7dae8fc1b05b52b2f301a9dc783b7
enc.d=59ae13e243392e89ded305764bdd9e92e4eafa67bb6dac7e1415e8c645b0950bccd26246fd0d4af37145af5fa026c0ec3a94853013eaae5ff1888360f4f9449ee023762ec195dff3f30ca0b08b8c947e3859877b5d7dced5c8715c58b53740b84e11fbc71349a27c31745fcefeeea57cff291099205e230e0c7c27e8e1c0512b
EOF

echo "[START] config.ini generated"

# Wait for MySQL to be ready
echo "[START] Waiting for MySQL..."
until mysql -h"${DB_HOST}" -P"${DB_PORT}" -u"${DB_USER}" -p"${DB_PASSWORD}" -e "SELECT 1" &>/dev/null; do
  echo "[START] MySQL not ready, retrying in 3s..."
  sleep 3
done
echo "[START] MySQL is ready"

# Check if DB needs seeding
TABLES=$(mysql -h"${DB_HOST}" -P"${DB_PORT}" -u"${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}';" 2>/dev/null || echo "0")

if [ "$TABLES" -lt "5" ]; then
  echo "[START] Database is empty, importing base schema..."
  mysql -h"${DB_HOST}" -P"${DB_PORT}" -u"${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" < /app/sql/arcturus_3.0.0-stable_base_database--compact.sql
  echo "[START] Base schema imported. Applying migration..."
  mysql -h"${DB_HOST}" -P"${DB_PORT}" -u"${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" < /app/sql/arcturus_migration_3.0.0_to_3.5.0.sql
  echo "[START] Migration applied"
else
  echo "[START] Database already seeded ($TABLES tables found)"
fi

# Start the emulator
echo "[START] Starting Arcturus Emulator..."
exec java -Dfile.encoding=UTF-8 -Duser.country=EN -Duser.language=en -jar /app/Habbo-3.5.0-jar-with-dependencies.jar
