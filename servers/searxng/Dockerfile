FROM searxng/searxng:latest

# Bake in TomoriBot's custom settings — enables JSON format and disables the
# bot-limiter. The base image entrypoint substitutes ${SEARXNG_SECRET} at
# container startup, so the secret_key placeholder is resolved at runtime.
COPY settings.yml /etc/searxng/settings.yml
COPY limiter.toml /etc/searxng/limiter.toml
