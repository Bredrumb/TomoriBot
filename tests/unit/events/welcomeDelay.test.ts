import { describe, expect, it } from "bun:test";
import { DEFAULT_WELCOME_DELAY_MS, resolveWelcomeDelayMs } from "@/events/guildMemberAdd/helpers/welcomeDelay";

describe("resolveWelcomeDelayMs", () => {
  it("defaults to one minute when no value is configured", () => {
    expect(resolveWelcomeDelayMs(undefined)).toBe(60_000);
    expect(resolveWelcomeDelayMs("")).toBe(DEFAULT_WELCOME_DELAY_MS);
    expect(resolveWelcomeDelayMs("   ")).toBe(DEFAULT_WELCOME_DELAY_MS);
  });

  it("accepts a non-negative integer delay", () => {
    expect(resolveWelcomeDelayMs("0")).toBe(0);
    expect(resolveWelcomeDelayMs(" 2500 ")).toBe(2_500);
    expect(resolveWelcomeDelayMs("60000")).toBe(60_000);
  });

  it("rejects invalid timer values", () => {
    expect(resolveWelcomeDelayMs("-1")).toBe(DEFAULT_WELCOME_DELAY_MS);
    expect(resolveWelcomeDelayMs("1.5")).toBe(DEFAULT_WELCOME_DELAY_MS);
    expect(resolveWelcomeDelayMs("later")).toBe(DEFAULT_WELCOME_DELAY_MS);
    expect(resolveWelcomeDelayMs("2147483648")).toBe(DEFAULT_WELCOME_DELAY_MS);
  });
});
