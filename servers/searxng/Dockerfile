FROM searxng/searxng@sha256:b8ca38ba06eea544d7555e88321e212ddc0d5c3c7de055419cfb2e5c6bf30812

# TomoriBot's settings enable the JSON format and disable the bot-limiter.
#
# Staged outside /etc/searxng on purpose: deployments mount a tmpfs there so the read-only
# root filesystem can still take the secret substitution, and that mount masks anything
# COPYed to the path. entrypoint.sh restores these into the mount before SearXNG starts, and
# the base entrypoint then substitutes ${SEARXNG_SECRET} into the restored copy.
COPY settings.yml /usr/local/searxng/tomoribot-config/settings.yml
COPY limiter.toml /usr/local/searxng/tomoribot-config/limiter.toml
COPY --chmod=0755 entrypoint.sh /usr/local/searxng/tomoribot-entrypoint.sh

ENTRYPOINT ["/usr/local/searxng/tomoribot-entrypoint.sh"]
