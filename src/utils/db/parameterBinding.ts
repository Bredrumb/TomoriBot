export interface PositionalParameterList {
  values: number[];
  placeholders: string;
}

// Positional IN placeholders are used instead of Bun SQL's ANY($1) integer-array binding because ANY($1)
// intermittently fails with protocol error 08P01.
export function buildIntegerParameterList(ids: readonly number[]): PositionalParameterList {
  const values = Array.from(new Set(ids));
  return { values, placeholders: values.map((_, index) => `$${index + 1}`).join(", ") };
}
