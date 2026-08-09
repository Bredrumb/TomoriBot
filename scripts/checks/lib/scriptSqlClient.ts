/**
 * Single-connection Postgres client for the check scripts that provision and drop
 * disposable databases (`runTests.ts`, `validateLifecycle.ts`).
 *
 * Bun's `idleTimeout` is wall-clock time on the socket, so a statement the server is still
 * executing counts as idle: the pool closes the connection under the in-flight query and
 * rejects it with ERR_POSTGRES_IDLE_TIMEOUT raised from `#onClose`. The timer resets on
 * every completed query, and retiring a genuinely idle connection costs nothing because the
 * next query reconnects transparently, so the only thing this value bounds is the duration
 * of one statement. It has to clear the slowest statement these scripts issue: `CREATE
 * DATABASE` costs roughly 170ms on an idle server but crosses a second under `bun run vl`,
 * which runs the test runner and the DB lifecycle check against the same server at once.
 * Lowering it to bound a hang only kills healthy work; `connectionTimeout` is what covers a
 * dead path, and it is sized for that same fan-out because a connect that gives up early
 * degrades silently (`runTests.ts` falls back to skipping every DB regression suite).
 */

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
