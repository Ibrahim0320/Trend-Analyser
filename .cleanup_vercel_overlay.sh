#!/usr/bin/env bash
set -euo pipefail

echo "🔎 Detecting legacy files/folders to remove (Express/SQLite era)…"

# Candidate paths that are no longer needed when using Vercel serverless + Postgres
CANDIDATES=(
  "server"
  "uploads"
  "trends.db"
  "*.db"
  "*.sqlite"
  "server.sql*"
  "server/package-lock.json"
  "server/package.json"
  "server/node_modules"
  "server/index.js"
  "server/sqlite.js"
  "server/trends.js"
  "server/research.js"
  "server/themes.js"
  "server/briefs.js"
  ".env"                # ⚠️ only if you no longer use local .env; Vercel uses dashboard envs
  ".env.local"          # ditto; comment this out if you still want it locally
  "railway.toml"
  "render.yaml"
)

FOUND=()
for p in "${CANDIDATES[@]}"; do
  # expand globs (e.g. *.db)
  for match in $p; do
    if [ -e "$match" ]; then
      FOUND+=("$match")
    fi
  done
done

if [ ${#FOUND[@]} -eq 0 ]; then
  echo "✅ No legacy files found. Nothing to delete."
  exit 0
fi

echo ""
echo "The following will be deleted:"
for f in "${FOUND[@]}"; do
  echo "  - $f"
done

echo ""
read -r -p "Proceed with deletion? (y/N) " ANSWER
case "$ANSWER" in
  y|Y|yes|YES)
    echo ""
    echo "🧹 Deleting…"
    for f in "${FOUND[@]}"; do
      rm -rf "$f"
    done
    echo "✅ Done."
    ;;
  *)
    echo "❎ Aborted. Nothing deleted."
    exit 0
    ;;
esac

# If this is a git repo, also untrack removed files
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "🗂  Cleaning git index for deleted paths…"
  git add -A
  echo "ℹ️  Review with: git status"
fi
