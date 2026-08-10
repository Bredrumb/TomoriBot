import { describe, expect, it } from "bun:test";
import type { PersonalProviderCapability, UserSavedProviderConfigRow } from "@/types/db/schema";
import {
  activatesNewPersonalOverride,
  findNewlyEnabledPersonalCapabilities,
  isPersonalTextCredentialRotation,
} from "@/utils/provider/personalProviderHelpers";

const CAPABILITIES: PersonalProviderCapability[] = ["text", "embedding", "image", "video", "vision"];

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

describe("activatesNewPersonalOverride", () => {
  it("reports an activation when the capability currently uses the server default", () => {
    expect(activatesNewPersonalOverride([STORED_BUT_DISABLED_GOOGLE], "text")).toBe(true);
    expect(activatesNewPersonalOverride([], "text")).toBe(true);
  });

  it("reports no activation when the capability is already a personal override", () => {
    expect(activatesNewPersonalOverride([ACTIVE_TEXT_OPENROUTER], "text")).toBe(false);
  });

  it("treats a switch to a different provider inside an active override as no activation", () => {
    // Intentionally switching provider within an already-personal capability must not re-prompt:
    // the cross-server scope the confirmation exists to disclose is already in effect.
    const rows = [ACTIVE_TEXT_OPENROUTER, STORED_BUT_DISABLED_GOOGLE];

    expect(activatesNewPersonalOverride(rows, "text")).toBe(false);
  });

  it("ignores an enabled capability that has no model configured", () => {
    const enabledWithoutModel = makeRow({ provider: "google", enabled_capabilities: ["vision"] });

    expect(activatesNewPersonalOverride([enabledWithoutModel], "vision")).toBe(true);
  });

  it("scopes the decision per capability", () => {
    expect(activatesNewPersonalOverride([ACTIVE_TEXT_OPENROUTER], "image")).toBe(true);
  });
});

describe("findNewlyEnabledPersonalCapabilities", () => {
  it("returns only capabilities moving from the server default onto a personal override", () => {
    const rows = [ACTIVE_TEXT_OPENROUTER, makeRow({ provider: "google", diffusion_model_id: 30 })];
    const selected = new Set<PersonalProviderCapability>(["text", "image"]);

    expect(findNewlyEnabledPersonalCapabilities(rows, selected, CAPABILITIES)).toEqual(["image"]);
  });

  it("returns nothing when the submission only turns capabilities off", () => {
    const selected = new Set<PersonalProviderCapability>();

    expect(findNewlyEnabledPersonalCapabilities([ACTIVE_TEXT_OPENROUTER], selected, CAPABILITIES)).toEqual([]);
  });

  it("returns nothing when the submission re-checks what was already on", () => {
    const selected = new Set<PersonalProviderCapability>(["text"]);

    expect(findNewlyEnabledPersonalCapabilities([ACTIVE_TEXT_OPENROUTER], selected, CAPABILITIES)).toEqual([]);
  });

  it("preserves the caller's capability order", () => {
    const rows = [makeRow({ provider: "google", llm_id: 1, diffusion_model_id: 2, vision_llm_id: 3 })];
    const selected = new Set<PersonalProviderCapability>(["vision", "text", "image"]);

    expect(findNewlyEnabledPersonalCapabilities(rows, selected, CAPABILITIES)).toEqual(["text", "image", "vision"]);
  });
});

describe("isPersonalTextCredentialRotation", () => {
  it("recognizes re-saving the provider that already answers the user's text requests", () => {
    expect(isPersonalTextCredentialRotation([ACTIVE_TEXT_OPENROUTER], "openrouter")).toBe(true);
    expect(isPersonalTextCredentialRotation([ACTIVE_TEXT_OPENROUTER], "OpenRouter")).toBe(true);
  });

  it("does not treat a different provider as a rotation", () => {
    expect(isPersonalTextCredentialRotation([ACTIVE_TEXT_OPENROUTER], "google")).toBe(false);
  });

  it("does not treat a first-ever personal provider as a rotation", () => {
    expect(isPersonalTextCredentialRotation([], "openrouter")).toBe(false);
    expect(isPersonalTextCredentialRotation([STORED_BUT_DISABLED_GOOGLE], "google")).toBe(false);
  });
});
