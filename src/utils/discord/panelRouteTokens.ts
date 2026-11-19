import { isDiscordLocaleCode } from "@/constants/locales";

export function parseLocale(value: string | undefined): string | null {
  return value && isDiscordLocaleCode(value) ? value : null;
}

export function createNonce(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}
