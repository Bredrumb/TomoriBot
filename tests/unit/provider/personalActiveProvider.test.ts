import { describe, expect, it } from "bun:test";
import type { UserSavedProviderConfigRow } from "@/types/db/schema";
import { getActivePersonalProviderForCapability } from "@/utils/provider/personalProviderHelpers";

function makeRow(overrides: Partial<UserSavedProviderConfigRow> & { provider: string }): UserSavedProviderConfigRow {
  return {
    user_id: 1,
    provider: overrides.provider,
    enabled_capabilities: [],
    assigned_capabilities: [],
    llm_id: null,
    embedding_model_id: null,
    diffusion_model_id: null,
    nai_diffusion_model_id: null,
    video_model_id: null,
    vision_llm_id: null,
    ...overrides,
  } as unknown as UserSavedProviderConfigRow;
}

/** A provider whose Text capability is both configured and switched on. */
const ACTIVE_TEXT_OPENROUTER = makeRow({
  provider: "openrouter",
  enabled_capabilities: ["text"],
  llm_id: 10,
});

/** A provider with a stored Text model that the user has not enabled. */
const STORED_BUT_DISABLED_GOOGLE = makeRow({ provider: "google", llm_id: 20 });

const activeProvider = (
  rows: UserSavedProviderConfigRow[],
  capability: Parameters<typeof getActivePersonalProviderForCapability>[1],
) => getActivePersonalProviderForCapability(rows, capability)?.provider ?? null;

describe("getActivePersonalProviderForCapability", () => {
  it("falls back to the server default when no row has the capability both enabled and configured", () => {
    expect(activeProvider([STORED_BUT_DISABLED_GOOGLE], "text")).toBeNull();
    expect(activeProvider([], "text")).toBeNull();
  });

  it("picks the enabled provider over one that only stores a model", () => {
    expect(activeProvider([ACTIVE_TEXT_OPENROUTER, STORED_BUT_DISABLED_GOOGLE], "text")).toBe("openrouter");
  });

  it("ignores an enabled capability that has no model configured", () => {
    const enabledWithoutModel = makeRow({ provider: "google", enabled_capabilities: ["vision"] });

    expect(activeProvider([enabledWithoutModel], "vision")).toBeNull();
  });

  it("scopes the decision per capability", () => {
    expect(activeProvider([ACTIVE_TEXT_OPENROUTER], "image")).toBeNull();
  });
});
