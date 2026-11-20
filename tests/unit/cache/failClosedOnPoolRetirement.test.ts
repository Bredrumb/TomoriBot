import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { PrivacyLevel } from "@/types/db/schema";
import { DatabaseUnavailableError } from "@/types/errors";
import { personaUserBlockRepository } from "@/utils/db/repositories/PersonaUserBlockRepository";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import { stubLogMembers } from "../../helpers/mockSurface";

stubLogMembers({ warn: () => {}, error: async () => {} });

const { getCachedPrivacyLevel, getCachedBlacklistStatus, invalidateUserCache } = await import(
  "@/utils/cache/userCache"
);
const { getCachedActiveBlocksForUser, invalidatePersonaUserBlockCache } = await import(
  "@/utils/cache/personaUserBlockCache"
);

// Bun rejects in-flight queries from #onClose with ERR_POSTGRES_LIFETIME_TIMEOUT on pool timer expiry, so this
// simulates healthy failure during retirement.
function retiredConnectionError(): DatabaseUnavailableError {
  return Object.assign(new DatabaseUnavailableError("Failed to read data"), {
    code: "ERR_POSTGRES_LIFETIME_TIMEOUT",
  });
}

const USER_ID = "100000000000000001";
const SERVER_DISC_ID = "200000000000000002";
const SERVER_ID = 42;

beforeEach(() => {
  invalidateUserCache(USER_ID);
  invalidatePersonaUserBlockCache(SERVER_ID, 1, USER_ID);
});

afterEach(() => {
  invalidateUserCache(USER_ID);
  invalidatePersonaUserBlockCache(SERVER_ID, 1, USER_ID);
});

// Assert the restrictive answer because permissive defaults look like valid reads in production and silently drop
// privacy or moderation guards.
describe("privacy and moderation reads under a pool retirement", () => {
  it("reports FULL privacy rather than MINIMAL when the privacy read fails", async () => {
    const rowSpy = spyOn(userRepository, "loadByDiscordId").mockRejectedValue(retiredConnectionError());
    const privacySpy = spyOn(userRepository, "getPrivacyLevel").mockRejectedValue(retiredConnectionError());

    // MINIMAL grants full personalization, so the old default silently exposed a user who had
    // deliberately chosen FULL for as long as the cascade lasted.
    expect(await getCachedPrivacyLevel(USER_ID)).toBe(PrivacyLevel.FULL);

    rowSpy.mockRestore();
    privacySpy.mockRestore();
  });

  it("does not cache the restrictive guess, so the next call retries the database", async () => {
    const rowSpy = spyOn(userRepository, "loadByDiscordId").mockRejectedValue(retiredConnectionError());
    const privacySpy = spyOn(userRepository, "getPrivacyLevel").mockRejectedValue(retiredConnectionError());

    expect(await getCachedPrivacyLevel(USER_ID)).toBe(PrivacyLevel.FULL);

    rowSpy.mockResolvedValue(null);
    privacySpy.mockResolvedValue(PrivacyLevel.MINIMAL);

    // Caching the guess would have pinned it for the full 30 minute TTL, turning a blip
    // measured in seconds into a half hour of degraded personalization.
    expect(await getCachedPrivacyLevel(USER_ID)).toBe(PrivacyLevel.MINIMAL);

    rowSpy.mockRestore();
    privacySpy.mockRestore();
  });

  it("treats the blacklist as still in force when the blacklist read fails", async () => {
    const rowSpy = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(null);
    const privacySpy = spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklistSpy = spyOn(userRepository, "isBlacklisted").mockRejectedValue(retiredConnectionError());

    expect(await getCachedBlacklistStatus(SERVER_DISC_ID, USER_ID)).toBe(true);

    rowSpy.mockRestore();
    privacySpy.mockRestore();
    blacklistSpy.mockRestore();
  });

  it("propagates a persona-block read failure rather than reporting no blocks", async () => {
    const blockSpy = spyOn(personaUserBlockRepository, "loadActiveBlocksForUser").mockRejectedValue(
      retiredConnectionError(),
    );

    // Propagate the failure because returning an empty array reads downstream as "no blocks apply" and lifts every
    // persona-level block.
    await expect(getCachedActiveBlocksForUser(SERVER_ID, USER_ID)).rejects.toThrow(DatabaseUnavailableError);

    blockSpy.mockRestore();
  });
});
