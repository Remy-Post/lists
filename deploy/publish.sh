#!/bin/bash
# deploy/publish.sh — build and publish Lists to /home/ubuntu/sites/lists (served as /srv/sites/lists by Caddy).
# Atomic: new release dir, then a relative `current` symlink swap. The previous release's /assets are
# carried forward so tabs still running the old version never 404 on a lazy chunk. Keeps 5 releases.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:$PATH"
ROOT=/home/ubuntu/sites/lists
NAME=$(date -u +%Y%m%d-%H%M%S)
REL="$ROOT/releases/$NAME"

export OUT=.release
node build.mjs
mkdir -p "$ROOT/releases"
trap 'rm -rf "$REL"' ERR
cp -a .release "$REL"
if [ -L "$ROOT/current" ] && [ -d "$ROOT/current/assets" ]; then
  cp -an "$ROOT/current/assets/." "$REL/assets/"   # -n: never overwrite this build's files
fi
rm -f "$REL/csp-script-hashes.txt"
trap - ERR
chmod -R a+rX "$REL"
ln -sfn "releases/$NAME" "$ROOT/current.tmp"
mv -Tf "$ROOT/current.tmp" "$ROOT/current"
ls -1dt "$ROOT"/releases/*/ | tail -n +6 | xargs -r rm -rf
echo "published $NAME ($(cat "$REL/version.txt"))"
