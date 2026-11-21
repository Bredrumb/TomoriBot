#!/bin/sh
set -eu

# Production mounts a tmpfs at /etc/searxng so the read-only root filesystem can still take a
# config write. That tmpfs masks whatever the image has at that path, so config baked straight
# into /etc/searxng never loads: SearXNG finds an empty directory, writes its own defaults, and
# serves 403 to the JSON API the bot depends on because `formats` then omits `json`. Staging
# elsewhere and restoring here survives the mount.
CONFIG_STAGE=/usr/local/searxng/tomoribot-config

# The base entrypoint only rewrites the literal `ultrasecretkey` from its own default file, and
# with a fresh random value rather than $SEARXNG_SECRET, so a settings.yml carrying a
# `${SEARXNG_SECRET}` placeholder would keep that placeholder as its live signing key. Substitute
# here instead. awk reads the value from ENVIRON so it never appears in a command line.
if [ -z "${SEARXNG_SECRET:-}" ]; then
  # Random beats an empty signing key if the deployment forgot to set one.
  SEARXNG_SECRET=$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')
  export SEARXNG_SECRET
  echo "SEARXNG_SECRET was not set; generated an ephemeral key for this container." >&2
fi

awk '{ gsub(/\$\{SEARXNG_SECRET\}/, ENVIRON["SEARXNG_SECRET"]); print }' \
  "$CONFIG_STAGE/settings.yml" >/etc/searxng/settings.yml
cp "$CONFIG_STAGE/limiter.toml" /etc/searxng/limiter.toml

exec /usr/local/searxng/entrypoint.sh "$@"
