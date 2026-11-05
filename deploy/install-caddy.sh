#!/bin/bash
# deploy/install-caddy.sh — insert or replace the "# BEGIN lists … # END lists" block in the shared Caddyfile.
# Backs up first, validates a candidate copy inside the Caddy container, and only then swaps and reloads.
# The CSP's script hash comes from the build (dist/csp-script-hashes.txt).
set -euo pipefail
cd "$(dirname "$0")/.."
CF=/home/ubuntu/n8n/caddy/Caddyfile
CAND=/home/ubuntu/n8n/caddy/Caddyfile.candidate
CADDY=n8n-caddy-1
HASHES=$(cat .release/csp-script-hashes.txt)
BLOCK=$(sed "s|script-src 'self';|script-src 'self' ${HASHES};|" deploy/caddy.lists.conf)

cp -a "$CF" "$CF.bak-lists-$(date +%Y%m%d-%H%M%S)"
python3 -I - "$CF" "$CAND" <<PY
import sys, re
src, out = sys.argv[1], sys.argv[2]
text = open(src).read()
block = '''$BLOCK'''.strip() + "\n"
pat = re.compile(r"# BEGIN lists.*?# END lists\n?", re.S)
text = pat.sub(block, text) if pat.search(text) else text.rstrip("\n") + "\n\n" + block
open(out, "w").write(text)
PY
docker exec "$CADDY" caddy validate --config /etc/caddy/Caddyfile.candidate --adapter caddyfile
mv -f "$CAND" "$CF"
docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
echo "Caddy reloaded with the lists block"
