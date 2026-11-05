# lists-sync: build from the repo root:  docker build -f server/Dockerfile -t lists-sync .
FROM python:3.12-alpine
RUN adduser -D -H -u 10001 app && mkdir /data && chown app:app /data
COPY server/sync_server.py /app/sync_server.py
USER app
ENV LISTS_DB=/data/lists.db LISTS_PORT=8787 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8787
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=60s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["python3", "-I", "/app/sync_server.py"]
