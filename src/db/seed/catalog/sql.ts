/** Render a boolean column (undefined => false). */
export const bool = (value?: boolean): string => (value ? "true" : "false");

/** Render a non-null SQL string literal, escaping single quotes. */
export const str = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** Render a nullable description column. */
export const desc = (value: string | null): string => (value === null ? "NULL" : str(value));

/** Render a Postgres TEXT[] literal. */
export function textArray(items: string[]): string {
  if (items.length === 0) {
    return "ARRAY[]::TEXT[]";
  }

  return `ARRAY[${items.map(str).join(", ")}]`;
}

/** Render a Postgres JSONB literal. */
export function jsonb(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Cannot render undefined as JSONB");
  }

  return `${str(encoded)}::jsonb`;
}
