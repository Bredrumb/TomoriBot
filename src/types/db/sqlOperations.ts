// Uses any[] rather than unknown[] because Bun's sql.unsafe spread signature requires it.

// biome-ignore lint/suspicious/noExplicitAny: Required for dynamic SQL parameter arrays
export type SqlParameterArray = any[];
