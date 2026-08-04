FROM searxng/searxng@sha256:b8ca38ba06eea544d7555e88321e212ddc0d5c3c7de055419cfb2e5c6bf30812

# Bake in TomoriBot's custom settings — enables JSON format and disables the
# bot-limiter. The base image entrypoint substitutes ${SEARXNG_SECRET} at
# container startup, so the secret_key placeholder is resolved at runtime.
COPY settings.yml /etc/searxng/settings.yml
COPY limiter.toml /etc/searxng/limiter.toml
