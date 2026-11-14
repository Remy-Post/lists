# lists-mcp: the Claude & Grok connector. Build from the repo root:
#   docker build -f mcp/Dockerfile -t lists-mcp .
# It runs the app's own modules (src/js), copied next to mcp/ in the same relative layout (../src/js).
FROM node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS deps
WORKDIR /app/mcp
COPY mcp/package.json mcp/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
RUN mkdir /data && chown node:node /data
# The root package.json says "type": "module", which src/js/*.js need.
COPY package.json /app/package.json
COPY src/js/store.js src/js/ops.js src/js/actions.js src/js/parse.js src/js/state.js src/js/sync.js /app/src/js/
WORKDIR /app/mcp
COPY --from=deps /app/mcp/node_modules ./node_modules
COPY mcp/package.json mcp/*.mjs ./
USER node
# Writes go only to /data (the volume); the root filesystem can be read-only.
ENV NODE_ENV=production LISTS_MCP_DATA=/data PORT=8788
VOLUME /data
EXPOSE 8788
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8788/mcp-admin/status || exit 1
CMD ["node", "server.mjs"]
