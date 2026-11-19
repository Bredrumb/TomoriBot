export const bool = (value?: boolean): string => (value ? "true" : "false");

export const str = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export const desc = (value: string | null): string => (value === null ? "NULL" : str(value));

export const num = (value?: number | null): string => (value === undefined || value === null ? "NULL" : String(value));

export function textArray(items: string[]): string {
  if (items.length === 0) {
    return "ARRAY[]::TEXT[]";
  }

  return `ARRAY[${items.map(str).join(", ")}]`;
}

export function jsonb(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Cannot render undefined as JSONB");
  }

  return `${str(encoded)}::jsonb`;
}
