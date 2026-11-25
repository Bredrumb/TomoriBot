FROM searxng/searxng@sha256:a7fc607aa6723f5a8982105bcc5ffba4d1b9fc7c6922a31a88d6e4cba49ef12a

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
