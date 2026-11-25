SELECT 'CREATE ROLE tomoriadmin' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tomoriadmin')
\gexec
SELECT 'CREATE ROLE tomoribot_runtime' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tomoribot_runtime')
\gexec
SELECT 'CREATE ROLE tomori_backup' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tomori_backup')
\gexec

ALTER ROLE tomoriadmin WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'admin_pw';
ALTER ROLE tomoribot_runtime WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'runtime_pw';
ALTER ROLE tomori_backup WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'backup_pw';
ALTER ROLE tomori_backup SET default_transaction_read_only = on;
GRANT pg_read_all_data TO tomori_backup;

ALTER DATABASE tomoribot OWNER TO tomoriadmin;
REVOKE ALL ON DATABASE tomoribot FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE tomoribot TO tomoribot_runtime, tomori_backup;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pg_stat_statements lives in the postgres database so a restore that recreates tomoribot cannot drop it.
\connect postgres
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
