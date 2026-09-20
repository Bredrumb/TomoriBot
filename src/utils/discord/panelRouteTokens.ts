import { isDiscordLocaleCode } from "@/constants/locales";

/**
 * Shared primitives for Discord panel route parsing and interaction tokens.
 * Panel catalogs and interaction routes across all six panel families share these
 * implementations to avoid duplicated parsing logic and token generation.
 */
export function parseLocale(value: string | undefined): string | null {
  return value && isDiscordLocaleCode(value) ? value : null;
}

export function createNonce(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}
