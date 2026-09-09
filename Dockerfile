FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data/journal PUID=99 PGID=100
LABEL org.opencontainers.image.title="Charlie - Life Journal" \
      org.opencontainers.image.description="A private life journal for Unraid" \
      org.opencontainers.image.source="https://github.com/charliec94/diary"
RUN apk add --no-cache su-exec && mkdir -p /data/journal
COPY package.json server.js ./
COPY public ./public
COPY scripts/start-journal.sh /usr/local/bin/start-journal
RUN chmod 755 /usr/local/bin/start-journal
# Unraid injects its Tailscale hook before CMD. The hook must start as root;
# start-journal then drops only the app process to PUID:PGID.
USER root
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["wget", "-q", "--spider", "http://127.0.0.1:3000/health"]
# A simple executable path survives Unraid's shell reconstruction of CMD.
CMD ["/usr/local/bin/start-journal"]
