FROM postgres:15

RUN apt-get update && apt-get install -y \
    postgresql-15-cron \
    postgresql-15-pgvector \
    && rm -rf /var/lib/apt/lists/*

RUN echo "shared_preload_libraries = 'pg_cron'" >> /usr/share/postgresql/postgresql.conf.sample
RUN echo "cron.database_name = 'tomodb'" >> /usr/share/postgresql/postgresql.conf.sample