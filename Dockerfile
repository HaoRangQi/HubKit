FROM caddy:2-alpine

# Port 2281 needs no privileged bind capability. Remove the image's file cap
# so Caddy can execute with all container capabilities dropped.
RUN setcap -r /usr/bin/caddy

ENV HUBKIT_UPSTREAM=host.docker.internal:2282
ENV XDG_DATA_HOME=/tmp/caddy-data XDG_CONFIG_HOME=/tmp/caddy-config
COPY docker/Caddyfile /etc/caddy/Caddyfile

USER 1000:1000
EXPOSE 2281
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:2281/ || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
