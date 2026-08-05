/**
 * Array type for SQL query parameters used with sql.unsafe spread operations.
 * This ensures compatibility with Bun's sql.unsafe spread argument signature.
 * Uses any[] to match the expected function signature while maintaining SqlValue documentation.
 *
 * @example
 * const values: SqlParameterArray = [userId, userName, isActive];
 * const query = sql.unsafe`UPDATE users SET name = $2, active = $3 WHERE id = $1`(...values);
 */

// biome-ignore lint/suspicious/noExplicitAny: Required for dynamic SQL parameter arrays
export type SqlParameterArray = any[];
