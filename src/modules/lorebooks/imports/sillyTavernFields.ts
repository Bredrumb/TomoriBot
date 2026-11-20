export type SillyTavernObject = Record<string, unknown>;

export function asSillyTavernObject(value: unknown): SillyTavernObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as SillyTavernObject;
}

export function getSillyTavernString(obj: SillyTavernObject | null, key: string): string | null {
  if (!obj) return null;
  const value = obj[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getSillyTavernStringArray(obj: SillyTavernObject | null, key: string): string[] {
  if (!obj) return [];
  const value = obj[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function clampSillyTavernInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.trunc(value)))
    : fallback;
}
