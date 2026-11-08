FROM postgres:16-bookworm@sha256:e8a07d2c7579b038938cdba6c539e580e5001caf9ea203d397b5cc83e76bd938
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-pgvector postgresql-16-cron \
 && rm -rf /var/lib/apt/lists/*
