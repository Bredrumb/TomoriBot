import { describe, expect, it } from "bun:test";
import { readApiKeyInactivityDays } from "@/utils/security/apiKeyRetention";
import { useEnvSandbox } from "../../helpers/env";
import { API_KEY_OWNERS } from "@/utils/db/repositories/ApiKeyRetentionRepository";

describe("API key retention configuration", () => {
  useEnvSandbox(["API_KEY_INACTIVITY_DAYS"]);

  it("limits automatic deletion to user-supplied credential owners", () => {
    expect(API_KEY_OWNERS.map((owner) => owner.table).sort()).toEqual([
      "api_key_rotation",
      "opt_api_keys",
      "saved_provider_configs",
      "server_model_configs",
      "user_saved_provider_configs",
    ]);
  });

  it("disables expiry while unset and accepts a bounded positive day count", () => {
    delete process.env.API_KEY_INACTIVITY_DAYS;
    expect(readApiKeyInactivityDays()).toBeNull();
    expect(readApiKeyInactivityDays("1")).toBe(1);
    expect(readApiKeyInactivityDays("90")).toBe(90);
    for (const value of [
      "",
      "0",
      "-1",
      "1.5",
      "7days",
      " 3",
      "3 ",
      "01",
      "1e2",
      "Infinity",
      "9007199254740992",
      "1000000000",
    ]) {
      expect(() => readApiKeyInactivityDays(value)).toThrow();
    }
    process.env.API_KEY_INACTIVITY_DAYS = "90";
    expect(readApiKeyInactivityDays()).toBe(90);
  });
});
