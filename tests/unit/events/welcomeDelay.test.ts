import { describe, expect, it } from "bun:test";
import { WELCOME_DELAY_MS, waitForWelcomeDelay } from "@/events/guildMemberAdd/helpers/welcomeDelay";

describe("waitForWelcomeDelay", () => {
  it("resolves immediately for a non-positive delay", async () => {
    await expect(waitForWelcomeDelay(0)).resolves.toBeUndefined();
    await expect(waitForWelcomeDelay(-1)).resolves.toBeUndefined();
  });

  it("waits out a positive delay", async () => {
    const startedAt = Date.now();
    await waitForWelcomeDelay(15);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10);
  });

  it("defaults to the onboarding grace period", () => {
    expect(WELCOME_DELAY_MS).toBe(60_000);
  });
});
