// Bun `idleTimeout` includes active query time, so these timeouts clear `CREATE DATABASE` contention under `bun run
// vl` without silently skipping DB tests.

import { SQL } from "bun";

const SCRIPT_IDLE_TIMEOUT_SECONDS = 30;
const SCRIPT_CONNECTION_TIMEOUT_SECONDS = 10;

export function createScriptSqlClient(url: string): SQL {
  return new SQL(url, {
    max: 1,
    idleTimeout: SCRIPT_IDLE_TIMEOUT_SECONDS,
    connectionTimeout: SCRIPT_CONNECTION_TIMEOUT_SECONDS,
  });
}
