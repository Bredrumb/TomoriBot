\connect tomoribot
REVOKE ALL ON DATABASE tomoribot FROM PUBLIC;
GRANT CONNECT ON DATABASE tomoribot TO tomoribot_runtime, tomori_backup;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO tomoribot_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tomoribot_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO tomoribot_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tomoribot_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE tomoriadmin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tomoribot_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE tomoriadmin IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO tomoribot_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE tomoriadmin IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO tomoribot_runtime;

SELECT 1 / CASE WHEN COALESCE((
  SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
    AND NOT rolbypassrls AND NOT rolinherit
    AND has_database_privilege(rolname, current_database(), 'CONNECT')
    AND NOT has_database_privilege(rolname, current_database(), 'CREATE')
    AND has_schema_privilege(rolname, 'public', 'USAGE')
    AND NOT has_schema_privilege(rolname, 'public', 'CREATE')
  FROM pg_roles WHERE rolname = 'tomoribot_runtime'
), false) THEN 1 ELSE 0 END AS runtime_role_baseline_verified;
